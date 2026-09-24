const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-updates-ui-'));
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.BTK_DESKTOP_TEST_EXE;
  const app = await _electron.launch({ executablePath: executable || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(executable ? [] : [root]), `--user-data-dir=${directory}`], env });
  const errors = [];
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('button', { name: '개인용 Personal' }).click();
    await app.evaluate(({ app, dialog }) => {
      const updater = process.mainModule.require(app.getAppPath() + '/node_modules/electron-updater').autoUpdater;
      global.updateFixture = { downloads: 0, installs: 0, checks: 0, accept: false };
      updater.checkForUpdates = async () => { global.updateFixture.checks++; updater.emit('update-available', { version: '0.5.16' }); };
      updater.downloadUpdate = async () => { global.updateFixture.downloads++; updater.emit('download-progress', { percent: 55 }); updater.emit('update-downloaded'); };
      updater.quitAndInstall = () => global.updateFixture.installs++;
      dialog.showMessageBox = async () => ({ response: global.updateFixture.accept ? 1 : 0 });
      // Source builds are deliberately disabled; events exercise their UI only.
      if (!app.isPackaged) updater.emit('update-available', { version: '0.5.16' });
    });
    await page.getByRole('button', { name: /앱 업데이트|업데이트 가능/, exact: true }).click();
    if (executable) await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
    await page.getByText('새 버전 사용 가능', { exact: true }).waitFor();
    assert.equal(await app.evaluate(() => global.updateFixture.downloads), 0);
    await page.getByRole('button', { name: '다운로드', exact: true }).click();
    await page.getByText('업데이트 설치 준비 완료', { exact: true }).waitFor();
    await page.getByRole('button', { name: '재시작 및 설치', exact: true }).click();
    assert.equal(await app.evaluate(() => global.updateFixture.installs), 0);
    await app.evaluate(() => { global.updateFixture.accept = true; });
    await page.getByRole('button', { name: '재시작 및 설치', exact: true }).click();
    assert.equal(await app.evaluate(() => global.updateFixture.installs), 1);
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts/updates-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.screenshot({ path: path.join(root, 'artifacts/updates-mobile.png') });
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.evaluate(() => window.btk.preferences.save('en')); await page.reload();
    await page.getByRole('button', { name: 'Update available', exact: true }).click();
    await page.getByRole('dialog', { name: 'App updates' }).waitFor();
    await page.getByText('Update ready to install', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', packaged: Boolean(executable), downloadConsent: true, installCancelAndConfirm: true, widths: [1360, 390], languages: ['ko', 'en'], realUpdateInstall: false }));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
