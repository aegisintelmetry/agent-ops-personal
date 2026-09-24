const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID, randomBytes } = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { PersonalError, boundedJson } = require('./personal.cjs');
const fail = message => { throw new PersonalError(message); };
const SCOPES = ['https://www.googleapis.com/auth/generative-language.retriever'];
const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
function clientConfig(value) {
  const config = value?.installed;
  if (!config || typeof config.client_id !== 'string' || !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.client_id) ||
      typeof config.client_secret !== 'string' || !config.client_secret || config.client_secret.length > 512 ||
      typeof config.project_id !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(config.project_id)) fail('Google 데스크톱 OAuth 클라이언트 JSON을 선택해 주세요.');
  // Never trust authorization/token URLs supplied by an imported client file.
  return { client_id: config.client_id, client_secret: config.client_secret, project_id: config.project_id };
}
class GoogleAccounts {
  constructor({ directory, safeStorage, openExternal, clientFactory, fetchImpl = fetch, loginTimeoutMs = 180000 }) {
    this.directory = directory; this.file = path.join(directory, 'google-accounts.enc');
    this.safe = safeStorage; this.openExternal = openExternal; this.fetch = fetchImpl;
    this.clientFactory = clientFactory || (options => new OAuth2Client(options));
    this.loginTimeoutMs = loginTimeoutMs; this.pending = null; this.error = ''; this.clients = new Map();
  }
  guard() {
    for (const file of [this.directory, this.file]) if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail('계정 저장 경로가 올바르지 않습니다.');
    if (!this.safe.isEncryptionAvailable() || this.safe.getSelectedStorageBackend?.() === 'basic_text') fail('OS 암호화 저장소를 사용할 수 없습니다.');
  }
  load() {
    this.guard();
    if (!fs.existsSync(this.file)) return { schema: 1, accounts: [] };
    try {
      if (fs.statSync(this.file).size > 512000) throw new Error();
      const data = JSON.parse(this.safe.decryptString(fs.readFileSync(this.file)));
      if (data.schema !== 1 || !Array.isArray(data.accounts) || data.accounts.length > 20 || new Set(data.accounts.map(a => a.id)).size !== data.accounts.length) throw new Error();
      for (const a of data.accounts) {
        if (!validId(a.id) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 60 || !a.tokens || typeof a.tokens !== 'object') throw new Error();
        clientConfig({ installed: a.client });
        for (const key of ['access_token', 'refresh_token']) if (a.tokens[key] !== undefined && (typeof a.tokens[key] !== 'string' || a.tokens[key].length > 16000)) throw new Error();
      }
      return data;
    } catch { fail('연결 계정을 읽지 못했습니다. 기존 파일은 변경하지 않았습니다.'); }
  }
  write(data) {
    this.guard(); fs.mkdirSync(this.directory, { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const bytes = this.safe.encryptString(JSON.stringify(data)); if (bytes.length > 512000) throw new Error();
      fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, this.file);
    } catch { fail('연결 계정 저장에 실패했습니다.'); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  state() {
    return { accounts: this.load().accounts.map(a => ({ id: a.id, name: a.name, provider: 'gemini', project: a.client.project_id, connected: Boolean(a.tokens.refresh_token) && !a.reauthRequired, reauthRequired: Boolean(a.reauthRequired) })), loginId: this.pending?.id || null, browserOpening: Boolean(this.pending?.opening), error: this.error };
  }
  has(id) { return this.load().accounts.some(a => a.id === id && a.tokens.refresh_token && !a.reauthRequired); }
  import(value, name) {
    if (this.pending) fail('진행 중인 로그인을 완료하거나 취소해 주세요.');
    if (typeof name !== 'string' || !name.trim() || name.length > 60 || /[\x00-\x1f]/.test(name)) fail('계정 이름은 1~60자로 입력해 주세요.');
    const data = this.load(); if (data.accounts.length >= 20) fail('연결 계정은 최대 20개까지 등록할 수 있습니다.');
    const account = { id: randomUUID(), name: name.trim(), client: clientConfig(value), tokens: {} };
    data.accounts.push(account); this.write(data); this.error = ''; return this.state();
  }
  remove(id) {
    if (this.pending) fail('진행 중인 로그인을 완료하거나 취소해 주세요.');
    const data = this.load(); if (!data.accounts.some(a => a.id === id)) fail('연결 계정을 선택해 주세요.');
    data.accounts = data.accounts.filter(a => a.id !== id); this.write(data); this.clients.delete(id); return this.state();
  }
  client(account, redirectUri) {
    const client = this.clientFactory({ clientId: account.client.client_id, clientSecret: account.client.client_secret, redirectUri });
    if (client.transporter) client.transporter.defaults = { ...client.transporter.defaults, timeout: 30000, retry: false };
    return client;
  }
  async login(id) {
    if (this.pending) fail('진행 중인 로그인을 완료하거나 취소해 주세요.');
    const account = this.load().accounts.find(a => a.id === id); if (!account) fail('연결 계정을 선택해 주세요.');
    const pending = { id, nonce: randomBytes(32).toString('hex'), busy: false };
    this.pending = pending; this.error = '';
    const finish = error => {
      if (this.pending !== pending) return;
      this.pending = null; this.error = error || ''; clearTimeout(pending.timer);
      clearTimeout(pending.browserTimer);
      pending.server?.close(); pending.server?.closeAllConnections();
    };
    pending.finish = finish;
    try {
      const server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Referrer-Policy', 'no-referrer');
        let url; try { url = new URL(req.url, pending.redirect); } catch { res.writeHead(400); res.end('Invalid callback'); return; }
        if (req.method !== 'GET' || req.headers.host !== new URL(pending.redirect).host || url.pathname !== '/oauth/callback' ||
            url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== pending.nonce || this.pending !== pending || pending.busy) {
          res.writeHead(400); res.end('Invalid callback'); return;
        }
        if (url.searchParams.has('error')) { res.end('Authorization declined. Return to Agent Ops.'); finish('Google 로그인이 취소되었습니다.'); return; }
        const code = url.searchParams.get('code');
        if (!code || code.length > 8192 || url.searchParams.getAll('code').length !== 1) { res.writeHead(400); res.end('Invalid callback'); return; }
        pending.busy = true;
        try {
          const { tokens } = await pending.client.getToken({ code, codeVerifier: pending.verifier });
          if (this.pending !== pending) { res.end('Login expired.'); return; }
          if (!tokens.refresh_token || !tokens.access_token) throw new Error();
          const data = this.load(); const current = data.accounts.find(a => a.id === id); if (!current) throw new Error();
          current.tokens = this.tokens(tokens); current.reauthRequired = false; this.write(data); this.clients.delete(id);
          res.end('Connected. Return to Agent Ops.'); finish();
        } catch { res.end('Login failed. Return to Agent Ops.'); finish('Google 로그인에 실패했습니다. 프로젝트와 동의 화면 설정을 확인해 주세요.'); }
      });
      pending.server = server;
      server.requestTimeout = 10000; server.headersTimeout = 10000;
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      if (this.pending !== pending) { server.close(); return this.state(); }
      pending.redirect = `http://127.0.0.1:${server.address().port}/oauth/callback`;
      pending.client = this.client(account, pending.redirect);
      const { codeVerifier, codeChallenge } = await pending.client.generateCodeVerifierAsync(); pending.verifier = codeVerifier;
      if (this.pending !== pending) return this.state();
      const authUrl = pending.client.generateAuthUrl({ access_type: 'offline', prompt: 'consent select_account', scope: SCOPES, state: pending.nonce, code_challenge: codeChallenge, code_challenge_method: 'S256' });
      const url = new URL(authUrl); if (url.origin !== 'https://accounts.google.com' || url.username || url.password) throw new Error();
      pending.timer = setTimeout(() => finish('Google 로그인 시간이 초과되었습니다.'), this.loginTimeoutMs);
      pending.authUrl = authUrl;
      this.openBrowser(pending); return this.state();
    } catch { finish('Google 로그인을 시작하지 못했습니다.'); fail('Google 로그인을 시작하지 못했습니다.'); }
  }
  openBrowser(pending) {
    if (this.pending !== pending || pending.opening || pending.busy || !pending.authUrl) return;
    pending.opening = true; this.error = '';
    const attempt = {}; pending.browserAttempt = attempt;
    // Do not let an OS browser-launch promise block cancellation or state polling.
    const timer = setTimeout(() => {
      if (this.pending === pending && pending.browserAttempt === attempt) {
        pending.opening = false; pending.browserAttempt = null;
        this.error = '브라우저를 열지 못했습니다. 브라우저 다시 열기를 눌러 주세요.';
      }
    }, 5000);
    pending.browserTimer = timer;
    Promise.resolve().then(() => {
      if (this.pending === pending && pending.browserAttempt === attempt) return this.openExternal(pending.authUrl);
    }).catch(() => {
      if (this.pending === pending && pending.browserAttempt === attempt) this.error = '브라우저를 열지 못했습니다. 브라우저 다시 열기를 눌러 주세요.';
    }).finally(() => {
      clearTimeout(timer);
      if (pending.browserAttempt === attempt) { pending.opening = false; pending.browserAttempt = null; }
    });
  }
  reopenLogin(id) {
    if (!this.pending || this.pending.id !== id) fail('진행 중인 Google 로그인이 없습니다. 다시 로그인해 주세요.');
    this.openBrowser(this.pending); return this.state();
  }
  requireLogin(id) {
    const data = this.load(); const account = data.accounts.find(a => a.id === id);
    if (account) { account.reauthRequired = true; this.write(data); }
    this.clients.delete(id);
  }
  cancelLogin() { this.pending?.finish(); return this.state(); }
  stop() { this.pending?.finish(); }
  tokens(input) {
    return Object.fromEntries(['access_token', 'refresh_token', 'expiry_date', 'token_type', 'scope'].filter(k => input[k] !== undefined).map(k => [k, input[k]]));
  }
  async credential(id) {
    const account = this.load().accounts.find(a => a.id === id);
    if (!account?.tokens.refresh_token || account.reauthRequired) fail('Google 계정에 먼저 로그인해 주세요.');
    let client = this.clients.get(id);
    if (!client) {
      client = this.client(account); client.setCredentials(account.tokens);
      client.on('tokens', tokens => {
        const data = this.load(); const current = data.accounts.find(a => a.id === id);
        if (current) { current.tokens = { ...current.tokens, ...this.tokens(tokens) }; this.write(data); }
      });
      this.clients.set(id, client);
    }
    try { const { token } = await client.getAccessToken(); if (!token) throw new Error(); return { token, project: account.client.project_id }; }
    catch (error) {
      if (error?.response?.data?.error === 'invalid_grant') this.requireLogin(id);
      fail('Google 인증 갱신에 실패했습니다. 다시 로그인해 주세요.');
    }
  }
  async complete(messages, config, signal, probe) {
    const { prepareMessages } = require('./transmission-policy.cjs');
    messages = prepareMessages(messages, { ErrorType: PersonalError });
    config = { ...config };
    const { token, project } = await this.credential(config.accountId);
    messages = prepareMessages(messages, { secrets: [token], ErrorType: PersonalError });
    signal.throwIfAborted();
    const response = await this.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-goog-user-project': project },
      body: JSON.stringify({ contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: probe ? Math.min(256, config.maxTokens) : config.maxTokens } }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401) this.requireLogin(config.accountId);
      fail({ 401: 'Google 계정에 다시 로그인해 주세요.', 403: 'Google 프로젝트의 API 권한과 결제 설정을 확인해 주세요.', 404: 'Gemini 모델 ID를 확인해 주세요.', 429: '요청 한도 또는 잔액을 확인해 주세요.' }[response.status] || 'Gemini 요청에 실패했습니다.');
    }
    const result = await boundedJson(response); signal.throwIfAborted();
    const candidate = result.candidates?.[0];
    const text = candidate?.content?.parts?.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
    if (!text?.trim()) fail('텍스트 응답이 없습니다. 모델 호환성과 출력 한도를 확인해 주세요.');
    const usage = {};
    for (const [target, source] of Object.entries({ prompt_tokens: 'promptTokenCount', completion_tokens: 'candidatesTokenCount', total_tokens: 'totalTokenCount' })) if (Number.isSafeInteger(result.usageMetadata?.[source]) && result.usageMetadata[source] >= 0) usage[target] = result.usageMetadata[source];
    return { text: text.replaceAll(token, '[REDACTED]'), usage, status: candidate.finishReason === 'STOP' ? 'completed' : 'partial', checkedAt: new Date().toISOString() };
  }
}
module.exports = { GoogleAccounts, clientConfig };
