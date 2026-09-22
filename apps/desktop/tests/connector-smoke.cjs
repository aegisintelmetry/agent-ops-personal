const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const output = path.resolve(__dirname, "../artifacts");
  const checks = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const personal = { mode: "personal", provider: "local", endpoint: "http://127.0.0.1:11434/v1", model: "fixture-model", maxTokens: 1024, workspace: "", keyConfigured: false, secureStorage: true };
      let slack = { tokenConfigured: false, enabled: false, authenticated: false, checkedAt: null, channelsCheckedAt: null, channelStatus: "unchecked", agentCallable: false };
      window.fixtureSlackCalls = 0;
      window.fixtureSlackError = false;
      window.btk = { native: true, personal: {
        state: async () => personal,
        chat: async messages => {
          const text = messages.at(-1).content;
          if (text === "fail") throw new Error("fixture failure");
          return { text: "fixture answer", status: text === "partial" ? "partial" : "completed", usage: { total_tokens: 12 } };
        },
        slack: {
          state: async () => ({ ...slack }),
          save: async () => { slack = { ...slack, tokenConfigured: true, enabled: true, authenticated: false }; return { ...slack }; },
          remove: async () => { slack = { tokenConfigured: false, enabled: false, authenticated: false }; return { ...slack }; },
          enable: async enabled => { slack = { ...slack, enabled, authenticated: false }; return { ...slack }; },
          test: async () => { window.fixtureSlackCalls++; slack = { ...slack, authenticated: true, checkedAt: new Date().toISOString(), team: "Fixture workspace" }; return { ...slack }; },
          channels: async cursor => {
            window.fixtureSlackCalls++;
            if (window.fixtureSlackError) { slack.channelStatus = "failed"; throw new Error("channels:read 권한 부족"); }
            slack.channelStatus = "verified"; slack.channelsCheckedAt = new Date().toISOString();
            return { channels: [{ id: cursor ? "C2" : "C1", name: cursor ? "project-ops" : "general", member: true }], nextCursor: cursor ? "" : "page2", connector: { ...slack } };
          },
        },
      } };
    });
    await page.goto(process.env.BTK_DESKTOP_PREVIEW_URL || "http://127.0.0.1:4381");
    await page.getByRole("complementary", { name: "실행 요약" }).waitFor();
    await page.getByText("요청 없음", { exact: true }).waitFor();
    await page.getByText("생성된 파일 없음", { exact: true }).waitFor();
    checks.push("summary_has_no_fabricated_progress_files_or_skills");
    await page.getByLabel("개인 메시지", { exact: true }).fill("hello");
    await page.getByRole("button", { name: "개인 메시지 전송", exact: true }).click();
    await page.locator(".summary-run-state").filter({ hasText: "완료" }).waitFor();
    assert.equal(await page.locator('.run-summary li[data-state="completed"]').count(), 3);
    checks.push("summary_tracks_completed_response");
    await page.getByLabel("개인 메시지", { exact: true }).fill("partial");
    await page.getByRole("button", { name: "개인 메시지 전송", exact: true }).click();
    await page.locator(".summary-run-state").filter({ hasText: "부분 응답" }).waitFor();
    assert.equal(await page.locator('.run-summary li[data-state="completed"]').count(), 1);
    await page.getByLabel("개인 메시지", { exact: true }).fill("fail");
    await page.getByRole("button", { name: "개인 메시지 전송", exact: true }).click();
    await page.locator(".summary-run-state").filter({ hasText: "실패" }).waitFor();
    checks.push("partial_and_failed_requests_never_show_completed");
    await page.getByRole("button", { name: "새 대화", exact: true }).click();
    await page.getByText("요청 없음", { exact: true }).waitFor();
    checks.push("new_session_resets_summary");
    await page.getByRole("button", { name: "커넥터", exact: true }).click();
    await page.getByLabel("샘플 보기", { exact: true }).check();
    await page.getByText("샘플 데이터 · 실제 Slack 연결 아님", { exact: true }).waitFor();
    await page.getByText("general", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureSlackCalls), 0);
    checks.push("sample_mode_is_explicit_and_never_calls_slack");
    await fs.mkdir(output, { recursive: true });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `connector overflow ${width}`);
      await page.screenshot({ path: path.join(output, `slack-sample-${width}.png`), fullPage: true });
    }
    checks.push("connector_layout_390_768_1440");
    await page.getByLabel("샘플 보기", { exact: true }).uncheck();
    assert.equal(await page.getByText("general", { exact: true }).count(), 0);
    await page.getByLabel("Slack Bot 토큰", { exact: true }).fill("xoxb-fixture-not-real");
    await page.getByRole("button", { name: "토큰 저장", exact: true }).click();
    await page.getByText("토큰 저장됨 · 미검증", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Slack Bot 토큰", { exact: true }).inputValue(), "");
    assert.equal(await page.evaluate(() => window.fixtureSlackCalls), 0);
    await page.getByRole("button", { name: "Slack 연결 확인", exact: true }).click();
    await page.getByText("인증 확인됨", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Slack 채널 새로고침", exact: true }).click();
    await page.getByText("general", { exact: true }).waitFor();
    await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
    await page.getByText("project-ops", { exact: true }).waitFor();
    assert.equal(await page.locator(".connector-channel").count(), 2);
    checks.push("token_input_cleared_save_unverified_auth_and_pagination");
    await page.evaluate(() => { window.fixtureSlackError = true; });
    await page.getByRole("button", { name: "Slack 채널 새로고침", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "channels:read" }).waitFor();
    assert.equal(await page.locator(".connector-channel").count(), 0);
    checks.push("failed_refresh_clears_stale_rows_and_shows_scope_error");
    await page.getByLabel("Slack 사용", { exact: true }).uncheck();
    await page.getByText("비활성", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Slack 채널 새로고침", exact: true }).isDisabled(), true);
    await page.getByLabel("Slack 사용", { exact: true }).check();
    await page.getByRole("button", { name: "작업 공간", exact: true }).click();
    await page.getByText("모델 자동 호출 미연결", { exact: true }).waitFor();
    await page.getByText("conversations.list", { exact: true }).waitFor();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `summary overflow ${width}`);
      await page.screenshot({ path: path.join(output, `summary-${width}.png`), fullPage: true });
    }
    checks.push("summary_lists_app_tools_not_model_tools", "summary_layout_390_768_1440");
    await page.getByRole("button", { name: "실행 요약 표시", exact: true }).click();
    assert.equal(await page.locator(".run-summary").count(), 0);
    await page.getByRole("button", { name: "실행 요약 표시", exact: true }).click();
    await page.getByRole("button", { name: "커넥터", exact: true }).click();
    await page.getByRole("button", { name: "Slack 토큰 삭제", exact: true }).click();
    await page.getByText("미연결", { exact: true }).waitFor();
    checks.push("summary_toggle_and_connector_disconnect");
    assert.deepEqual(errors, []);
    const result = { status: "passed", evidence_type: "browser_fixture_bridge_not_live_slack", checks, errors, live_slack_verified: false, checked_at: new Date().toISOString() };
    await fs.writeFile(path.join(output, "connector-smoke.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
