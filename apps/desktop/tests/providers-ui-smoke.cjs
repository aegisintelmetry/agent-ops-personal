const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const providers = require("../electron/providers.json");
const root = path.resolve(__dirname, "..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "btk-providers-ui-"));
let instance;
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  instance = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [root, `--user-data-dir=${directory}`], env });
  const page = await instance.firstWindow();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "개인용 Personal" }).click();
  const checked = [];
  for (const preset of providers.filter(item => ["deepseek", "kimi", "gemini"].includes(item.id))) {
    await page.getByLabel("공급자", { exact: true }).selectOption(preset.id);
    assert.equal(await page.getByLabel("API 주소", { exact: true }).inputValue(), preset.endpoint);
    assert.equal(await page.getByLabel("API 주소", { exact: true }).getAttribute("readonly"), "");
    assert.equal(await page.getByLabel("모델 ID", { exact: true }).inputValue(), preset.model);
    assert.equal(await page.getByLabel("API 키", { exact: true }).inputValue(), "");
    await page.getByText("키 미등록", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "저장된 키 삭제", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "연결 시험", exact: true }).isDisabled(), true);
    await page.getByLabel("API 키", { exact: true }).fill("fixture-provider-key-not-real");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByText("키 저장됨", { exact: true }).waitFor();
    const state = await page.evaluate(() => window.btk.personal.state());
    assert.equal(state.provider, preset.id);
    assert.equal(JSON.stringify(state).includes("fixture-provider-key"), false);
    checked.push(preset.id);
  }
  for (const width of [390, 780, 1440]) {
    await instance.evaluate(({ BrowserWindow }, value) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(0, 0); window.setSize(value, 1000); }, width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(root, `artifacts/providers-${width}.png`) });
  }
  await page.getByLabel("공급자", { exact: true }).selectOption("compatible");
  assert.equal(await page.getByLabel("API 주소", { exact: true }).isEditable(), true);
  assert.equal(await page.getByLabel("API 주소", { exact: true }).inputValue(), "");
  assert.equal(errors.length, 0);
  const result = { status: "passed", providers: checked, checks: ["official_endpoint_prefill_readonly", "model_prefill", "key_not_reused_across_providers", "encrypted_save_native_ipc", "dirty_probe_disabled", "layout_390_780_1440", "custom_endpoint_supported", "no_renderer_errors"], actualProviderRequests: false, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, "artifacts/providers-ui-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await instance?.close(); });
