const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "btk-codex-ui-"));
let instance;
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  instance = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [root, `--user-data-dir=${directory}`], env });
  const page = await instance.firstWindow();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "개인용 Personal" }).click();
  await page.getByLabel("연결 방식", { exact: true }).selectOption("codex");
  await page.getByRole("heading", { name: "ChatGPT 연결" }).waitFor();
  await page.getByText("로그인 필요", { exact: true }).waitFor();
  await instance.evaluate(({ shell }) => {
    shell.openExternal = async value => {
      const url = new URL(value);
      if (url.protocol !== "https:" || !["auth.openai.com", "chatgpt.com"].includes(url.hostname)) throw new Error("Unexpected login host");
    };
  });
  await page.getByRole("button", { name: "ChatGPT로 로그인", exact: true }).click();
  await page.getByText("브라우저 로그인 대기 중", { exact: true }).waitFor();
  await page.getByRole("button", { name: "로그인 취소", exact: true }).click();
  await page.getByText("로그인 필요", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.btk.personal.codex.state())).connected, false);
  for (const width of [390, 780, 1440]) {
    await instance.evaluate(({ BrowserWindow }, value) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(0, 0); window.setSize(value, 900); }, width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(root, `artifacts/codex-login-${width}.png`) });
  }
  await page.getByLabel("연결 방식", { exact: true }).selectOption("api");
  await page.getByLabel("API 키", { exact: true }).waitFor();
  assert.equal(errors.length, 0);
  const result = { status: "passed", checkedAt: new Date().toISOString(), checks: ["native_codex_selection", "real_runtime_signed_out", "official_browser_url_validated_without_opening", "login_cancel", "layout_390_780_1440", "api_mode_preserved", "no_renderer_errors"], actualLoginCompleted: false, inferenceRequested: false };
  fs.writeFileSync(path.join(root, "artifacts/codex-ui-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await instance?.close(); });
