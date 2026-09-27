const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-gemini-cli-ui-'));
const errors = [];
let app;
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const exe = process.env.BTK_DESKTOP_TEST_EXE;
  if (exe) env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  app = await _electron.launch({ executablePath: exe || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(exe ? [] : [root]), `--user-data-dir=${directory}`], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); return page;
}
(async () => {
  let page = await launch(); await page.getByRole('button', { name: '개인용 Personal' }).click();
  // The real bundled CLI must initialize without installed Node, login, or a model call.
  await app.evaluate(async ({ app }) => {
    const { GeminiCli } = process.mainModule.require(app.getAppPath() + '/electron/gemini-cli.cjs');
    const path = process.mainModule.require('node:path');
    const cli = new GeminiCli({ directory: path.join(app.getPath('userData'), 'runtime-probe') });
    try { await cli.start(); if (cli.state().connected) throw new Error('Unexpected credentials'); }
    finally { cli.stop(); }
  });
  await app.evaluate(({ app, dialog }) => {
    const fs = process.mainModule.require('node:fs'), path = process.mainModule.require('node:path');
    const { GeminiCli } = process.mainModule.require(app.getAppPath() + '/electron/gemini-cli.cjs');
    global.geminiFixtureLogins = 0; global.geminiFixtureCalls = [];
    dialog.showMessageBox = async () => ({ response: 1 });
    GeminiCli.prototype.login = function () { global.geminiFixtureLogins++; this.pending = true; global.geminiFixturePending = this; return this.state(); };
    global.finishGeminiFixture = () => {
      const cli = global.geminiFixturePending; cli.prepare();
      fs.writeFileSync(path.join(cli.home, '.gemini', 'gemini-credentials.json'), JSON.stringify({ fixture: 'encrypted-fixture' }));
      cli.pending = false;
    };
    GeminiCli.prototype.complete = async function (messages, config) {
      global.geminiFixtureCalls.push({ messages, model: config.model });
      return { text: `Fixture ${config.model}`, status: 'completed', usage: {}, checkedAt: new Date().toISOString() };
    };
  });
  await page.getByLabel('연결 방식', { exact: true }).selectOption('gemini-cli');
  const login = page.getByRole('button', { name: 'Google로 로그인', exact: true });
  await login.waitFor();
  assert.equal(await page.getByRole('button', { name: /OAuth 클라이언트/ }).count(), 0);
  assert.equal(await page.getByLabel('Gemini 모델 ID', { exact: true }).inputValue(), 'auto');
  await login.click(); await page.getByText('브라우저 로그인 대기 중', { exact: true }).waitFor();
  await page.getByRole('button', { name: '로그인 취소', exact: true }).click();
  await page.getByText('로그인 필요', { exact: true }).waitFor();
  await login.click(); await page.getByText('브라우저 로그인 대기 중', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => { try { await window.btk.personal.agents.create('blocked'); return false; } catch { return true; } }), true);
  await app.evaluate(() => global.finishGeminiFixture());
  await page.getByText('연결됨', { exact: true }).waitFor();
  await page.getByLabel('Gemini 모델 ID', { exact: true }).fill('gemini-master-fixture');
  await page.getByRole('button', { name: '모델 저장', exact: true }).click();
  await page.getByText('설정 저장됨 · 연결 미검증', { exact: true }).waitFor();
  const worker = await page.evaluate(() => window.btk.personal.agents.create('Gemini worker'));
  await page.reload(); await page.getByLabel('연결 방식', { exact: true }).selectOption('gemini-cli');
  await page.getByText('연결됨', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => global.geminiFixtureLogins), 2);
  await page.getByLabel('Gemini 모델 ID', { exact: true }).fill('gemini-worker-fixture');
  await page.getByRole('button', { name: '모델 저장', exact: true }).click();
  await page.getByText('설정 저장됨 · 연결 미검증', { exact: true }).waitFor();
  const team = await page.evaluate(() => window.btk.personal.team.configuration());
  assert.deepEqual(team.agents.map(a => a.model), ['gemini-master-fixture', 'gemini-worker-fixture']);
  assert.ok(team.agents.every(a => a.configured));
  assert.equal(await page.evaluate(async () => { try { await window.btk.personal.gemini.model('default', 'auto'); return false; } catch { return true; } }), true);
  await page.getByRole('button', { name: '작업 공간', exact: true }).click();
  await page.getByLabel('개인 메시지', { exact: true }).fill('Fixture chat');
  await page.getByRole('button', { name: '개인 메시지 전송', exact: true }).click();
  await page.locator('.personal-message.assistant').filter({ hasText: 'Fixture gemini-worker-fixture' }).waitFor();
  assert.equal((await app.evaluate(() => global.geminiFixtureCalls)).length, 1);
  await page.getByRole('button', { name: '모델 연결', exact: true }).click();
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  for (const width of [1440, 390]) {
    await app.evaluate(({ BrowserWindow }, width) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(0, 0); window.setSize(width, 900); }, width);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(root, `artifacts/gemini-cli-${width}.png`) });
  }
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.getByRole('heading', { name: 'Gemini account connection', exact: true }).waitFor();
  await app.close(); app = null;
  page = await launch(); await page.getByRole('button', { name: 'Model connection', exact: true }).click();
  await page.getByRole('heading', { name: 'Gemini account connection', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Gemini model ID', { exact: true }).inputValue(), 'gemini-worker-fixture');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByText('Sign-in required', { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => window.btk.personal.team.configuration())).agents.every(a => !a.configured));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', packaged: Boolean(process.env.BTK_DESKTOP_TEST_EXE), realRuntimeInitialize: true, noClientJson: true, cancel: true, sharedLogin: true, separateModels: true, chat: true, restart: true, logoutAllAgents: true, fixtureModelCalls: 1, realModelCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await app?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
