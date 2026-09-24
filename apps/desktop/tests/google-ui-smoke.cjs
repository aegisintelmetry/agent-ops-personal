const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-google-ui-'));
const clientFile = path.join(directory, 'fixture-client.json');
fs.writeFileSync(clientFile, JSON.stringify({ installed: { client_id: 'fixture.apps.googleusercontent.com', client_secret: 'fixture-client-secret', project_id: 'fixture-project' } }));
const errors = [];
let app;
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.BTK_DESKTOP_TEST_EXE;
  if (executable) env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  app = await _electron.launch({ executablePath: executable || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(executable ? [] : [root]), `--user-data-dir=${directory}`], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); return page;
}
(async () => {
  let page = await launch(); await page.getByRole('button', { name: '개인용 Personal' }).click();
  await app.evaluate(({ app, dialog, shell }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    global.googleFixtureBrowserAttempts = 0;
    shell.openExternal = async url => {
      global.googleFixtureUrl = url;
      if (++global.googleFixtureBrowserAttempts === 1) throw new Error('fixture browser unavailable');
    };
    const { GoogleAccounts } = process.mainModule.require(app.getAppPath() + '/electron/google-accounts.cjs');
    const original = GoogleAccounts.prototype.client;
    GoogleAccounts.prototype.client = function (...args) {
      const client = original.apply(this, args);
      client.getToken = async () => ({ tokens: { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expiry_date: Date.now() + 3600000 } });
      return client;
    };
  }, clientFile);
  await page.getByLabel('연결 방식', { exact: true }).selectOption('google');
  await page.getByLabel('새 연결 이름').fill('Shared Gemini');
  await page.getByRole('button', { name: 'OAuth 클라이언트 가져오기' }).click();
  // Imported-but-unbound accounts must remain selectable after remounting.
  await page.reload();
  await page.getByRole('button', { name: '모델 연결', exact: true }).click();
  await page.getByRole('button', { name: 'Google로 로그인' }).waitFor();
  await page.getByRole('button', { name: 'Google로 로그인' }).click();
  await page.getByText('브라우저 로그인 대기 중', { exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: '브라우저를 열지 못했습니다.' }).waitFor();
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/google-login-recovery.png') });
  await page.reload();
  await page.getByRole('button', { name: '모델 연결', exact: true }).click();
  await page.getByText('브라우저 로그인 대기 중', { exact: true }).waitFor();
  await page.getByRole('button', { name: '브라우저 다시 열기', exact: true }).click();
  assert.equal(await app.evaluate(() => global.googleFixtureBrowserAttempts), 2);
  assert.equal(await page.evaluate(async () => { try { await window.btk.personal.agents.create('forbidden'); return false; } catch { return true; } }), true);
  const auth = new URL(await app.evaluate(() => global.googleFixtureUrl));
  const callback = new URL(auth.searchParams.get('redirect_uri'));
  callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'fixture-code');
  await fetch(callback);
  await page.getByText('연결됨', { exact: true }).waitFor();
  await page.getByLabel('Gemini 모델 ID', { exact: true }).fill('gemini-master-fixture');
  await page.getByRole('button', { name: '모델 저장', exact: true }).click();
  await page.getByText('설정 저장됨 · 연결 미검증', { exact: true }).waitFor();
  const accountId = await page.evaluate(async () => (await window.btk.personal.state()).accountId);
  assert.ok(accountId);
  const worker = await page.evaluate(async () => window.btk.personal.agents.create('Gemini worker'));
  await page.reload();
  await page.getByLabel('연결 방식', { exact: true }).selectOption('google');
  await page.getByLabel('연결 계정', { exact: true }).selectOption(accountId);
  await page.getByLabel('Gemini 모델 ID', { exact: true }).fill('gemini-worker-fixture');
  await page.getByRole('button', { name: '모델 저장', exact: true }).click();
  await page.getByText('설정 저장됨 · 연결 미검증', { exact: true }).waitFor();
  const accounts = await page.evaluate(async id => window.btk.personal.google.state(id), worker.agentId);
  assert.equal(accounts.accounts.length, 1); assert.equal(accounts.accounts[0].agents.length, 2);
  assert.ok(!JSON.stringify(accounts).includes('fixture-refresh'));
  assert.equal(await page.evaluate(async () => { try { await window.btk.personal.google.model('default', {}); return false; } catch { return true; } }), true);
  await app.evaluate(({ app, dialog }, workerId) => {
    dialog.showMessageBox = async () => ({ response: 1 });
    global.googleFixtureCalls = [];
    const { GoogleAccounts } = process.mainModule.require(app.getAppPath() + '/electron/google-accounts.cjs');
    GoogleAccounts.prototype.complete = async function (messages, config) {
      global.googleFixtureCalls.push({ model: config.model, accountId: config.accountId });
      const text = messages[0].content.startsWith('Plan') ? JSON.stringify({ tasks: [{ agentId: workerId, task: 'Fixture task' }] }) : 'Fixture result';
      return { text, status: 'completed', usage: {}, checkedAt: new Date().toISOString() };
    };
  }, worker.agentId);
  await page.evaluate(async workerId => window.btk.personal.team.start({ masterId: 'default', workerIds: [workerId], objective: 'Fixture team' }), worker.agentId);
  await page.waitForFunction(async () => (await window.btk.personal.team.state())?.status === 'completed');
  const calls = await app.evaluate(() => global.googleFixtureCalls);
  assert.deepEqual(calls.map(c => c.model), ['gemini-master-fixture', 'gemini-worker-fixture', 'gemini-master-fixture']);
  assert.ok(calls.every(c => c.accountId === accountId));
  await page.getByRole('button', { name: '작업 공간', exact: true }).click();
  await page.getByLabel('개인 메시지', { exact: true }).fill('Fixture personal chat');
  assert.equal(await page.getByRole('button', { name: '개인 메시지 전송', exact: true }).isEnabled(), true, 'A connected Google account must enable personal chat without an API key');
  await page.getByRole('button', { name: '개인 메시지 전송', exact: true }).click();
  await page.locator('.personal-message.assistant').filter({ hasText: 'Fixture result' }).waitFor();
  assert.equal((await app.evaluate(() => global.googleFixtureCalls)).length, 4);
  await page.getByRole('button', { name: '모델 연결', exact: true }).click();
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  for (const width of [1440, 390]) {
    await app.evaluate(({ BrowserWindow }, width) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(0, 0); w.setSize(width, 900); }, width);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(root, `artifacts/google-accounts-${width}.png`) });
  }
  await page.getByLabel('언어 / Language', { exact: true }).selectOption('en');
  await page.getByRole('heading', { name: 'Gemini sign-in connection' }).waitFor();
  await app.close(); app = null;
  page = await launch(); await page.getByRole('button', { name: 'Model connection', exact: true }).click();
  await page.getByRole('heading', { name: 'Gemini sign-in connection' }).waitFor();
  assert.equal(await page.getByLabel('Connection account', { exact: true }).inputValue(), accountId);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.getByRole('button', { name: 'Remove connection account', exact: true }).click();
  await page.waitForFunction(async () => !(await window.btk.personal.state()).accountConfigured);
  assert.ok((await page.evaluate(async () => window.btk.personal.team.configuration())).agents.every(a => !a.configured));
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByLabel('Personal message', { exact: true }).fill('Disconnected account');
  assert.equal(await page.getByRole('button', { name: 'Send personal message', exact: true }).isEnabled(), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', import: true, mockBrowserLogin: true, browserFailureRecovery: true, pendingSessionRestored: true, sharedMasterWorkerAccount: true, independentModels: true, restart: true, removal: true, widths: [1440, 390], actualProviderRequests: false }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await app?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
