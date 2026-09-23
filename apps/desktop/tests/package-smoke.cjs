const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'btk-packaged-smoke-'));
const executable = process.env.BTK_DESKTOP_TEST_EXE || path.join(root, 'release/win-unpacked/AEGIS Agent Ops.exe');
fs.mkdirSync(output, { recursive: true });

async function check(fresh) {
  const resources = path.join(path.dirname(executable), 'resources');
  for (const name of ['LICENSE', 'NOTICE']) {
    assert.equal(fs.readFileSync(path.join(resources, name), 'utf8'),
      fs.readFileSync(path.resolve(root, '../..', name), 'utf8'), `${name} must match source`);
  }
  assert.ok(fs.statSync(path.join(resources, 'THIRD-PARTY-NOTICES.txt')).size > 0);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  // Prove the package boots without resolving node/python from the development PATH.
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  if (fresh) {
    for (const key of Object.keys(env)) {
      if (/^(BTK_|MCP_|NUXT_PUBLIC_BTK_|CLAUDE|ANTHROPIC_|OPENAI_)/i.test(key)) delete env[key];
    }
    env.BTK_CONFIG_HOME = path.join(temporary, 'empty-profile');
  }
  const instance = await _electron.launch({ executablePath: executable,
    args: [`--user-data-dir=${path.join(temporary, fresh ? 'fresh-ui' : 'configured-ui')}`],
    cwd: temporary, env, timeout: 45000 });
  const errors = [];
  try {
    const page = await instance.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.btk?.native);
    await page.evaluate(() => window.btk.personal.mode('enterprise'));
    await page.reload();
    const snapshot = await page.evaluate(() => window.btk.snapshot());
    const readiness = await page.evaluate(() => window.btk.readiness());
    assert.equal(readiness.release.bundled, true);
    assert.equal(readiness.release.version, require('../package.json').version);
    assert.equal(readiness.service_actions_enabled, false);
    assert.equal(readiness.process_observation.status, 'observed', JSON.stringify(readiness.process_observation));
    const isolation = await page.evaluate(() => ({ node: typeof require, process: typeof process }));
    assert.deepEqual(isolation, { node: 'undefined', process: 'undefined' });
    const setup = await page.evaluate(() => window.btk.setupStatus());
    assert.equal(setup.status, 'idle');
    await instance.evaluate(({ dialog }) => {
      global.__originalSetupDialog = dialog.showMessageBox;
      global.__setupDialogChecks = [];
      dialog.showMessageBox = async (_window, options) => {
        global.__setupDialogChecks.push({ defaultId: options.defaultId, cancelId: options.cancelId });
        return { response: 0 };
      };
    });
    try {
      for (const method of ['enroll', 'install', 'startAgent']) {
        const cancelled = await page.evaluate(async method => {
          try { await window.btk[method]({}); return false; }
          catch (error) { return error.message.includes('\uCDE8\uC18C'); }
        }, method);
        assert.equal(cancelled, true, `${method} must stop before invoking the core when cancelled`);
      }
      const confirmationChecks = await instance.evaluate(() => global.__setupDialogChecks);
      assert.deepEqual(confirmationChecks, Array.from({ length: 3 }, () => ({ defaultId: 0, cancelId: 0 })));
      assert.deepEqual(await page.evaluate(() => window.btk.setupStatus()), setup);
      const unchanged = await page.evaluate(() => window.btk.snapshot());
      assert.deepEqual(unchanged.profile, snapshot.profile);
    } finally {
      await instance.evaluate(({ dialog }) => {
        dialog.showMessageBox = global.__originalSetupDialog;
        delete global.__originalSetupDialog;
        delete global.__setupDialogChecks;
      });
    }
    if (fresh) {
      assert.equal(snapshot.registration_required, true);
      assert.equal(snapshot.profile.runner, '');
      assert.equal(snapshot.chat.available, false);
      assert.equal(snapshot.tasks.length, 0);
      const connection = await page.evaluate(() => window.btk.connection());
      assert.equal(connection.transport, 'unconfigured');
      await page.getByRole('heading', { name: '설치 점검', exact: true }).waitFor();
    } else {
      assert.equal(snapshot.registration_required, false);
      assert.ok(snapshot.tasks.length > 0);
      await page.getByRole('button', { name: '설치 점검', exact: true }).click();
    }
    await page.getByRole('button', { name: '다시 점검', exact: true }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent.includes('다시 점검'))?.disabled);
    await page.screenshot({ path: path.join(output, fresh ? 'package-first-run.png' : 'package-configured.png'), fullPage: true });
    assert.deepEqual(errors, []);
    return { mode: fresh ? 'fresh_profile' : 'existing_profile', version: readiness.release.version,
      build_id: readiness.release.build_id, bundled: true, no_node_or_python_on_path: true,
      local_records: snapshot.tasks.length, registration_required: snapshot.registration_required,
      process_probe_status: readiness.process_observation.status,
      native_setup_cancelled_without_profile_changes: true,
      service_actions_enabled: false, page_errors: errors };
  } finally {
    await instance.close();
  }
}

(async () => {
  const results = [await check(true)];
  if (!process.argv.includes('--fresh-only')) results.push(await check(false));
  fs.writeFileSync(path.join(output, 'package-smoke.json'), JSON.stringify({ results, checked_at: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (path.dirname(temporary) === path.resolve(os.tmpdir()))
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});
