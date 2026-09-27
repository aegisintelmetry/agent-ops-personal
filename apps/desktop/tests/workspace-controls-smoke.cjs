const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-output-controls-'));
let app;
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const exe = process.env.BTK_DESKTOP_TEST_EXE;
  app = await _electron.launch({ executablePath: exe || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(exe ? [] : [root]), `--user-data-dir=${profile}`], env });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.btk));
  await page.evaluate(async () => {
    await window.btk.personal.mode('personal');
    await window.btk.personal.save({ provider: 'local', endpoint: 'http://127.0.0.1:11434/v1', model: 'layout-fixture', maxTokens: 512 });
    await window.btk.personal.workspace.read();
    await window.btk.personal.workspace.save({ default: { selected: 's1', items: [{
      id: 's1', title: 'Layout fixture', draft: 'Ready', output: 'chat', messages: [],
      sources: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, name: `${i}-` + 'long-file-name-'.repeat(12) + '.txt', text: 'a'.repeat(12000), truncated: true })),
    }] } });
  });
  await page.reload(); await page.locator('.workspace-options select').waitFor();
  const measurements = [];
  for (const [width, height] of [[1440, 900], [390, 700], [390, 500], [780, 500], [1440, 700]]) {
    await page.setViewportSize({ width, height });
    // Close the intentional narrow-screen panel overlay before testing composer controls.
    await page.keyboard.press('Escape');
    for (const output of ['chat', 'markdown', 'text', 'image']) {
      await page.locator('.workspace-options select').selectOption(output);
      const bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        controls: ['.workspace-options select', '.composer textarea', '.composer .send'].map(selector => {
          const element = document.querySelector(selector), rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { selector, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, reachable: element === hit || element.contains(hit) };
        }),
        detailsScrollable: document.querySelector('.workspace-source-details').scrollHeight > document.querySelector('.workspace-source-details').clientHeight,
      }));
      for (const rect of bounds.controls) assert.ok(rect.top >= 0 && rect.bottom <= height && rect.left >= 0 && rect.right <= width && rect.reachable, JSON.stringify({ output, ...bounds }));
      assert.equal(bounds.detailsScrollable, true);
      measurements.push({ output, ...bounds });
    }
    await page.locator('.workspace-options select').selectOption('chat');
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, `artifacts/workspace-controls-${width}-${height}.png`) });
  }
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.getByLabel('Output', { exact: true }).selectOption('markdown');
  assert.equal(await page.getByLabel('Output', { exact: true }).inputValue(), 'markdown');
  await page.getByRole('button', { name: 'Model connection', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  assert.equal(await page.getByLabel('Output', { exact: true }).inputValue(), 'markdown');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', checks: ['output selector and send reachable', 'five long attachment notices scroll independently', 'four output modes', '390-1440 widths', '500-900 heights', 'language switch', 'settings return'], measurements, realProviderCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close(); fs.rmSync(profile, { recursive: true, force: true });
});
