const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const previous = process.env.BTK_DESKTOP_PREVIOUS_EXE;
const candidate = process.env.BTK_DESKTOP_TEST_EXE;
const installUpgrade = process.argv.includes('--install-upgrade');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-upgrade-'));
const requests = [];
const errors = [];
let app, server;
async function launch(executable) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(BTK_|MCP_|NUXT_PUBLIC_BTK_|CLAUDE|ANTHROPIC_|OPENAI_|PYTHON|ELECTRON_RUN_AS_NODE)/i.test(key)) delete env[key];
  }
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  env.BTK_CONFIG_HOME = path.join(directory, 'empty-core');
  app = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${directory}`], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.btk));
  return page;
}
function savedFiles() {
  const files = new Map();
  function read(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) read(file);
      else files.set(path.relative(directory, file), fs.readFileSync(file));
    }
  }
  read(path.join(directory, 'agent-ops-personal'));
  files.set('ui-preferences.json', fs.readFileSync(path.join(directory, 'ui-preferences.json')));
  return files;
}
(async () => {
  assert.ok(previous && candidate, 'Set previous and candidate package executable paths');
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push({ body: JSON.parse(raw), correctKey: req.headers.authorization === 'Bearer fixture-upgrade-key' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'Upgrade fixture response' }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let page = await launch(previous);
  const from = await app.evaluate(({ app }) => app.getVersion());
  const baseline = await page.evaluate(async endpoint => {
    const p = window.btk.personal;
    await p.mode('personal');
    await p.save({ provider: 'local', endpoint, model: 'upgrade-master', maxTokens: 512, apiKey: 'fixture-upgrade-key' });
    await p.knowledge.prompt('default', 'Upgrade role');
    await p.knowledge.save('default', { title: 'Upgrade memory', content: 'Preserved fixture context', scope: 'global', enabled: true });
    const worker = await p.agents.create('Upgrade worker');
    await p.save({ provider: 'local', endpoint, model: 'upgrade-worker', maxTokens: 512 });
    await p.team.configure({ masterId: 'default', workerIds: [worker.agentId] });
    await p.agents.select('default');
    await window.btk.preferences.save('en');
    return { state: await p.state(), team: await p.team.configuration(), knowledge: await p.knowledge.read('default'), preferences: await window.btk.preferences.read() };
  }, `http://127.0.0.1:${server.address().port}/v1`);
  assert.equal(requests.length, 0);
  await app.close(); app = null;
  const files = savedFiles();
  for (const data of files.values()) assert.ok(!data.includes(Buffer.from('fixture-upgrade-key')));
  if (installUpgrade) {
    assert.equal(process.platform, 'win32');
    assert.equal(path.resolve(previous), path.resolve(candidate), 'Installer upgrade must target the same test installation');
    const target = path.dirname(path.resolve(candidate));
    assert.equal(target, path.resolve(process.env.BTK_DESKTOP_INSTALL_TEST_ROOT || ''), 'Explicit test installation root required');
    assert.ok(process.env.BTK_DESKTOP_UPGRADE_INSTALLER && fs.statSync(process.env.BTK_DESKTOP_UPGRADE_INSTALLER).isFile());
    execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference="Stop"
$p=Start-Process -FilePath $env:BTK_DESKTOP_UPGRADE_INSTALLER -ArgumentList @("/S",("/D="+$env:BTK_DESKTOP_INSTALL_TEST_ROOT)) -WindowStyle Hidden -Wait -PassThru
exit $p.ExitCode`,
    ], { windowsHide: true, timeout: 180000, stdio: 'pipe', env: { ...process.env, BTK_DESKTOP_INSTALL_TEST_ROOT: target } });
  }
  page = await launch(candidate);
  const to = await app.evaluate(({ app }) => app.getVersion());
  assert.equal(to, require('../package.json').version);
  const restored = await page.evaluate(async () => {
    const p = window.btk.personal;
    return { state: await p.state(), team: await p.team.configuration(), knowledge: await p.knowledge.read('default'), preferences: await window.btk.preferences.read() };
  });
  assert.deepEqual(restored, baseline);
  assert.deepEqual(savedFiles(), files, 'Opening a new version must not rewrite saved settings');
  assert.equal(requests.length, 0, 'Restart must not invoke a provider');
  await page.getByLabel('Personal message', { exact: true }).fill('Upgrade verification');
  await page.getByRole('button', { name: 'Send personal message', exact: true }).click();
  await page.locator('.personal-message.assistant').filter({ hasText: 'Upgrade fixture response' }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].correctKey, true, 'The existing OS-encrypted key must still decrypt');
  assert.equal(requests[0].body.model, 'upgrade-master');
  assert.ok(requests[0].body.messages.some(row => row.content.includes('Upgrade role')));
  assert.ok(requests[0].body.messages.some(row => row.content.includes('Preserved fixture context')));
  await app.close(); app = null;
  page = await launch(candidate);
  await page.getByLabel('Personal message', { exact: true }).waitFor();
  assert.equal(await page.locator('.personal-message').count(), 0, 'Conversation persistence is not implemented');
  assert.equal(requests.length, 1);
  assert.deepEqual(errors, []);
  const report = { status: 'passed', from, to, installerExecuted: installUpgrade, noDevelopmentRuntimeOnPath: true,
    preserved: ['agents', 'models', 'encrypted-key', 'team', 'role', 'memory', 'language'], startupRequests: 0,
    fixtureRequests: 1, realProviderRequests: 0, conversationsPersisted: false };
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, `artifacts/upgrade-smoke-${from}-to-${to}${installUpgrade ? '-installed' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});
