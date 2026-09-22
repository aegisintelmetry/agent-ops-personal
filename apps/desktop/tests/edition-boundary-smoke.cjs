const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { METHODS } = require('../electron/bridge.cjs');
const root = path.resolve(__dirname, '..');
const packaged = process.env.BTK_DESKTOP_TEST_EXE;

(async () => {
  const results = [];
  for (const corrupt of [false, true]) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ops-boundary-'));
    if (corrupt) {
      const directory = path.join(profile, 'agent-ops-personal');
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'agents.json'), '{invalid');
    }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const key of Object.keys(env)) {
      if (/BTK|MCP|OPENAI|ANTHROPIC|TOKEN|SECRET|API_KEY/i.test(key)) delete env[key];
    }
    const app = await _electron.launch({
      executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'),
      args: [...(packaged ? [] : [root]), `--user-data-dir=${profile}`], env,
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => Boolean(window.btk));
      // Exercise the registered handlers but never start the real core or network.
      await app.evaluate(({ app, ipcMain }, { methods }) => {
        const { Bridge } = process.mainModule.require(app.getAppPath() + '/electron/bridge.cjs');
        global.auditCalls = 0;
        Bridge.prototype.call = async function(method) { global.auditCalls++; return { method }; };
        global.auditHandlers = methods.map(method => [method, ipcMain._invokeHandlers.get(`btk:${method}`)]);
      }, { methods: [...METHODS] });
      const blocked = async () => app.evaluate(async ({ BrowserWindow }) => {
        const sender = BrowserWindow.getAllWindows()[0].webContents;
        const event = { sender, senderFrame: sender.mainFrame };
        const results = [];
        for (const [method, handler] of global.auditHandlers) {
          try { await handler(event, {}); results.push({ method, blocked: false }); }
          catch (error) { results.push({ method, blocked: error.message.includes('조직 연결 모드') }); }
        }
        return { results, calls: global.auditCalls };
      });
      const initial = await blocked();
      assert.ok(initial.results.every(result => result.blocked), JSON.stringify(initial));
      assert.equal(initial.calls, 0);
      if (!corrupt) {
        await page.evaluate(() => window.btk.personal.mode('personal'));
        assert.ok((await blocked()).results.every(result => result.blocked));
        await page.evaluate(() => window.btk.personal.mode('enterprise'));
        assert.deepEqual(await page.evaluate(() => window.btk.snapshot()), { method: 'snapshot' });
        await page.evaluate(() => window.btk.personal.mode('personal'));
        assert.ok((await blocked()).results.every(result => result.blocked));
      } else {
        assert.equal(await page.evaluate(async () => {
          try { await window.btk.personal.state(); return false; } catch { return true; }
        }), true);
      }
      results.push({ case: corrupt ? 'corrupt_settings' : 'edition_transitions', passed: true });
    } finally { await app.close(); }
  }
  console.log(JSON.stringify({ results, packaged: Boolean(packaged), realCoreRequests: 0 }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
