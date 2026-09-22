const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app;
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: process.env.BTK_DESKTOP_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(process.env.BTK_DESKTOP_TEST_EXE ? [] : [root]), `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-layout-'))}`], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '개인용 Personal' }).click();
  await page.getByLabel('모델 ID', { exact: true }).waitFor();
  await app.evaluate(({ app }) => {
    const { CodexConnection } = process.mainModule.require(app.getAppPath() + '/electron/codex.cjs');
    CodexConnection.prototype.state = async () => ({ connected: true, pending: false, plan: 'fixture', error: '' });
    CodexConnection.prototype.models = async () => [{ id: 'fixture-model', name: 'fixture-model' }];
    CodexConnection.prototype.complete = async () => ({ status: 'completed', text: 'Fixture reply', usage: {} });
  });
  await page.getByLabel('연결 방식', { exact: true }).selectOption('codex');
  await page.getByLabel('Codex 모델', { exact: true }).selectOption('fixture-model');
  await page.getByRole('button', { name: '모델 저장', exact: true }).click();
  await page.getByText('Codex 모델 저장됨', { exact: true }).waitFor();
  await page.getByRole('button', { name: '작업 공간', exact: true }).click();
  await page.getByLabel('개인 메시지', { exact: true }).fill('Hi');
  await page.getByRole('button', { name: '개인 메시지 전송', exact: true }).click();
  await page.getByText('Fixture reply', { exact: true }).waitFor();
  for (const width of [1440, 3143]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 1000), width);
    await page.waitForTimeout(200);
    const layout = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { x:r.x, y:r.y, width:r.width, height:r.height } : null; };
      return { width: innerWidth, names: document.querySelectorAll('.personal-agent-name').length, children: [...document.querySelector('.personal-workspace').children].map(e => e.className), chat: rect('.personal-chat'), summary: rect('.run-summary') };
    });
    console.log(JSON.stringify(layout));
    await page.screenshot({ path: path.join(root, `artifacts/layout-transition-${width}.png`) });
    assert.equal(layout.names, 0, 'settings name form must unmount');
    assert.ok(layout.chat.width > 600, 'chat owns the flexible column');
    assert.ok(layout.summary.x >= layout.chat.x + layout.chat.width - 1, 'summary remains at right');
  }
  for (const zoom of [0.8, 1.25, 1.5]) {
    await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), zoom);
    await page.getByRole('button', { name: '모델 연결', exact: true }).click();
    await page.getByRole('heading', { name: 'ChatGPT 연결', exact: true }).waitFor();
    await page.getByRole('button', { name: '작업 공간', exact: true }).click();
    assert.equal(await page.locator('.personal-agent-name').count(), 0);
    assert.equal(await page.locator('.personal-workspace > .personal-chat').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setMinimumSize(0, 0); w.setSize(390, 780); });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.personal-agent-name').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(root, 'artifacts/layout-transition-390.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', actualProviderRequests: false, checks: ['codex-settings-chat-transition', 'no-orphan-settings-form', 'summary-right-column', 'repeated-navigation-at-80-125-150-percent-zoom', 'mobile'] }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await app?.close(); });
