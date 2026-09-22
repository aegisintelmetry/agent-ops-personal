const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { _electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "btk-agents-ui-"));
const requests = [];
const errors = [];
let instance;
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const parsed = JSON.parse(body);
  requests.push({ ...parsed, authorization: req.headers.authorization });
  if (parsed.messages.at(-1).content === "wait") return;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: `reply ${parsed.model}` }, finish_reason: "stop" }] }));
});
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.BTK_DESKTOP_TEST_EXE;
  if (packaged) env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  instance = await _electron.launch({ executablePath: packaged || path.join(root, "node_modules/electron/dist/electron.exe"), args: [...(packaged ? [] : [root]), `--user-data-dir=${directory}`], env });
  const page = await instance.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  return page;
}
async function save(page, model, key = "") {
  await page.getByLabel("공급자", { exact: true }).selectOption("local");
  await page.getByLabel("API 주소", { exact: true }).fill(`http://127.0.0.1:${server.address().port}/v1`);
  await page.getByLabel("모델 ID", { exact: true }).fill(model);
  await page.getByLabel("API 키", { exact: true }).fill(key);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "설정 저장됨" }).waitFor();
  await page.getByRole("button", { name: "작업 공간", exact: true }).click();
}
async function chat(page, text, model) {
  await page.getByLabel("개인 메시지", { exact: true }).fill(text);
  await page.getByRole("button", { name: "개인 메시지 전송", exact: true }).click();
  await page.getByText(`reply ${model}`, { exact: true }).waitFor();
}
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let page = await launch();
  await page.getByRole("button", { name: "개인용 Personal" }).click();
  await save(page, "alpha-model", "fixture-alpha-native-key");
  await chat(page, "alpha private history", "alpha-model");
  await page.getByRole("button", { name: "에이전트 추가", exact: true }).click();
  await page.getByLabel("에이전트 이름", { exact: true }).fill("조사 에이전트");
  await page.getByRole("button", { name: "이름 저장", exact: true }).click();
  await page.waitForFunction(async () => (await window.btk.personal.state()).agentName === "조사 에이전트");
  const beta = await page.evaluate(() => window.btk.personal.state());
  assert.equal(beta.keyConfigured, false);
  assert.equal(beta.model, "");
  await save(page, "beta-model");
  await chat(page, "beta private history", "beta-model");
  assert.deepEqual(requests.map(r => r.model), ["alpha-model", "beta-model"]);
  assert.equal(requests[0].authorization, "Bearer fixture-alpha-native-key");
  assert.equal(requests[1].authorization, undefined);
  assert.deepEqual(requests[1].messages, [{ role: "user", content: "beta private history" }]);
  await page.getByLabel("에이전트", { exact: true }).selectOption("default");
  await page.getByText("reply alpha-model", { exact: true }).waitFor();
  assert.equal(await page.getByText("reply beta-model", { exact: true }).count(), 0);
  const stale = await page.evaluate(async id => { try { await window.btk.personal.chat([{ role: "user", content: "wrong agent" }], id); return false; } catch { return true; } }, beta.agentId);
  assert.equal(stale, true);
  assert.equal(requests.length, 2);
  await page.getByLabel("개인 메시지", { exact: true }).fill("wait");
  await page.getByRole("button", { name: "개인 메시지 전송", exact: true }).click();
  await page.getByRole("button", { name: "개인 답변 중단", exact: true }).waitFor();
  assert.equal(await page.getByLabel("에이전트", { exact: true }).isDisabled(), true);
  const blocked = await page.evaluate(async id => { try { await window.btk.personal.agents.select(id); return false; } catch { return true; } }, beta.agentId);
  assert.equal(blocked, true);
  await page.getByRole("button", { name: "개인 답변 중단", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "취소" }).waitFor();
  await page.getByLabel("에이전트", { exact: true }).selectOption(beta.agentId);
  await page.getByText("reply beta-model", { exact: true }).waitFor();
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  for (const width of [390, 780, 1440]) {
    await instance.evaluate(({ BrowserWindow }, width) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(0, 0); w.setSize(width, 1000); }, width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(root, `artifacts/agents-${width}.png`) });
  }
  await instance.close(); instance = null;
  const count = requests.length;
  page = await launch();
  await page.getByRole("heading", { name: "AEGIS Agent Ops", exact: true }).waitFor();
  const restored = await page.evaluate(() => window.btk.personal.state());
  assert.equal(restored.agentId, beta.agentId);
  assert.equal(restored.model, "beta-model");
  assert.equal(restored.agentName, "조사 에이전트");
  assert.equal(requests.length, count);
  assert.equal(errors.length, 0);
  const result = { status: "passed", packaged: Boolean(process.env.BTK_DESKTOP_TEST_EXE), checks: ["per_agent_model_routing", "no_credential_copy", "native_encryption", "per_agent_conversation_isolation", "history_restored_on_switch", "stale_agent_request_rejected", "busy_switch_rejected_ui_and_ipc", "cancel", "restart_restores_selected_agent", "no_automatic_network_on_save_or_restart", "layout_390_780_1440", "no_renderer_errors"], actualProviderRequests: false, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, process.env.BTK_DESKTOP_TEST_EXE ? "artifacts/agents-packaged-smoke.json" : "artifacts/agents-ui-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await instance?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
