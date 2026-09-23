const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const providers = require("./providers.json");
const { prepareMessages } = require('./transmission-policy.cjs');

class PersonalError extends Error {}
const fail = message => { throw new PersonalError(message); };
const defaults = () => ({ schema: 1, mode: null, provider: "compatible", endpoint: "", model: "", workspace: "", encryptedKey: "", maxTokens: 1024 });

function validateModel(input) {
  const preset = providers.find(item => item.id === input?.provider);
  if (!preset) fail("모델 공급자를 선택해 주세요.");
  let url;
  const raw = input.endpoint;
  if (typeof raw !== "string" || raw.length > 1000 || /[\s?#\\]/.test(raw)) fail("쿼리와 인증 정보 없는 API 주소가 필요합니다.");
  try { url = new URL(raw); } catch { fail("API 주소 형식이 올바르지 않습니다."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) fail("HTTPS 주소 또는 이 PC의 로컬 HTTP 주소만 허용합니다.");
  if (input.provider === "local" && !loopback) fail("로컬 모델은 이 PC의 주소로 연결해 주세요.");
  if (preset.fixedEndpoint && url.href.replace(/\/+$/, "") !== preset.endpoint) fail(`${preset.label} 공식 API 주소를 사용해 주세요.`);
  if (typeof input.model !== "string" || !input.model.trim() || input.model.length > 200 || /[\x00-\x1f]/.test(input.model)) fail("모델 ID를 입력해 주세요.");
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 64 || input.maxTokens > 16384) fail("출력 토큰 한도는 64~16384여야 합니다.");
  return { provider: input.provider, endpoint: url.href.replace(/\/+$/, ""), model: input.model.trim(), maxTokens: input.maxTokens };
}

async function boundedJson(response) {
  if (!response.body) fail("모델 응답이 비어 있습니다.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) fail("모델 응답 크기가 제한을 초과했습니다.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail("모델 응답 형식이 올바르지 않습니다."); }
}

class PersonalService {
  constructor({ directory, safeStorage, fetchImpl = fetch, timeoutMs = 120000, googleAccounts }) {
    this.googleAccounts = googleAccounts;
    this.file = path.join(directory, "personal.json");
    this.safeStorage = safeStorage;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.active = null;
    this.data = defaults();
    if (fs.existsSync(this.file)) {
      try {
        if (fs.lstatSync(this.file).isSymbolicLink() || fs.statSync(this.file).size > 32000) throw new Error();
        const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (data.schema !== 1 || ![null, "personal", "enterprise"].includes(data.mode) || typeof data.encryptedKey !== "string" || typeof data.workspace !== "string") throw new Error();
        this.data = { ...defaults(), ...data };
      } catch { fail("개인용 설정을 읽지 못했습니다. 기존 설정은 덮어쓰지 않았습니다."); }
    }
  }
  encryptionAvailable() {
    return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  }
  state() {
    const { mode, provider, endpoint, model, workspace, maxTokens, encryptedKey } = this.data;
    const connection = ['codex', 'google'].includes(this.data.connection) ? this.data.connection : 'api';
    if (connection === 'google') return { mode, provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com', model: this.data.googleModel || '', connection, workspace,
      maxTokens: this.data.googleMaxTokens || 1024, accountId: this.data.googleAccountId || '', keyConfigured: false,
      accountConfigured: Boolean(this.googleAccounts?.has(this.data.googleAccountId)), secureStorage: this.encryptionAvailable() };
    return { mode, provider: connection === "codex" ? "codex" : provider, endpoint: connection === "codex" ? "ChatGPT / Codex" : endpoint,
      model: connection === "codex" ? this.data.codexModel || "" : model, connection, workspace, maxTokens,
      keyConfigured: connection === "api" && Boolean(encryptedKey), secureStorage: this.encryptionAvailable() };
  }
  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(data), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, this.file);
      this.data = data;
    } catch { fail("개인용 설정 저장에 실패했습니다."); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return this.state();
  }
  idle() { if (this.active || this.connectorActive || this.codexActive) fail("진행 중인 요청을 먼저 중단해 주세요."); }
  connection(value) {
    this.idle();
    if (!["api", "codex", "google"].includes(value)) fail("지원하지 않는 연결 방식입니다.");
    return this.write({ ...this.data, connection: value });
  }
  codexModel(model) {
    this.idle();
    if (typeof model !== "string" || !model.trim() || model.length > 200 || /[\x00-\x1f]/.test(model)) fail("Codex 모델을 선택해 주세요.");
    return this.write({ ...this.data, codexModel: model, connection: "codex" });
  }
  googleModel({ accountId, model, maxTokens }) {
    this.idle();
    if (!this.googleAccounts?.has(accountId)) fail('Google 계정에 먼저 로그인해 주세요.');
    if (typeof model !== 'string' || !/^gemini-[A-Za-z0-9._-]{1,180}$/.test(model)) fail('Gemini 모델 ID를 확인해 주세요.');
    if (!Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 16384) fail('출력 토큰 한도는 64~16384여야 합니다.');
    return this.write({ ...this.data, connection: 'google', googleAccountId: accountId, googleModel: model, googleMaxTokens: maxTokens });
  }
  setMode(mode) {
    this.idle();
    if (!["personal", "enterprise"].includes(mode)) fail("지원하지 않는 실행 모드입니다.");
    return this.write({ ...this.data, mode });
  }
  save(input) {
    this.idle();
    const config = validateModel(input);
    const key = input.apiKey ?? "";
    if (typeof key !== "string" || key.length > 8192 || /[^\x21-\x7e]/.test(key)) fail("API 키 형식이 올바르지 않습니다.");
    // A saved key is bound to its exact provider and endpoint, never silently forwarded elsewhere.
    const sameDestination = config.provider === this.data.provider && config.endpoint === this.data.endpoint;
    let encryptedKey = sameDestination ? this.data.encryptedKey : "";
    if (key) {
      if (!this.encryptionAvailable()) fail("OS 보안 저장소를 사용할 수 없어 키를 저장하지 않았습니다.");
      try { encryptedKey = this.safeStorage.encryptString(key).toString("base64"); }
      catch { fail("API 키 암호화에 실패했습니다."); }
    }
    if (config.provider !== "local" && !encryptedKey) fail("새 연결 주소에 사용할 API 키를 입력해 주세요.");
    return this.write({ ...this.data, ...config, encryptedKey });
  }
  removeKey() { this.idle(); return this.write({ ...this.data, encryptedKey: "" }); }
  workspace(directory) {
    this.idle();
    try {
      const resolved = fs.realpathSync(directory);
      if (!fs.statSync(resolved).isDirectory()) throw new Error();
      return this.write({ ...this.data, workspace: resolved });
    } catch { fail("작업 폴더를 확인하지 못했습니다."); }
  }
  cancel() { const active = this.active; active?.abort(); return { cancelled: Boolean(active) }; }
  async complete(messages, { probe = false } = {}) {
    this.idle();
    if (this.data.mode !== "personal") fail("개인용 모드에서만 모델을 호출할 수 있습니다.");
    const google = this.data.connection === 'google';
    const config = google ? { accountId: this.data.googleAccountId, model: this.data.googleModel, maxTokens: this.data.googleMaxTokens } : validateModel(this.data);
    if (google && (!this.googleAccounts?.has(config.accountId) || typeof config.model !== 'string' || !/^gemini-[A-Za-z0-9._-]{1,180}$/.test(config.model) || !Number.isInteger(config.maxTokens) || config.maxTokens < 64 || config.maxTokens > 16384)) fail('Google 계정과 Gemini 모델을 설정해 주세요.');
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24 || messages.some(row => !row || !["user", "assistant"].includes(row.role) || typeof row.content !== "string" || !row.content.trim()) || JSON.stringify(messages).length > 100000) fail("대화 입력이 제한을 초과했거나 올바르지 않습니다.");
    let key = "";
    if (!google && this.data.encryptedKey) {
      if (!this.encryptionAvailable()) fail("OS 보안 저장소를 사용할 수 없습니다.");
      try { key = this.safeStorage.decryptString(Buffer.from(this.data.encryptedKey, "base64")); }
      catch { fail("저장된 키를 복호화할 수 없습니다. 키를 다시 등록해 주세요."); }
    }
    if (!google && !key && config.provider !== "local") fail("API 키를 먼저 등록해 주세요.");
    messages = prepareMessages(messages, { secrets: [key], ErrorType: PersonalError });
    const controller = new AbortController();
    this.active = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      if (google) return await this.googleAccounts.complete(messages, config, controller.signal, probe);
      const body = { model: config.model, messages: messages.map(({ role, content }) => ({ role, content })), stream: false };
      const preset = providers.find(item => item.id === config.provider);
      body[preset.tokenField] = probe ? Math.min(preset.probeTokens, config.maxTokens) : config.maxTokens;
      const response = await this.fetch(config.endpoint + "/chat/completions", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const detail = { 401: "API 키를 확인해 주세요.", 403: "모델 접근 권한을 확인해 주세요.", 404: "API 주소와 모델 ID를 확인해 주세요.", 429: "요청 한도 또는 잔액을 확인해 주세요." }[response.status] || "모델 서버 요청에 실패했습니다.";
        fail(`HTTP ${response.status}: ${detail}`);
      }
      const result = await boundedJson(response);
      if (controller.signal.aborted) fail(timedOut ? "모델 응답 시간이 초과되었습니다." : "요청을 취소했습니다.");
      const choice = result.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string" || !text.trim()) fail("텍스트 응답이 없습니다. 모델 호환성과 출력 한도를 확인해 주세요.");
      const usage = {};
      for (const field of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
        if (Number.isSafeInteger(result.usage?.[field]) && result.usage[field] >= 0) usage[field] = result.usage[field];
      }
      return { text: key ? text.replaceAll(key, "[REDACTED]") : text, usage, status: choice.finish_reason === "stop" ? "completed" : "partial", checkedAt: new Date().toISOString() };
    } catch (error) {
      if (controller.signal.aborted) fail(timedOut ? "모델 응답 시간이 초과되었습니다." : "요청을 취소했습니다.");
      if (error instanceof PersonalError) throw error;
      fail("모델 연결에 실패했습니다. 주소·네트워크·인증서를 확인해 주세요.");
    } finally { clearTimeout(timer); this.active = null; key = ""; }
  }
}

module.exports = { PersonalService, PersonalError, validateModel, boundedJson };
