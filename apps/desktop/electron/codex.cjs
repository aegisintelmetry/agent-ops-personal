const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { PersonalError } = require("./personal.cjs");

function findCodex() {
  const candidates = (process.env.PATH || "").split(path.delimiter)
    .filter(folder => path.isAbsolute(folder)).map(folder => path.join(folder, process.platform === "win32" ? "codex.exe" : "codex"));
  const extensions = path.join(os.homedir(), ".vscode", "extensions");
  if (process.platform === "win32" && fs.existsSync(extensions)) {
    for (const name of fs.readdirSync(extensions).filter(name => name.startsWith("openai.chatgpt-")).sort().reverse()) {
      candidates.push(path.join(extensions, name, "bin", "windows-x86_64", "codex.exe"));
    }
  }
  return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } });
}

function safeAuthUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new PersonalError("로그인 주소를 확인하지 못했습니다."); }
  if (url.protocol !== "https:" || !["auth.openai.com", "chatgpt.com"].includes(url.hostname) || url.username || url.password || url.port || url.hash) {
    throw new PersonalError("허용되지 않은 로그인 주소입니다.");
  }
  return url.href;
}

// No inherited API/MCP tokens, provider overrides or IDE session identifiers.
function childEnvironment(home) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(path|systemroot|windir|comspec|temp|tmp|userprofile|home|homedrive|homepath|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|lang)$/i.test(key)) env[key] = value;
  }
  return { ...env, CODEX_HOME: home };
}

const lockedConfig = {
  forced_login_method: "chatgpt", cli_auth_credentials_store: "keyring",
  model_provider: "openai", sandbox_mode: "read-only", approval_policy: "never",
  web_search: "disabled", "history.persistence": "none", "tools.view_image": false,
  "features.shell_tool": false, "features.unified_exec": false,
  "features.view_image": false, "features.apps": false, "features.plugins": false,
  "features.multi_agent": false, "features.browser_use": false,
  "features.computer_use": false, "features.code_mode": false,
  "features.code_mode_host": false, "features.browser_use_external": false,
  "features.hooks": false, "features.image_generation": false,
  "features.skill_mcp_dependency_install": false, "features.skip_host_skill_discovery": true,
};

