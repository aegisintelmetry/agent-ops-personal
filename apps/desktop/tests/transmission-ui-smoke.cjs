const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.env.BTK_DESKTOP_TEST_EXE;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-transmission-'));
const artifacts = path.join(root, 'artifacts');
let app, server, calls = 0;
(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  server = http.createServer((_req, res) => { calls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'Fixture response' }, finish_reason: 'stop' }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(packaged ? [] : [root]), `--user-data-dir=${profile}`], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.btk));
  await page.evaluate(async endpoint => {
    await window.btk.personal.mode('personal');
    await window.btk.personal.save({ provider: 'local', endpoint, model: 'fixture', maxTokens: 512 });
  }, endpoint);
  for (const [language, width, label, button, expected] of [
    ['ko', 1440, '개인 메시지', '개인 메시지 전송', '보안 정책으로 전송을 차단했습니다.'],
    ['en', 390, 'Personal message', 'Send personal message', 'Transmission blocked by security policy.'],
  ]) {
    await page.evaluate(language => window.btk.preferences.save(language), language);
    await page.reload();
    await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(width, 900); }, width);
    await page.waitForFunction(width => innerWidth <= width, width);
    await page.waitForTimeout(150);
    const navigation = page.locator('.personal-nav-scrim');
    if (await navigation.isVisible()) await navigation.click();
    await page.getByLabel(label, { exact: true }).fill('sk-' + 'fixture'.repeat(5));
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.getByRole('alert').filter({ hasText: expected }).waitFor();
    assert.equal(calls, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(artifacts, `transmission-${language}-${width}.png`) });
  }
  console.log(JSON.stringify({ status: 'passed', packaged: Boolean(packaged), blockedRequests: 2, modelRequests: calls, languages: ['ko', 'en'] }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});
