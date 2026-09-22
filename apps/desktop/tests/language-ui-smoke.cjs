const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-language-ui-'));
const packaged = process.env.BTK_DESKTOP_TEST_EXE;
const errors = [];
let app;
async function launch() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/BTK|MCP|OPENAI|ANTHROPIC|TOKEN|SECRET|API_KEY|ELECTRON_RUN_AS_NODE/i.test(key)) delete env[key];
  env.BTK_CONFIG_HOME = path.join(directory, 'empty-core');
  const buildPython = path.join(root, '.build-venv', 'Scripts');
  if (!packaged && fs.existsSync(path.join(buildPython, 'python.exe'))) env.PATH = `${buildPython};${env.PATH}`;
  app = await _electron.launch({ executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(packaged ? [] : [root]), `--user-data-dir=${directory}`], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByLabel('언어 / Language').waitFor();
  return page;
}
async function language(page, value) {
  await page.getByLabel('언어 / Language').selectOption(value);
  await page.waitForFunction(expected => document.documentElement.lang === expected, value);
}
async function viewport(page, width, height, name) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(320, 480); win.setSize(...size);
  }, [width, height]);
  await page.waitForTimeout(150);
  const geometry = await page.evaluate(() => {
    const select = document.querySelector('.language-control select').getBoundingClientRect();
    return { viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      select: { left: select.left, right: select.right, width: select.width } };
  });
  assert.ok(geometry.scroll <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.select.left >= 0 && geometry.select.right <= geometry.viewport + 1, JSON.stringify(geometry));
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts', `language-${name}.png`) });
}
(async () => {
  let page = await launch();
  assert.equal(await page.locator('html').getAttribute('lang'), 'ko');
  await language(page, 'en');
  await page.getByRole('button', { name: 'Personal Personal', exact: true }).click();
  await page.getByRole('heading', { name: 'Model connection', exact: true }).waitFor();
  await page.getByLabel('Provider', { exact: true }).selectOption('local');
  await page.getByLabel('Model ID', { exact: true }).fill('fixture-local');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Settings saved · connection not verified', { exact: true }).waitFor();
  await language(page, 'ko');
  await page.getByText('설정 저장됨 · 연결 미검증', { exact: true }).waitFor();
  await language(page, 'en');
  await app.evaluate(({ dialog }) => {
    global.languageDialogs = [];
    dialog.showMessageBox = async (_window, options) => { global.languageDialogs.push(options); return { response: 0 }; };
  });
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Connection test cancelled.' }).waitFor();
  const dialogs = await app.evaluate(() => global.languageDialogs);
  assert.equal(dialogs[0].title, 'Test model connection');
  assert.deepEqual(dialogs[0].buttons, ['Cancel', 'Test']);
  assert.match(dialogs[0].detail, /may charge API usage fees/);
  assert.equal(dialogs[0].cancelId, 0);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByLabel('Personal message', { exact: true }).fill('내 자료 English draft');
  const before = await page.evaluate(() => window.btk.personal.state());
  await language(page, 'ko');
  assert.equal(await page.getByLabel('개인 메시지', { exact: true }).inputValue(), '내 자료 English draft');
  await language(page, 'en');
  assert.equal(await page.getByLabel('Personal message', { exact: true }).inputValue(), '내 자료 English draft');
  assert.deepEqual(await page.evaluate(() => window.btk.personal.state()), before);
  await viewport(page, 1440, 900, 'en-desktop');
  await viewport(page, 390, 780, 'en-narrow');
  await language(page, 'ko');
  await viewport(page, 390, 780, 'ko-narrow');
  await language(page, 'en');
  await viewport(page, 1440, 900, 'en-restored');
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  if (!(await page.getByRole('button', { name: 'Connectors', exact: true }).isVisible())) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await page.getByLabel('Show sample', { exact: true }).check();
  await page.getByText('Sample data · not a live Slack connection', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Tools', exact: true }).waitFor();
  await viewport(page, 390, 780, 'en-connectors');
  await app.close(); app = null;
  page = await launch();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: 'Model connection', exact: true }).click();
  await app.evaluate(({ app }) => {
    const { CodexConnection } = process.mainModule.require(app.getAppPath() + '/electron/codex.cjs');
    CodexConnection.prototype.state = async () => ({ connected: false, pending: false, plan: '', error: '' });
  });
  await page.getByLabel('Connection method', { exact: true }).selectOption('codex');
  await page.getByRole('heading', { name: 'ChatGPT connection', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Sign-in required' }).waitFor();
  // Neither account sign-in nor a real provider request is performed.
  await page.getByRole('button', { name: 'Organization', exact: true }).click();
  await page.getByRole('button', { name: 'Setup checks', exact: true }).click();
  await page.getByRole('heading', { name: 'PC connection and service setup', exact: true }).waitFor();
  assert.equal(await page.getByLabel('언어 / Language').inputValue(), 'en');
  await page.getByLabel('Central server', { exact: true }).waitFor();
  const readiness = await page.evaluate(() => window.btk.readiness());
  assert.equal(readiness.release.bundled, Boolean(packaged));
  await page.getByRole('heading', { name: 'Desktop core', exact: true }).waitFor();
  await viewport(page, 1440, 900, 'en-enterprise');
  await language(page, 'ko');
  await page.getByRole('heading', { name: 'PC 연결 및 서비스 설치', exact: true }).waitFor();
  const rejected = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
    try { await ipcMain._invokeHandlers.get('btk:preferences:save')({ sender: BrowserWindow.getAllWindows()[0].webContents, senderFrame: { url: 'https://untrusted.invalid' } }, { language: 'en' }); return false; }
    catch { return true; }
  });
  assert.equal(rejected, true);
  assert.deepEqual(await page.evaluate(() => window.btk.preferences.read()), { language: 'ko' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', packaged: Boolean(packaged), checks: ['live_language_switch', 'draft_preserved', 'model_settings_unchanged', 'restart_persistence', 'native_confirmation', 'error_translation', 'slack_sample', 'codex_settings', 'enterprise_setup', 'desktop_narrow_layout', 'untrusted_ipc_rejected'], actualProviderRequests: false }));
})().catch(async error => {
  console.error(error.stack, JSON.stringify({ errors }));
  if (app) await (await app.firstWindow()).screenshot({ path: path.join(root, 'artifacts/language-failure.png') });
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });
