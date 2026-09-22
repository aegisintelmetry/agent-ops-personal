const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'btk-deployment-ui-'));
const output = path.join(root, 'artifacts');

(async () => {
  let app;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: process.env.BTK_DESKTOP_TEST_EXE || path.join(root, 'release/win-unpacked/AEGIS Agent Ops Preview.exe'),
      args: [`--user-data-dir=${temporary}`], env,
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.btk?.native);
    await page.evaluate(() => window.btk.personal.mode('enterprise'));
    await page.reload();
    // Only substitute a read response in this disposable test process. No setup POST is made.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('btk:setup_status');
      ipcMain.handle('btk:setup_status', () => ({
        status: 'partial', steps: [{ id: 'health', label: '서비스 기동 검증', status: 'partial' }],
        deployment: { deploy_id: '28cf2e88-b7fb-48d7-8e37-b15fa9d27ff5' }, central_reporting: 'connected',
        activation: { status: 'started' }, heartbeat_status: 'idle', heartbeat_age_minutes: 0.2,
        error: '서비스 기동 검증 미완료: log_error_monitor.py',
      }));
    });
    await page.getByRole('button', { name: '설치 점검', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')]
      .find(button => button.textContent.includes('다시 점검'))?.disabled);
    await page.getByRole('heading', { name: '검증 미완료', exact: true }).waitFor();
    await page.getByText('28cf2e88-b7fb-48d7-8e37-b15fa9d27ff5', { exact: true }).waitFor();
    assert.ok((await page.locator('.setup-progress').innerText()).includes('idle / 0.2분 전'));
    const cdp = await page.context().newCDPSession(page);
    fs.mkdirSync(output, { recursive: true });
    for (const width of [390, 768, 1920]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1080, deviceScaleFactor: 1, mobile: false });
      await page.screenshot({ path: path.join(output, `deployment-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const overflow = await page.locator('.setup-progress').evaluate(e => e.scrollWidth > e.clientWidth + 1);
      assert.equal(overflow, false, `deployment report overflow at ${width}`);
    }
    console.log(JSON.stringify({ status: 'passed', widths: [390, 768, 1920],
      partial_not_completed: true, central_id_and_measured_heartbeat_visible: true, setup_actions_invoked: false }));
  } finally {
    if (app) await app.close();
    if (path.dirname(temporary) === path.resolve(os.tmpdir()))
      fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
