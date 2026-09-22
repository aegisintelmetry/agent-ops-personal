const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "btk-window-layout-"));
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
let app;
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [root, `--user-data-dir=${profile}`], env });
  const page = await app.firstWindow();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.evaluate(async () => {
    await window.btk.personal.mode("personal");
    await window.btk.personal.save({ provider: "local", endpoint: "http://127.0.0.1:11434/v1", model: "layout-fixture", maxTokens: 512 });
  });
  await page.reload();
  await page.getByLabel("개인 메시지", { exact: true }).waitFor();
  const measurements = [];
  for (const [width, height] of [[390, 700], [780, 600], [1100, 700], [1440, 900], [1920, 1080], [390, 700]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.setSize(w, h); }, [width, height]);
    await page.waitForTimeout(150);
    const bounds = await page.evaluate(() => {
      const composer = document.querySelector(".personal-chat .composer").getBoundingClientRect();
      const transcript = document.querySelector(".personal-transcript").getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, composer: { top: composer.top, bottom: composer.bottom, width: composer.width }, transcriptBottom: transcript.bottom };
    });
    assert.ok(bounds.scrollWidth <= bounds.width, JSON.stringify(bounds));
    assert.ok(bounds.scrollHeight <= bounds.height + 1, JSON.stringify(bounds));
    assert.ok(bounds.composer.bottom <= bounds.height && bounds.composer.top > 0, JSON.stringify(bounds));
    assert.ok(bounds.transcriptBottom <= bounds.composer.top + 1, JSON.stringify(bounds));
    measurements.push(bounds);
    await page.screenshot({ path: path.join(root, `artifacts/personal-window-${width}.png`) });
  }
  assert.ok(measurements[4].composer.width > measurements[3].composer.width + 300, "wide window must grow the composer");
  await page.getByRole("button", { name: "실행 요약 표시", exact: true }).click();
  await page.getByLabel("실행 요약", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByLabel("실행 요약", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "탐색 표시", exact: true }).click();
  await page.getByRole("button", { name: "모델 연결", exact: true }).click();
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  await page.getByRole("button", { name: "저장", exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true);
  await page.screenshot({ path: path.join(root, "artifacts/personal-window-settings-390.png") });
  assert.deepEqual(errors, []);
  const result = { status: "passed", measurements, checks: ["live_resize", "viewport_bound_composer", "pane_only_scroll", "wide_composer_growth", "summary_drawer_escape", "mobile_navigation", "settings_scroll"], actualModelRequests: false };
  fs.writeFileSync(path.join(root, "artifacts/personal-window-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await app?.close(); });
