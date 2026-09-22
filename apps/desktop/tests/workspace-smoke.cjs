const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const artifacts = path.resolve(__dirname, "../artifacts");
  const errors = [];
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      let receive = () => {}, turn = null;
      window.btk = {
        native: true,
        snapshot: async () => ({ host: "WORKSPACE-TEST", profile: { name: "Fixture", runner: "fixture.runner", team_id: "team-test" },
          model: { engine: "fixture", model: "fixture-model" }, chat: { available: true }, tasks: [], warnings: [] }),
        connection: async () => ({ transport: "connected" }), readiness: async () => ({}),
        onChat: callback => { receive = callback; return () => {}; }, onDisconnect: () => () => {},
        chat: async params => { turn = params.turn_id; window.fixtureHistory = params.history; setTimeout(() => {
          if (turn === params.turn_id) { receive({ turn_id: turn, status: "finished", outcome: "completed", text: "테스트 응답" }); turn = null; }
        }, 500); return {}; },
        cancel: async id => { if (turn === id) { turn = null; receive({ turn_id: id, status: "finished", outcome: "cancelled", text: "취소됨" }); } return {}; },
      };
    });
    await page.goto(process.env.BTK_DESKTOP_PREVIEW_URL || "http://127.0.0.1:4381");
    await page.getByRole("heading", { name: "지금 무엇을 확인할까요?" }).waitFor();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="기록 새로고침"]').disabled);
    await fs.mkdir(artifacts, { recursive: true });
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width}`);
      const boxes = await page.locator(".empty-chat, .composer").evaluateAll(elements => elements.map(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })));
      assert.ok(boxes[0].bottom <= boxes[1].top, `composer overlap ${width}`);
      await page.screenshot({ path: path.join(artifacts, `workspace-${width}.png`), fullPage: true });
    }
    checks.push("responsive_centered_composer_390_768_1440_1920");
    await page.setViewportSize({ width: 1440, height: 960 });
    const input = page.getByRole("textbox", { name: "메시지", exact: true });
    await input.fill("첫 번째 질문"); await page.getByRole("button", { name: "메시지 전송", exact: true }).click();
    await page.getByText("테스트 응답", { exact: true }).waitFor();
    await input.fill("보관할 초안");
    await page.locator(".new-chat").click();
    assert.equal(await input.inputValue(), "");
    await input.fill("별도 세션 질문"); await page.getByRole("button", { name: "메시지 전송", exact: true }).click();
    await page.getByRole("button", { name: "답변 중단", exact: true }).click();
    await page.getByText("취소됨", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixtureHistory), []);
    checks.push("streaming_and_cancel_preserved", "new_session_has_isolated_history");
    await page.locator(".session-select").filter({ hasText: "첫 번째 질문" }).click();
    assert.equal(await input.inputValue(), "보관할 초안");
    await page.getByText("테스트 응답", { exact: true }).waitFor();
    checks.push("session_switch_restores_draft_and_messages");
    await page.getByRole("button", { name: "첫 번째 질문 대화 삭제", exact: true }).click();
    await page.getByRole("button", { name: "취소", exact: true }).click();
    assert.equal(await page.locator(".session-row").count(), 2);
    await page.getByRole("button", { name: "첫 번째 질문 대화 삭제", exact: true }).click();
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    assert.equal(await page.locator(".session-row").count(), 1);
    checks.push("delete_confirmation_and_selected_session_recovery");
    await page.getByRole("button", { name: "컨텍스트 표시" }).click();
    await page.locator(".context-panel").waitFor();
    await page.getByRole("button", { name: "컨텍스트 표시" }).click();
    assert.equal(await page.locator(".context-panel").count(), 0);
    checks.push("context_panel_toggle");
    assert.deepEqual(errors, []);
    const result = { status: "passed", evidence_type: "browser_with_fixture_native_bridge", checks, errors, live_model_verified: false };
    await fs.writeFile(path.join(artifacts, "workspace-smoke.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
