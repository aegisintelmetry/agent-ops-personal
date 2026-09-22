const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  const output = path.resolve(__dirname, "../artifacts");
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      let state = { mode: "personal", provider: "compatible", endpoint: "", model: "", maxTokens: 1024, workspace: "", keyConfigured: false, secureStorage: true };
      window.btk = { native: true, personal: {
        state: async () => state,
        save: async ({ apiKey, ...input }) => { state = { ...state, ...input, keyConfigured: Boolean(apiKey) }; return state; },
        test: async () => ({ status: "completed", checkedAt: new Date().toISOString() }),
        chat: async () => ({ text: "응답 확인", status: "completed", usage: {} }),
      } };
    });
    await page.goto(process.env.BTK_DESKTOP_PREVIEW_URL || "http://127.0.0.1:4381");
    await page.getByRole("heading", { name: "모델 연결" }).waitFor();
    await fs.mkdir(output, { recursive: true });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `settings overflow ${width}`);
      const overflow = await page.locator(".personal-settings input,.personal-settings select,.personal-actions button").evaluateAll(elements => elements.some(el => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }));
      assert.equal(overflow, false);
      await page.screenshot({ path: path.join(output, `personal-responsive-settings-${width}.png`), fullPage: true });
    }
    await page.getByLabel("API 주소", { exact: true }).fill("https://model.example.test/v1");
    await page.getByLabel("모델 ID", { exact: true }).fill("fixture-model");
    await page.getByLabel("API 키", { exact: true }).fill("fixture-only");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByText("설정 저장됨 · 연결 미검증", { exact: true }).waitFor();
    await page.getByRole("button", { name: "작업 공간", exact: true }).click();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `chat overflow ${width}`);
      const boxes = await page.locator(".personal-transcript,.personal-chat .composer,.personal-destination").evaluateAll(elements => elements.map(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })));
      assert.ok(boxes[0].bottom <= boxes[1].top && boxes[1].bottom <= boxes[2].top, `chat overlap ${width}`);
      await page.screenshot({ path: path.join(output, `personal-responsive-chat-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    const result = { status: "passed", evidence_type: "browser_fixture_bridge", widths: [390, 768, 1440], views: ["settings", "chat"], errors };
    await fs.writeFile(path.join(output, "personal-responsive.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