class CodexConnection {
  constructor({ directory, openExternal, executable = findCodex(), spawnImpl = spawn, timeoutMs = 30000 }) {
    this.home = path.join(directory, "codex-home");
    this.cwd = path.join(directory, "codex-workspace");
    this.executable = executable;
    this.openExternal = openExternal;
    this.spawn = spawnImpl;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 0;
    this.loginId = null;
    this.loginError = "";
    this.active = null;
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this.boot().finally(() => { this.starting = null; });
    return this.starting;
  }
  async boot() {
    if (!this.executable) throw new PersonalError("Codex 실행 파일이 없습니다. Codex CLI 또는 VS Code Codex 확장을 설치한 뒤 앱을 다시 실행해 주세요.");
    fs.mkdirSync(this.home, { recursive: true });
    fs.mkdirSync(this.cwd, { recursive: true });
    const args = ["app-server", "--listen", "stdio://"];
    for (const [key, value] of Object.entries(lockedConfig)) args.push("-c", `${key}=${JSON.stringify(value)}`);
    const child = this.spawn(this.executable, args, { cwd: this.cwd, env: childEnvironment(this.home), windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (this.child !== child) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) return this.stop("Codex 응답 크기를 초과했습니다.");
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { if (line.trim()) this.receive(JSON.parse(line)); }
        catch { this.stop("Codex 응답 형식을 확인하지 못했습니다."); return; }
      }
    });
    // Never forward raw protocol/stderr: it may contain authentication URLs or secrets.
    child.stderr.resume();
    child.stdin.on("error", () => { if (this.child === child) this.stop("Codex 연결이 종료되었습니다."); });
    child.on("error", () => { if (this.child === child) this.stop("Codex를 시작하지 못했습니다."); });
    child.on("exit", () => { if (this.child === child) this.stop("Codex 연결이 종료되었습니다."); });
    try {
      await this.request("initialize", { clientInfo: { name: "btk_personal", title: "AEGIS Agent Ops", version: require("../package.json").version } });
      this.send({ method: "initialized", params: {} });
    } catch (error) { this.stop(); throw error; }
  }
  send(message) {
    if (!this.child?.stdin.writable) throw new PersonalError("Codex 연결이 없습니다.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method, params = {}) {
    clearTimeout(this.idleTimer);
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.stop("Codex 요청 시간이 초과되었습니다."), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  receive(message) {
    if (message.id != null && message.method) {
      // Unsupported interactive/tool requests fail closed; never auto-approve.
      this.send({ id: message.id, error: { code: -32601, message: "This client does not authorize tools or permission changes." } });
      return;
    }
    if (message.id != null) {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer); this.pending.delete(message.id);
      if (message.error) waiting.reject(new PersonalError("Codex 요청이 거부되었습니다. 로그인·계정 권한·사용 한도를 확인해 주세요."));
      else waiting.resolve(message.result);
      this.idleTimer = setTimeout(() => {
        if (!this.active && !this.loginId && !this.pending.size) this.stop();
      }, 60000);
      this.idleTimer.unref?.();
      return;
    }
    const p = message.params || {};
    if (message.method === "account/login/completed" && p.loginId === this.loginId) {
      this.loginId = null; clearTimeout(this.loginTimer);
      this.loginError = p.success ? "" : "로그인을 완료하지 못했습니다. 다시 시도해 주세요.";
    }
    const active = this.active;
    if (!active || p.threadId !== active.threadId) return;
    if (message.method === "item/completed" && p.item?.type === "agentMessage") {
      active.text += typeof p.item.text === "string" ? p.item.text : "";
      if (active.text.length > 2 * 1024 * 1024) this.stop("Codex 응답 크기를 초과했습니다.");
    }
    if (message.method === "turn/completed") {
      if (p.turn?.status === "completed" && active.text.trim()) active.resolve({ text: active.text, status: "completed", usage: {}, checkedAt: new Date().toISOString() });
      else active.reject(new PersonalError(p.turn?.status === "interrupted" ? "요청을 취소했습니다." : "Codex 응답이 완료되지 않았습니다. 계정 한도와 연결을 확인해 주세요."));
    }
  }
  async state() {
    await this.start();
    const { account } = await this.request("account/read", { refreshToken: false });
    return { connected: account?.type === "chatgpt", plan: typeof account?.planType === "string" ? account.planType : "", pending: Boolean(this.loginId), error: this.loginError };
  }
  async login() {
    await this.start();
    if (this.loginId || this.active) throw new PersonalError("진행 중인 로그인 또는 요청을 먼저 완료해 주세요.");
    this.loginError = "";
    const result = await this.request("account/login/start", { type: "chatgpt" });
    this.loginId = result.loginId;
    this.loginTimer = setTimeout(() => { this.cancelLogin().catch(() => this.stop()); this.loginError = "로그인 시간이 만료되었습니다."; }, 10 * 60 * 1000);
    try { await this.openExternal(safeAuthUrl(result.authUrl)); }
    catch { await this.cancelLogin(); throw new PersonalError("로그인 브라우저를 열지 못했습니다."); }
    return { pending: true };
  }
  async cancelLogin() {
    const loginId = this.loginId;
    this.loginId = null; clearTimeout(this.loginTimer);
    if (loginId && this.child) await this.request("account/login/cancel", { loginId });
    return { pending: false };
  }
  async logout() {
    if (this.active) throw new PersonalError("대화를 먼저 중단해 주세요.");
    await this.start(); await this.cancelLogin();
    await this.request("account/logout");
    return this.state();
  }
  async models() {
    if (!(await this.state()).connected) throw new PersonalError("ChatGPT 로그인을 먼저 완료해 주세요.");
    const result = await this.request("model/list", { limit: 100 });
    return (result.data || []).filter(item => !item.hidden && typeof item.model === "string").map(item => ({ id: item.model, name: item.displayName || item.model }));
  }
  async limits() {
    if (!(await this.state()).connected) throw new PersonalError("ChatGPT 로그인을 먼저 완료해 주세요.");
    const result = await this.request("account/rateLimits/read");
    const limits = result.rateLimits || {};
    return ["primary", "secondary"].flatMap(name => {
      const value = limits[name];
      if (!value || !Number.isFinite(value.usedPercent)) return [];
      return [{ name, usedPercent: Math.max(0, Math.min(100, value.usedPercent)),
        windowMinutes: Number.isFinite(value.windowDurationMins) ? value.windowDurationMins : null,
        resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt : null }];
    });
  }
  async complete(messages, model) {
    if (this.active || this.loginId) throw new PersonalError("진행 중인 요청을 먼저 완료해 주세요.");
    if (!Array.isArray(messages) || !messages.length || messages.length > 24 || messages.some(row => !row || !["user", "assistant"].includes(row.role) || typeof row.content !== "string" || !row.content.trim()) || JSON.stringify(messages).length > 100000) throw new PersonalError("대화 입력이 올바르지 않습니다.");
    if (typeof model !== "string" || !model || model.length > 200) throw new PersonalError("Codex 모델을 선택해 주세요.");
    // Reserve before awaiting auth so a second caller cannot start another turn.
    const active = { threadId: null, text: "", reject: () => {}, resolve: () => {} };
    this.active = active;
    let timer;
    try {
      if (!(await this.state()).connected) throw new PersonalError("ChatGPT 로그인을 먼저 완료해 주세요.");
      const thread = await this.request("thread/start", { model, modelProvider: "openai", cwd: this.cwd, sandbox: "read-only", approvalPolicy: "never", ephemeral: true,
        developerInstructions: "Respond to the supplied conversation as a text assistant. Do not use tools, inspect files, run commands, or request permissions." });
      if (this.active !== active) throw new PersonalError("요청을 취소했습니다.");
      active.threadId = thread.thread.id;
      const result = new Promise((resolve, reject) => { active.resolve = resolve; active.reject = reject; });
      // Attach rejection handling before turn/start to handle early completion/cancellation.
      result.catch(() => {});
      timer = setTimeout(() => this.stop("Codex 응답 시간이 초과되었습니다."), 120000);
      await this.request("turn/start", { threadId: active.threadId, input: [{ type: "text", text: JSON.stringify(messages.map(({ role, content }) => ({ role, content }))), text_elements: [] }] });
      return await result;
    } finally {
      clearTimeout(timer);
      if (this.active === active) this.active = null;
      if (active.threadId && this.child) this.request("thread/unsubscribe", { threadId: active.threadId }).catch(() => {});
    }
  }
  cancel() { const cancelled = Boolean(this.active); if (cancelled) this.stop("요청을 취소했습니다."); return { cancelled }; }
  stop(reason = "Codex 연결이 종료되었습니다.") {
    const child = this.child; this.child = null;
    clearTimeout(this.loginTimer); this.loginId = null;
    clearTimeout(this.idleTimer);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new PersonalError(reason)); }
    this.pending.clear();
    this.active?.reject(new PersonalError(reason)); this.active = null;
    child?.kill();
  }
}

module.exports = { CodexConnection, safeAuthUrl, childEnvironment, lockedConfig, findCodex };
