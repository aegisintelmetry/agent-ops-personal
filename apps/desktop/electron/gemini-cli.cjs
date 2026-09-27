const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PersonalError } = require('./personal.cjs');
const { prepareMessages } = require('./transmission-policy.cjs');
const { imageData } = require('./image-data.cjs');

const SETTINGS = {
  general: { enableAutoUpdate: false, enableAutoUpdateNotification: false },
  privacy: { usageStatisticsEnabled: false }, telemetry: { enabled: false },
  advanced: { autoConfigureMemory: false },
  tools: { core: [], allowed: [], exclude: [] }, mcpServers: {}, mcp: { allowed: [] },
  hooksConfig: { enabled: false }, skills: { enabled: false },
  experimental: { autoMemory: false, enableAgents: false },
  context: { fileName: [], includeDirectories: [], discoveryMaxDirs: 0 },
  security: { auth: {} },
};
function childEnvironment(home) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(path|systemroot|windir|comspec|temp|tmp|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|lang)$/i.test(key)) env[key] = value;
  }
  return { ...env, HOME: home, USERPROFILE: home, GEMINI_CLI_HOME: home,
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(home, 'managed-settings.json'),
    GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(home, 'managed-settings.json'),
    GEMINI_CLI_NO_RELAUNCH: 'true', ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1',
    GEMINI_FORCE_ENCRYPTED_FILE_STORAGE: 'true', GEMINI_FORCE_FILE_STORAGE: 'true' };
}
function bundledCli() {
  return path.join(path.dirname(require.resolve('@google/gemini-cli/package.json')), 'bundle', 'gemini.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}
class GeminiCli {
  constructor({ directory, executable = process.execPath, script = bundledCli(), spawnImpl = spawn, timeoutMs = 120000 }) {
    this.home = path.join(directory, 'gemini-cli-home');
    this.cwd = path.join(this.home, 'workspace');
    this.executable = executable; this.script = script; this.spawn = spawnImpl;
    this.timeoutMs = timeoutMs; this.requests = new Map(); this.nextId = 0;
    this.queue = Promise.resolve(); this.queued = 0; this.pending = false; this.error = '';
  }
  guard() {
    for (const file of [path.dirname(this.home), this.home, this.cwd, path.join(this.home, '.gemini')]) {
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new PersonalError('Gemini 로그인 저장 경로가 올바르지 않습니다.');
    }
  }
  state() {
    this.guard();
    const file = path.join(this.home, '.gemini', 'gemini-credentials.json');
    let connected = false;
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 512000) throw new PersonalError('Gemini 로그인 저장 경로가 올바르지 않습니다.');
      connected = stat.size > 2;
    }
    return { connected, pending: this.pending, error: this.error, runtimeAvailable: fs.existsSync(this.script) };
  }
  prepare() {
    this.guard();
    fs.mkdirSync(this.cwd, { recursive: true });
    fs.mkdirSync(path.join(this.home, '.gemini'), { recursive: true });
    for (const file of [path.join(this.home, 'managed-settings.json'), path.join(this.home, '.gemini', 'settings.json')]) {
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new PersonalError('Gemini 로그인 저장 경로가 올바르지 않습니다.');
      fs.writeFileSync(file, JSON.stringify(SETTINGS), { mode: 0o600 });
    }
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this.boot().finally(() => { this.starting = null; });
    return this.starting;
  }
  async boot() {
    this.prepare();
    const child = this.spawn(this.executable, [this.script, '--acp'], {
      cwd: this.cwd, env: { ...childEnvironment(this.home), ...(!this.pending ? { NO_BROWSER: 'true' } : {}) }, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 20 * 1024 * 1024) return this.stop('Gemini 응답 크기를 초과했습니다.');
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { if (line.trim()) this.receive(JSON.parse(line)); }
        catch { this.stop('Gemini 응답 형식을 확인하지 못했습니다.'); return; }
      }
    });
    child.stderr.resume(); // OAuth URLs and raw provider errors never reach logs or the renderer.
    child.stdin.on('error', () => { if (this.child === child) this.stop(); });
    child.on('error', () => { if (this.child === child) this.stop('Gemini CLI를 시작하지 못했습니다.'); });
    child.on('exit', () => { if (this.child === child) this.stop(); });
    try {
      const result = await this.request('initialize', { protocolVersion: 1,
        clientInfo: { name: 'aegis-agent-ops', version: require('../package.json').version },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }, 30000);
      if (result.protocolVersion !== 1 || !result.authMethods?.some(a => a.id === 'oauth-personal')) throw new PersonalError('Gemini CLI 인증 프로토콜을 확인하지 못했습니다.');
    } catch (error) { this.stop(); throw error; }
  }
  send(message) {
    if (!this.child?.stdin.writable) throw new PersonalError('Gemini CLI 연결이 없습니다.');
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }
  request(method, params, timeout = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.stop('Gemini 요청 시간이 초과되었습니다.'), timeout);
      this.requests.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.requests.delete(id); reject(error); }
    });
  }
  receive(message) {
    if (message.id != null && message.method) {
      if (message.method === 'session/request_permission') this.send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } });
      else this.send({ id: message.id, error: { code: -32601, message: 'This client does not authorize tools, files, or terminals.' } });
      return;
    }
    if (message.id != null) {
      const pending = this.requests.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.requests.delete(message.id);
      if (message.error) pending.reject(new PersonalError('Gemini 요청이 거부되었습니다. 로그인, 계정 사용 한도와 조직 프로젝트 권한을 확인해 주세요.'));
      else pending.resolve(message.result || {});
      return;
    }
    const { sessionId, update } = message.params || {};
    if (message.method === 'session/update' && this.active?.id === sessionId && update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      this.active.text += update.content.text;
      if (Buffer.byteLength(this.active.text) > 2 * 1024 * 1024) this.stop('Gemini 응답 크기를 초과했습니다.');
    }
  }
  login() {
    if (this.pending || this.queued) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
    this.pending = true; this.error = '';
    const attempt = {}; this.loginAttempt = attempt;
    this.loginTask = (async () => {
      try {
        await this.start();
        if (this.loginAttempt !== attempt) return;
        await this.request('authenticate', { methodId: 'oauth-personal' }, 330000);
        if (this.loginAttempt === attempt && !this.state().connected) throw new PersonalError('Gemini 로그인 저장을 확인하지 못했습니다. 다시 로그인해 주세요.');
      } catch (error) { if (this.loginAttempt === attempt) this.error = error.message; }
      finally { if (this.loginAttempt === attempt) { this.pending = false; this.loginAttempt = null; this.stop(); } }
    })();
    return this.state();
  }
  async cancelLogin() {
    this.loginAttempt = null; this.pending = false; this.stop();
    await this.loginTask; this.error = ''; return this.state();
  }
  async logout() {
    if (this.queued) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
    await this.cancelLogin(); this.guard();
    // Only this app's known credential files; never touch the user's standalone CLI account.
    for (const name of ['gemini-credentials.json', 'oauth_creds.json', 'google_accounts.json']) {
      const file = path.join(this.home, '.gemini', name);
      if (fs.existsSync(file)) {
        if (fs.lstatSync(file).isSymbolicLink()) throw new PersonalError('Gemini 로그인 저장 경로가 올바르지 않습니다.');
        fs.unlinkSync(file);
      }
    }
    return this.state();
  }
  async complete(input, config, signal) {
    const messages = prepareMessages(input, { ErrorType: PersonalError });
    const model = config.model;
    if (typeof model !== 'string' || !/^(auto|gemini-[A-Za-z0-9._-]{1,180})$/.test(model)) throw new PersonalError('Gemini 모델 ID를 확인해 주세요.');
    if (this.pending || !this.state().connected) throw new PersonalError('Google 계정에 먼저 로그인해 주세요.');
    const previous = this.queue;
    let release; this.queue = new Promise(resolve => { release = resolve; }); this.queued++;
    // A shared credential serves separate sessions, serially, without shared conversation history.
    await previous;
    const abort = () => this.stop('요청을 취소했습니다.');
    try {
      signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
      await this.start(); signal.throwIfAborted();
      await this.request('authenticate', { methodId: 'oauth-personal' }); signal.throwIfAborted();
      const session = await this.request('session/new', { cwd: this.cwd, mcpServers: [] });
      signal.throwIfAborted();
      await this.request('session/set_model', { sessionId: session.sessionId, modelId: model });
      signal.throwIfAborted();
      this.active = { id: session.sessionId, text: '' };
      const prompt = messages.flatMap(({ role, content, images }) => [
        { type: 'text', text: JSON.stringify({ role, content }) },
        ...(images || []).map(value => { const { mime, bytes } = imageData(value); return { type: 'image', mimeType: mime, data: bytes.toString('base64') }; }),
      ]);
      const result = await this.request('session/prompt', { sessionId: session.sessionId, prompt });
      signal.throwIfAborted();
      const text = this.active?.text || '';
      if (result.stopReason !== 'end_turn' || !text.trim()) throw new PersonalError('Gemini 응답이 완료되지 않았습니다. 계정 한도와 연결을 확인해 주세요.');
      return { text, status: 'completed', usage: {}, checkedAt: new Date().toISOString() };
    } finally {
      signal.removeEventListener('abort', abort); this.active = null; this.stop(); this.queued--; release();
    }
  }
  stop(reason = 'Gemini CLI 연결이 종료되었습니다.') {
    const child = this.child; this.child = null;
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(new PersonalError(reason)); }
    this.requests.clear(); child?.kill();
  }
}
module.exports = { GeminiCli, SETTINGS, childEnvironment, bundledCli };
