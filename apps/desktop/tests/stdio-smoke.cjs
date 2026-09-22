const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'btk-stdio-smoke-'));
const executable = process.env.BTK_DESKTOP_TEST_EXE;

async function check() {
  assert.ok(executable, 'BTK_DESKTOP_TEST_EXE must identify the test package');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(BTK_|MCP_|NUXT_PUBLIC_BTK_|CLAUDE|ANTHROPIC_|OPENAI_|PYTHON)/i.test(key)) delete env[key];
  }
  delete env.ELECTRON_RUN_AS_NODE;
  env.BTK_CONFIG_HOME = path.join(temporary, 'empty-profile');
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  const instance = await _electron.launch({ executablePath: executable,
    args: [`--user-data-dir=${path.join(temporary, 'ui')}`], cwd: temporary, env, timeout: 45000 });
  try {
    const page = await instance.firstWindow();
    await page.waitForFunction(() => window.btk?.native);
    await page.evaluate(() => window.btk.personal.mode('enterprise'));
    const before = await page.evaluate(() => window.btk.snapshot());
    await instance.evaluate(({ dialog }) => {
      global.__stdioErrorBoxes = [];
      dialog.showErrorBox = (title, content) => global.__stdioErrorBoxes.push({ title, content });
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    // Close only this test child's log pipes, leaving the Playwright transport intact.
    instance.process().stdout.destroy();
    instance.process().stderr.destroy();
    const result = await page.evaluate(async () => Promise.race([
      window.btk.enroll({ central_url: 'http://invalid.example', profile_id: '' })
        .then(() => 'unexpected success', error => error.message),
      new Promise(resolve => setTimeout(() => resolve('renderer response timeout'), 5000)),
    ]));
    await instance.evaluate(() => {
      console.log('stdio smoke: closed stdout');
      console.error('stdio smoke: closed stderr');
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const boxes = await instance.evaluate(() => global.__stdioErrorBoxes);
    const after = await page.evaluate(() => window.btk.snapshot());
    const setup = await page.evaluate(() => window.btk.setupStatus());
    const version = await instance.evaluate(({ app }) => app.getVersion());
    const report = { version, checked_at: new Date().toISOString(),
      actual_stdout_and_stderr_pipes_closed: true, renderer_error: result,
      error_boxes: boxes, setup_status: setup.status,
      profile_unchanged: JSON.stringify(before.profile) === JSON.stringify(after.profile),
      core_still_responsive: true };
    const output = path.join(root, 'artifacts', `stdio-smoke-${version}.json`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    assert.match(result, /HTTPS/);
    assert.equal(setup.status, 'idle');
    assert.deepEqual(after.profile, before.profile);
    assert.deepEqual(boxes, [], 'Broken logging pipes must not cause an uncaught-exception dialog');
  } finally {
    await instance.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (path.dirname(temporary) === path.resolve(os.tmpdir()))
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});
