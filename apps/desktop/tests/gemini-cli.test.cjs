const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { GeminiCli, SETTINGS, childEnvironment, bundledCli } = require('../electron/gemini-cli.cjs');
const { AgentProfiles } = require('../electron/agents.cjs');
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-gemini-cli-'));
  const calls = [], children = [], launches = [];
  let adapter;
  const seed = () => {
    fs.mkdirSync(path.join(adapter.home, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(adapter.home, '.gemini', 'gemini-credentials.json'), JSON.stringify({ fixture: 'encrypted-fixture' }));
  };
  const spawnImpl = (exe, args, settings) => {
    launches.push({ exe, args, settings });
    const child = new EventEmitter(); children.push(child);
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; child.emit('exit', 0); };
    child.reply = (id, result) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
    child.stdin = new Writable({ write(chunk, _, cb) {
      const message = JSON.parse(chunk); calls.push(message);
      queueMicrotask(() => {
        if (message.method === 'initialize') child.reply(message.id, { protocolVersion: 1, authMethods: [{ id: 'oauth-personal' }] });
        if (message.method === 'authenticate' && !options.holdLogin) { seed(); child.reply(message.id, {}); }
        if (message.method === 'session/new') child.reply(message.id, { sessionId: `session-${children.length}` });
        if (message.method === 'session/set_model') child.reply(message.id, {});
        if (message.method === 'session/prompt' && !options.holdPrompt) {
          child.stdout.write(JSON.stringify({ method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Fixture response' } } } }) + '\n');
          child.reply(message.id, { stopReason: options.stopReason || 'end_turn' });
        }
      });
      cb();
    } });
    return child;
  };
  adapter = new GeminiCli({ directory, spawnImpl, timeoutMs: 1000 });
  t.after(async () => { await adapter.cancelLogin(); adapter.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { adapter, directory, calls, children, launches, seed };
}
test('Gemini CLI is bundled, lazy, isolates credentials and disables tools', t => {
  const f = fixture(t);
  assert.equal(f.adapter.state().runtimeAvailable, true); assert.equal(f.adapter.state().connected, false);
  assert.equal(f.launches.length, 0);
  assert.ok(fs.existsSync(bundledCli()));
  const env = childEnvironment(f.adapter.home);
  assert.equal(env.GEMINI_CLI_HOME, f.adapter.home);
  assert.equal(env.GEMINI_FORCE_FILE_STORAGE, 'true');
  assert.equal(env.GEMINI_API_KEY, undefined); assert.equal(env.GOOGLE_CLOUD_PROJECT, undefined);
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.CODEX_HOME, undefined);
  assert.deepEqual(SETTINGS.tools.core, []); assert.deepEqual(SETTINGS.mcpServers, {});
  assert.equal(SETTINGS.hooksConfig.enabled, false); assert.equal(SETTINGS.telemetry.enabled, false);
});
test('Gemini login uses the official OAuth ACP method, supports cancel and restart state', async t => {
  const f = fixture(t); assert.equal(f.adapter.login().pending, true);
  await f.adapter.loginTask;
  assert.equal(f.adapter.state().connected, true); assert.equal(f.adapter.state().pending, false);
  assert.equal(f.calls.find(c => c.method === 'authenticate').params.methodId, 'oauth-personal');
  assert.equal(new GeminiCli({ directory: f.directory }).state().connected, true);
  assert.equal(f.launches[0].settings.shell, false); assert.equal(f.launches[0].settings.windowsHide, true);
  assert.deepEqual(f.launches[0].args.slice(1), ['--acp']);
  await f.adapter.logout(); assert.equal(f.adapter.state().connected, false);
  const waiting = fixture(t, { holdLogin: true }); waiting.adapter.login();
  await new Promise(resolve => setImmediate(resolve));
  await waiting.adapter.cancelLogin();
  assert.equal(waiting.adapter.state().pending, false); assert.ok(waiting.children[0].killed);
});
test('Gemini requests freeze input and isolate concurrent master/worker sessions and models', async t => {
  const f = fixture(t); f.seed();
  const input = [{ role: 'user', content: 'original' }];
  const one = f.adapter.complete(input, { model: 'gemini-master-fixture' }, new AbortController().signal);
  input[0].content = 'mutated';
  const two = f.adapter.complete([{ role: 'user', content: 'worker only' }], { model: 'gemini-worker-fixture' }, new AbortController().signal);
  assert.equal((await one).text, 'Fixture response'); await two;
  assert.deepEqual(f.calls.filter(c => c.method === 'session/set_model').map(c => c.params.modelId), ['gemini-master-fixture', 'gemini-worker-fixture']);
  const prompts = f.calls.filter(c => c.method === 'session/prompt');
  assert.notEqual(prompts[0].params.sessionId, prompts[1].params.sessionId);
  assert.match(prompts[0].params.prompt[0].text, /original/); assert.doesNotMatch(prompts[1].params.prompt[0].text, /original/);
  assert.ok(f.children.every(c => c.killed));
});
test('Gemini rejects permission/file requests, secrets, cancelled and incomplete turns', async t => {
  const f = fixture(t, { holdPrompt: true }); f.seed();
  await assert.rejects(f.adapter.complete([{ role: 'user', content: 'sk-' + 'fixture'.repeat(5) }], { model: 'auto' }, new AbortController().signal), { code: 'transmission_blocked' });
  assert.equal(f.launches.length, 0);
  const controller = new AbortController();
  const request = f.adapter.complete([{ role: 'user', content: 'hello' }], { model: 'auto' }, controller.signal);
  const rejected = assert.rejects(request, /취소/);
  while (!f.calls.some(c => c.method === 'session/prompt')) await new Promise(resolve => setImmediate(resolve));
  f.adapter.receive({ id: 'permission', method: 'session/request_permission', params: {} });
  f.adapter.receive({ id: 'file', method: 'fs/read_text_file', params: { path: 'private' } });
  assert.deepEqual(f.calls.find(c => c.id === 'permission').result.outcome, { outcome: 'cancelled' });
  assert.equal(f.calls.find(c => c.id === 'file').error.code, -32601);
  controller.abort(); await rejected;
  const partial = fixture(t, { stopReason: 'max_turn_requests' }); partial.seed();
  await assert.rejects(partial.adapter.complete([{ role: 'user', content: 'hello' }], { model: 'auto' }, new AbortController().signal), /완료되지/);
});
test('Gemini shared login preserves per-agent models and API credentials without API fallback', async t => {
  const f = fixture(t); f.seed();
  const safeStorage = { isEncryptionAvailable: () => true };
  const agents = new AgentProfiles({ directory: f.directory, safeStorage, geminiCli: f.adapter });
  agents.service.setMode('personal'); agents.service.connection('gemini-cli'); agents.service.geminiModel('gemini-master-fixture');
  const worker = agents.create('worker'); agents.service.connection('gemini-cli'); agents.service.geminiModel('gemini-worker-fixture');
  assert.ok(agents.teamState().agents.every(a => a.configured));
  assert.equal(agents.open('default').state().model, 'gemini-master-fixture');
  assert.equal(agents.open(worker.agentId).state().model, 'gemini-worker-fixture');
  await assert.rejects(agents.service.complete([{ role: 'user', content: 'draw' }], { imageModel: 'gpt-image-1.5' }), /image_unsupported/);
  await f.adapter.logout(); assert.ok(agents.teamState().agents.every(a => !a.configured));
});
