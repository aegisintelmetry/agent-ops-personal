const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-public-images-'));
const output = path.resolve(root, '../../docs/assets');
const errors = [];
const requests = [];
let app;
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const data = JSON.parse(raw); requests.push(data);
  const prompt = data.messages[0].content;
  let content = 'Keep the original file read-only. Share only the reviewed summary.';
  if (prompt.startsWith('Plan')) {
    const payload = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    content = JSON.stringify({ tasks: payload.workers.map(worker => ({
      agentId: worker.agentId,
      task: worker.name === 'Research' ? 'Summarize the launch priorities.' : 'Review the data-sharing risks.',
    })) });
  } else if (prompt.startsWith('Synthesize')) {
    content = 'Launch review\n\n1. Publish a short setup guide and a reproducible demo.\n2. Keep customer records and credentials out of shared examples.\n3. Request a human review before publishing the final brief.\n\nThis is a local demonstration response. No files were changed or shared.';
  } else if (data.model === 'research-demo') {
    content = 'Priorities: onboarding, a reproducible demo, and a clear feedback channel.';
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/BTK|MCP|OPENAI|ANTHROPIC|TOKEN|SECRET|API_KEY|ELECTRON_RUN_AS_NODE/i.test(key)) delete env[key];
  env.BTK_CONFIG_HOME = path.join(directory, 'empty-core');
  const packaged = process.env.BTK_DESKTOP_TEST_EXE;
  app = await _electron.launch({ executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(packaged ? [] : [root]), `--user-data-dir=${directory}`], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.btk));
  await page.evaluate(async endpoint => {
    await window.btk.preferences.save('en');
    const p = window.btk.personal;
    await p.mode('personal');
    await p.agents.rename('Coordinator');
    await p.save({ provider: 'local', endpoint, model: 'coordinator-demo', maxTokens: 1024 });
    const workerIds = [];
    for (const name of ['Research', 'Review']) {
      const worker = await p.agents.create(name); workerIds.push(worker.agentId);
      await p.save({ provider: 'local', endpoint, model: `${name.toLowerCase()}-demo`, maxTokens: 1024 });
    }
    await p.agents.select('default');
    await p.team.configure({ masterId: 'default', workerIds });
  }, `http://127.0.0.1:${server.address().port}/v1`);
  await page.reload();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.getByRole('button', { name: 'Team tasks', exact: true }).click();
  // Only the isolated loopback fixture accepts the native transmission dialog.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.getByLabel('Objective', { exact: true }).fill('Review our launch plan. Summarize the priorities and flag data-sharing risks.');
  await page.getByRole('button', { name: 'Run team task', exact: true }).click();
  await page.waitForFunction(async () => (await window.btk.personal.team.state())?.status === 'completed');
  await page.getByText('Launch review', { exact: false }).waitFor();
  fs.mkdirSync(output, { recursive: true });
  for (const width of [1440, 390]) {
    await app.evaluate(({ BrowserWindow }, width) => {
      const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(width, 900);
    }, width);
    await page.waitForTimeout(200);
    if (width === 390) await page.getByRole('button', { name: 'Show team setup', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const composer = await page.locator('.team-composer').boundingBox();
    assert.ok(composer.y + composer.height <= await page.evaluate(() => innerHeight) + 1);
    await page.screenshot({ path: path.join(output, width === 1440 ? 'team-workspace.png' : 'team-workspace-mobile.png') });
  }
  assert.equal(requests.length, 4); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', language: 'en', widths: [1440, 390], fixtureRequests: requests.length, realProviderRequests: 0, rendererErrors: errors.length }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close(); server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});
