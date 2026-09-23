const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OAuth2Client } = require('google-auth-library');
const { GoogleAccounts, clientConfig } = require('../electron/google-accounts.cjs');
const { AgentProfiles } = require('../electron/agents.cjs');
const imported = { installed: { client_id: 'fixture.apps.googleusercontent.com', client_secret: 'fixture-client-secret', project_id: 'fixture-project' } };

test('Google redline blocks direct calls before credential refresh', async () => {
  let calls = 0;
  const store = Object.create(GoogleAccounts.prototype);
  store.credential = async () => { calls++; throw new Error('unexpected refresh'); };
  store.fetch = async () => { calls++; throw new Error('unexpected fetch'); };
  await assert.rejects(store.complete([{ role: 'user', content: 'sk-' + 'fixture'.repeat(5) }], {}, new AbortController().signal), { code: 'transmission_blocked' });
  assert.equal(calls, 0);
});

test('Google freezes messages across credential refresh and blocks token echoes', async () => {
  const store = Object.create(GoogleAccounts.prototype);
  const messages = [{ role: 'user', content: 'safe' }];
  const config = { accountId: 'fixture', model: 'gemini-fixture', maxTokens: 128 };
  let calls = 0;
  store.credential = async () => { messages[0].content = 'sk-' + 'fixture'.repeat(5); config.model = 'changed'; return { token: 'fixture-token', project: 'fixture-project' }; };
  store.fetch = async (url, options) => {
    calls++; assert.ok(url.includes('gemini-fixture'));
    assert.equal(JSON.parse(options.body).contents[0].parts[0].text, 'safe');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'safe response' }] }, finishReason: 'STOP' }] }));
  };
  await store.complete(messages, config, new AbortController().signal);
  await assert.rejects(store.complete([{ role: 'user', content: 'fixture-token' }], config, new AbortController().signal), { code: 'transmission_blocked' });
  assert.equal(calls, 1);
});
function fixture(t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-google-'));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split('').reverse().join('')), decryptString: value => value.toString().split('').reverse().join('') };
  const calls = [], browsers = [], exchanges = [];
  const options = { directory, safeStorage, openExternal: async url => browsers.push(new URL(url)),
    clientFactory: options => {
      const client = new OAuth2Client(options);
      client.getToken = async params => { exchanges.push(params); return { tokens: { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expiry_date: Date.now() + 3600000 } }; };
      client.getAccessToken = async () => ({ token: 'fixture-access' });
      return client;
    },
    fetchImpl: async (url, options) => { calls.push({ url, ...options }); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini response' }] }, finishReason: 'STOP' }] })); }, ...extra };
  const store = new GoogleAccounts(options);
  t.after(() => { store.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, options, calls, browsers, exchanges };
}
function seed(store) {
  store.import(imported, 'Shared Gemini'); const data = store.load();
  data.accounts[0].tokens = { refresh_token: 'fixture-refresh', access_token: 'fixture-access' }; store.write(data);
  return data.accounts[0].id;
}
async function callback(f, query = {}) {
  const auth = f.browsers.at(-1); const url = new URL(auth.searchParams.get('redirect_uri'));
  url.searchParams.set('state', auth.searchParams.get('state')); url.searchParams.set('code', 'fixture-code');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return fetch(url);
}
test('Google import is encrypted, bounded, rejects web clients, and does not start networking', t => {
  const f = fixture(t); f.store.import(imported, 'Shared Gemini');
  assert.equal(f.browsers.length, 0); assert.equal(f.calls.length, 0);
  assert.ok(!fs.readFileSync(f.store.file).includes(Buffer.from('fixture-client-secret')));
  assert.ok(!JSON.stringify(f.store.state()).includes('client_secret'));
  assert.deepEqual(new GoogleAccounts(f.options).state(), f.store.state());
  assert.throws(() => clientConfig({ web: imported.installed }));
  assert.throws(() => f.store.import(imported, ''));
  assert.equal(clientConfig({ installed: { ...imported.installed, token_uri: 'https://evil.invalid' } }).token_uri, undefined);
});
test('Google browser login uses PKCE, loopback and state, never leaks tokens to renderer', async t => {
  const f = fixture(t); const id = seed(f.store); await f.store.login(id);
  const url = f.browsers[0]; assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.equal((await callback(f, { state: 'wrong' })).status, 400);
  assert.equal(f.exchanges.length, 0); assert.equal(f.store.state().loginId, id);
  await callback(f); assert.equal(f.exchanges.length, 1);
  assert.ok(f.exchanges[0].codeVerifier.length >= 43);
  assert.equal(f.store.state().loginId, null); assert.equal(f.store.has(id), true);
  assert.ok(!JSON.stringify(f.store.state()).includes('fixture-refresh'));
});
test('Google cancellation and timeout close listeners without erasing existing credentials', async t => {
  const f = fixture(t, { loginTimeoutMs: 30 }); const id = seed(f.store);
  await f.store.login(id); f.store.cancelLogin();
  await assert.rejects(callback(f)); assert.equal(f.store.has(id), true);
  await f.store.login(id); await new Promise(r => setTimeout(r, 50));
  assert.equal(f.store.state().loginId, null); assert.match(f.store.state().error, /초과/);
  await assert.rejects(callback(f));
});
test('cancel during OAuth exchange cannot save late credentials', async t => {
  let finish;
  const f = fixture(t, { clientFactory: options => {
    const client = new OAuth2Client(options); client.getToken = () => new Promise(resolve => { finish = resolve; }); return client;
  } });
  f.store.import(imported, 'New'); const id = f.store.state().accounts[0].id;
  await f.store.login(id); const request = callback(f).catch(() => null);
  while (!finish) await new Promise(r => setTimeout(r, 1));
  f.store.cancelLogin(); finish({ tokens: { access_token: 'late', refresh_token: 'late' } });
  await request; assert.equal(f.store.has(id), false);
});
test('shared Google account supports independent agent models/messages and legacy API restoration', async t => {
  const f = fixture(t); const id = seed(f.store);
  const profiles = new AgentProfiles({ ...f.options, googleAccounts: f.store }); profiles.service.setMode('personal');
  profiles.service.save({ provider: 'local', endpoint: 'http://127.0.0.1:8888/v1', model: 'legacy', maxTokens: 1024 });
  profiles.service.googleModel({ accountId: id, model: 'gemini-master-fixture', maxTokens: 512 });
  const master = profiles.service;
  const worker = profiles.create('worker'); profiles.service.googleModel({ accountId: id, model: 'gemini-worker-fixture', maxTokens: 1024 });
  await Promise.all([master.complete([{ role: 'user', content: 'master-private' }]), profiles.service.complete([{ role: 'user', content: 'worker-private' }])]);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.includes('gemini-master-fixture')); assert.ok(!f.calls[0].body.includes('worker-private'));
  assert.ok(f.calls[1].url.includes('gemini-worker-fixture')); assert.ok(!f.calls[1].body.includes('master-private'));
  assert.equal(f.calls[0].headers['x-goog-user-project'], 'fixture-project'); assert.equal(f.calls[0].redirect, 'error');
  assert.ok(profiles.teamState().agents.every(a => a.configured));
  assert.equal(profiles.open(worker.agentId).state().accountId, id);
  master.connection('api'); assert.equal(master.state().model, 'legacy');
  f.store.remove(id); assert.equal(profiles.service.state().accountConfigured, false);
  await assert.rejects(profiles.service.complete([{ role: 'user', content: 'no account' }]));
});
test('Google errors never expose upstream body and partial responses remain partial', async t => {
  const f = fixture(t); const id = seed(f.store); const input = [{ role: 'user', content: 'hello' }];
  const config = { accountId: id, model: 'gemini-fixture', maxTokens: 1024 };
  f.store.fetch = async () => new Response('fixture-refresh', { status: 429 });
  await assert.rejects(f.store.complete(input, config, new AbortController().signal), /한도/);
  f.store.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'fixture-access' }] }, finishReason: 'MAX_TOKENS' }] }));
  const result = await f.store.complete(input, config, new AbortController().signal);
  assert.equal(result.status, 'partial'); assert.equal(result.text, '[REDACTED]');
});
test('Google unavailable secure storage and corrupt files fail closed', t => {
  const f = fixture(t); seed(f.store); const before = fs.readFileSync(f.store.file);
  f.options.safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => f.store.remove(f.store.state().accounts[0].id)); assert.deepEqual(fs.readFileSync(f.store.file), before);
  f.options.safeStorage.isEncryptionAvailable = () => true;
  fs.writeFileSync(f.store.file, 'corrupt'); assert.throws(() => f.store.import(imported, 'New'));
  assert.equal(fs.readFileSync(f.store.file, 'utf8'), 'corrupt');
});
test('Google refresh is persisted without losing the refresh token', async t => {
  let client;
  const f = fixture(t, { clientFactory: options => {
    client = new OAuth2Client(options); client.getAccessToken = async () => {
      client.emit('tokens', { access_token: 'refreshed-access', expiry_date: Date.now() + 3600000 }); return { token: 'refreshed-access' };
    }; return client;
  } });
  const id = seed(f.store); await f.store.credential(id);
  assert.equal(f.store.load().accounts[0].tokens.refresh_token, 'fixture-refresh');
  assert.equal(new GoogleAccounts(f.options).load().accounts[0].tokens.access_token, 'refreshed-access');
  assert.equal(client.transporter.defaults.timeout, 30000);
});
