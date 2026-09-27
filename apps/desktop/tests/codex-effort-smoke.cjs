const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-effort-'));
let app;
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const exe = process.env.BTK_DESKTOP_TEST_EXE;
  app = await _electron.launch({ executablePath: exe || path.join(root, 'node_modules/electron/dist/electron.exe'), args: [...(exe ? [] : [root]), `--user-data-dir=${profile}`], env });
  await app.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
    const { CodexConnection } = process.mainModule.require(app.getAppPath() + '/electron/codex.cjs');
    global.effortCalls = [];
    CodexConnection.prototype.state = async () => ({ connected: true, pending: false, plan: 'fixture', error: '' });
    CodexConnection.prototype.models = async () => [
      { id: 'fixture-model', name: 'Fixture', reasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium' },
      { id: 'limited-model', name: 'Limited', reasoningEfforts: ['low'], defaultReasoningEffort: 'low' },
      { id: 'legacy-model', name: 'Legacy' },
    ];
    CodexConnection.prototype.complete = async function (messages, model, effort) {
      global.effortCalls.push({ model, effort });
      const plan = messages.find(message => message.content.startsWith('Plan'));
      const text = plan ? JSON.stringify({ tasks: JSON.parse(plan.content.slice(plan.content.indexOf('\n') + 1)).workers.map(worker => ({ agentId: worker.agentId, task: 'Review evidence' })) }) : `Reply with ${effort || 'default'}`;
      return { status: 'completed', text, usage: {} };
    };
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  return page;
}
(async () => {
  let page = await launch();
  await page.getByRole('button', { name: '개인용 Personal' }).click();
  await page.getByLabel('연결 방식', { exact: true }).selectOption('codex');
  await page.getByLabel('Codex 모델', { exact: true }).selectOption('fixture-model');
  await page.getByLabel('추론 강도', { exact: true }).selectOption('high');
  await page.getByRole('button', { name: '모델 저장', exact: true }).click();
  await page.getByText('Codex 모델 저장됨', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.btk.personal.state())).reasoningEffort, 'high');
  await page.getByRole('button', { name: '작업 공간', exact: true }).click();
  await page.getByLabel('개인 메시지', { exact: true }).fill('Hi');
  await page.getByRole('button', { name: '개인 메시지 전송', exact: true }).click();
  await page.getByText('Reply with high', { exact: true }).waitFor();
  assert.equal((await app.evaluate(() => global.effortCalls))[0].effort, 'high');
  const workerId = await page.evaluate(async () => {
    const p = window.btk.personal;
    const worker = await p.agents.create('Worker');
    await p.connection('codex');
    await p.codex.model('fixture-model', 'low');
    await p.agents.select('default');
    await p.team.configure({ masterId: 'default', workerIds: [worker.agentId] });
    return worker.agentId;
  });
  await page.evaluate(workerId => window.btk.personal.team.start({ masterId: 'default', workerIds: [workerId], objective: 'Fixture comparison' }), workerId);
  await page.waitForFunction(async () => (await window.btk.personal.team.state())?.status === 'completed');
  assert.deepEqual((await app.evaluate(() => global.effortCalls)).map(call => call.effort), ['high', 'high', 'low', 'high']);
  await page.reload();
  await page.getByRole('button', { name: '모델 연결', exact: true }).click();
  assert.equal(await page.getByLabel('추론 강도', { exact: true }).inputValue(), 'high');
  await page.getByLabel('Codex 모델', { exact: true }).selectOption('limited-model');
  assert.equal(await page.getByLabel('추론 강도', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('추론 강도', { exact: true }).locator('option[value=high]').count(), 0);
  assert.equal(await page.evaluate(async () => { try { await window.btk.personal.codex.model('limited-model', 'high'); return false; } catch { return true; } }), true);
  await page.getByLabel('Codex 모델', { exact: true }).selectOption('legacy-model');
  assert.equal(await page.getByLabel('추론 강도', { exact: true }).locator('option').count(), 1);
  await app.close(); page = await launch();
  await page.getByRole('button', { name: '모델 연결', exact: true }).click();
  await page.getByLabel('추론 강도', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('추론 강도', { exact: true }).inputValue(), 'high');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByLabel('추론 강도', { exact: true }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, `artifacts/codex-effort-${width}.png`) });
  }
  await page.getByLabel('언어 / Language').selectOption('en');
  await page.getByLabel('Reasoning effort', { exact: true }).selectOption('xhigh');
  await page.getByRole('button', { name: 'Save model', exact: true }).click();
  await page.getByText('Codex model saved', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.btk.personal.state())).reasoningEffort, 'xhigh');
  console.log(JSON.stringify({ status: 'passed', checks: ['High selector', 'native persistence', 'chat effort', 'master/worker effort isolation', 'unsupported effort rejection', 'model change reset', 'legacy default', 'restart', 'desktop/mobile', 'English'], realProviderCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await app?.close(); fs.rmSync(profile, { recursive: true, force: true }); });
