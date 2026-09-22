const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-team-smoke-'));
let app;
const requests = [];
const errors = [];
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part;
  const data = JSON.parse(body); requests.push(data);
  const prompt = data.messages[0].content;
  let text = 'Worker evidence';
  if (prompt.startsWith('Plan')) {
    const payload = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    text = JSON.stringify({ tasks: payload.workers.map(w => ({ agentId: w.agentId, task: `Review ${w.name}` })) });
  } else if (prompt.startsWith('Synthesize')) text = 'Verified fixture synthesis';
  await new Promise(resolve => setTimeout(resolve, 200));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.BTK_DESKTOP_TEST_EXE;
  if (packaged) env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  app = await _electron.launch({ executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(packaged ? [] : [root]), `--user-data-dir=${directory}`], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: '개인용 Personal' }).click();
  await page.evaluate(async endpoint => {
    const p = window.btk.personal;
    await p.save({ provider: 'local', endpoint, model: 'master-model', maxTokens: 1024, apiKey: '' });
    await p.agents.create('Research');
    await p.save({ provider: 'local', endpoint, model: 'research-model', maxTokens: 1024, apiKey: '' });
    await p.agents.create('Review');
    await p.save({ provider: 'local', endpoint, model: 'review-model', maxTokens: 1024, apiKey: '' });
    await p.agents.select('default');
  }, `http://127.0.0.1:${server.address().port}/v1`);
  await page.reload();
  await page.getByRole('button', { name: '팀 작업', exact: true }).click();
  for (const name of ['Research', 'Review']) {
    await page.getByRole('combobox', { name: '기존 에이전트 연결', exact: true }).selectOption({ label: name });
    await page.getByRole('button', { name: '기존 에이전트 연결', exact: true }).click();
    await page.getByRole('button', { name: `${name} 설정`, exact: true }).waitFor();
  }
  await page.getByLabel('작업 목표', { exact: true }).fill('Compare fixture results');
  // Native dialog is accepted only inside this isolated, local-provider fixture.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.getByRole('button', { name: '팀 작업 실행', exact: true }).click();
  await page.waitForFunction(async () => (await window.btk.personal.team.state())?.status === 'running');
  assert.equal(await page.evaluate(async () => { try { await window.btk.personal.mode('enterprise'); return false; } catch { return true; } }), true);
  assert.equal(await page.evaluate(async () => { try { await window.btk.personal.team.configure({ masterId: 'default', workerIds: [] }); return false; } catch { return true; } }), true);
  await page.getByText('Verified fixture synthesis', { exact: true }).waitFor();
  assert.deepEqual(requests.map(r => r.model), ['master-model', 'research-model', 'review-model', 'master-model']);
  assert.equal((await page.evaluate(() => window.btk.personal.team.state())).status, 'completed');
  await page.getByRole('button', { name: '하위 에이전트 추가', exact: true }).click();
  await page.getByRole('region', { name: '에이전트 설정', exact: true }).waitFor();
  await page.getByRole('heading', { name: '작업 에이전트 1', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '팀 작업 실행', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(async () => { const c = await window.btk.personal.team.configuration(); try { await window.btk.personal.team.start({ masterId: c.masterId, workerIds: c.workerIds, objective: 'invalid setup' }); return false; } catch { return true; } }), true);
  assert.equal(requests.length, 4);
  assert.equal(await page.locator('.personal-agent-bar').count(), 0);
  const editor = page.getByRole('region', { name: '에이전트 설정', exact: true });
  await editor.getByLabel('공급자', { exact: true }).selectOption('local');
  await editor.getByLabel('API 주소', { exact: true }).fill(`http://127.0.0.1:${server.address().port}/v1`);
  await editor.getByLabel('모델 ID', { exact: true }).fill('inline-worker-model');
  await editor.getByRole('button', { name: '저장', exact: true }).click();
  await page.waitForFunction(async () => (await window.btk.personal.team.configuration()).agents.some(a => a.model === 'inline-worker-model' && a.configured));
  await page.getByText('설정 저장됨 · 연결 미검증', { exact: true }).waitFor();
  const persisted = await page.evaluate(() => window.btk.personal.team.configuration());
  assert.equal(persisted.workerIds.length, 3);
  await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '팀 작업', exact: true }).click();
  await page.getByRole('button', { name: '작업 에이전트 1 설정', exact: true }).waitFor();
  assert.deepEqual((await page.evaluate(() => window.btk.personal.team.configuration())).workerIds, persisted.workerIds);
  await page.getByRole('button', { name: '작업 에이전트 1 설정', exact: true }).click();
  await page.getByRole('region', { name: '에이전트 설정', exact: true }).waitFor();
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.getByRole('heading', { name: 'Team tasks', exact: true }).waitFor();
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  for (const width of [1440, 390]) {
    await app.evaluate(({ BrowserWindow }, width) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(0, 0); w.setSize(width, 900); }, width);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(root, `artifacts/team-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', checks: ['native-master-dispatch-synthesis', 'model-isolation', 'busy-mode-gate', 'tree-attach-existing', 'tree-create-worker-inline-settings', 'missing-model-disables-run', 'persisted-hierarchy', 'english', 'desktop-mobile-layout'], actualProviderRequests: false }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
