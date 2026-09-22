const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const playwright = require(process.env.PLAYWRIGHT_PATH || "playwright");
const appRoot = path.resolve(__dirname, "..");
const artifacts = path.join(appRoot, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const packaged = process.argv.includes("--packaged");
const native = packaged || process.argv.includes("--native");
const liveChat = process.argv.includes("--live-chat");
const previewUrl = process.env.BTK_DESKTOP_PREVIEW_URL || "http://127.0.0.1:4380";

(async () => {
  let app, browser;
  const errors = [];
  const checks = [];
  const nativeProfile = native ? fs.mkdtempSync(path.join(os.tmpdir(), "btk-native-smoke-")) : null;
  try {
    let page;
    if (native) {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await playwright._electron.launch({
        executablePath: packaged ? (process.env.BTK_DESKTOP_TEST_EXE || path.join(appRoot, 'release/win-unpacked/AEGIS Agent Ops Preview.exe')) : path.join(
          appRoot,
          "node_modules/electron/dist/electron.exe",
        ),
        args: [...(packaged ? [] : [appRoot]), `--user-data-dir=${nativeProfile}`],
        env,
        timeout: 45000,
      });
      page = await app.firstWindow();
      await page.evaluate(() => window.btk.personal.mode('enterprise'));
      await page.reload();
    } else {
      browser = await playwright.chromium.launch({
        channel: "chrome",
        headless: true,
      });
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    }
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    if (!native) await page.goto(previewUrl);
    await page
      .getByRole("heading", { name: "지금 무엇을 확인할까요?" })
      .waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector('button[aria-label="기록 새로고침"]').disabled,
    );
    assert.equal(
      (await page.locator(".sidebar-bottom small").innerText()) === "연결 중",
      false,
    );
    await page.screenshot({
      path: path.join(
        artifacts,
        native ? "native-chat.png" : "desktop-chat.png",
      ),
      fullPage: true,
    });
    checks.push("actual_profile_loaded");
    if (native) {
      const bridge = await page.evaluate(() => ({
        keys: Object.keys(window.btk),
        require: typeof window.require,
        process: typeof window.process,
      }));
      assert.equal(bridge.require, "undefined");
      assert.equal(bridge.process, "undefined");
      assert.equal(bridge.keys.includes("exec"), false);
      checks.push("renderer_sandbox_and_narrow_preload");
      if (packaged) {
        const readiness = await page.evaluate(() => window.btk.readiness());
        assert.equal(readiness.release.bundled, true);
        assert.equal(readiness.release.version, require('../package.json').version);
        checks.push('packaged_core_verified');
      }
    } else {
      const denied = await page.request.post(
        `${previewUrl}/api/desktop/chat`,
        { data: {} },
      );
      assert.equal(denied.status(), 403);
      for (const method of ['setup_enroll', 'setup_install', 'agent_start']) {
        const response = await page.request.post(`${previewUrl}/api/desktop/${method}`, { data: {} });
        assert.equal(response.status(), 403);
      }
      checks.push('browser_rejects_enrollment_and_installation');
      const crossOrigin = await page.request.get(
        `${previewUrl}/api/desktop/snapshot`,
        { headers: { Origin: "https://untrusted.invalid" } },
      );
      assert.equal(crossOrigin.status(), 403);
      const invalidTask = await page.request.get(
        `${previewUrl}/api/desktop/task?task_id=../outside`,
      );
      assert.equal(invalidTask.status(), 503);
      checks.push("preview_rejects_chat_cross_origin_and_path_escape");
    }
    await page
      .getByRole("button", { name: "실행 기록", exact: false })
      .first()
      .click();
    await page
      .getByRole("heading", { name: "실행 기록", exact: true })
      .waitFor();
    const rows = await page.locator("tbody tr").count();
    assert.ok(
      rows > 0,
      "real local run records should be present on this workstation",
    );
    await page
      .getByRole("textbox", { name: "실행 기록 검색" })
      .fill("no-matching-task-xyz");
    assert.equal(await page.locator("tbody tr").count(), 0);
    await page.getByRole("textbox", { name: "실행 기록 검색" }).fill("");
    await page.locator(".task-link").first().click();
    await page.locator("dialog[open]").waitFor();
    await page.waitForFunction(
      () => !document.querySelector("dialog .thinking"),
    );
    assert.ok(
      await page
        .locator("dialog[open]")
        .innerText()
        .then((text) => text.includes("status.json")),
    );
    await page.screenshot({
      path: path.join(
        artifacts,
        native ? "native-detail.png" : "desktop-detail.png",
      ),
      fullPage: true,
    });
    await page.getByRole("button", { name: "상세 닫기" }).click();
    await page.screenshot({
      path: path.join(
        artifacts,
        native ? "native-history.png" : "desktop-history.png",
      ),
      fullPage: true,
    });
    checks.push(`search_and_task_detail_${rows}_real_records`);
    await page.getByRole("button", { name: "연결 상태", exact: true }).click();
    await page.getByRole("heading", { name: "중앙 연결" }).waitFor();
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].find((el) =>
          el.textContent.includes("다시 확인"),
        )?.disabled,
    );
    checks.push("connection_refresh");
    await page.screenshot({
      path: path.join(
        artifacts,
        native ? "native-runtime.png" : "desktop-runtime.png",
      ),
      fullPage: true,
    });
    await page.getByRole("button", { name: "프로파일", exact: true }).click();
    await page.getByRole("heading", { name: "대화 모델" }).waitFor();
    checks.push("profile_model_view");
    await page.getByRole('button', { name: '설치 점검', exact: true }).click();
    await page.getByRole('heading', { name: '시작 전 점검' }).waitFor();
    await page.getByRole('button', { name: '다시 점검', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(el => el.textContent.includes('다시 점검'))?.disabled);
    await page.screenshot({ path: path.join(artifacts, native ? 'native-readiness.png' : 'desktop-readiness.png'), fullPage: true });
    checks.push('read_only_install_readiness');
    await page
      .getByRole("button", { name: "에이전트 대화", exact: true })
      .click();
    if (native && liveChat) {
      await page
        .getByRole("textbox", { name: "메시지", exact: true })
        .fill(
          '데스크톱 연결 테스트입니다. 도구를 사용하지 말고 한국어로 "연결 확인" 두 단어만 답하세요.',
        );
      await page
        .getByRole("button", { name: "메시지 전송", exact: true })
        .click();
      await page
        .getByRole("button", { name: "답변 중단", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "메시지 전송", exact: true })
        .waitFor({ timeout: 80000 });
      const result = await page
        .locator(".message.assistant")
        .last()
        .innerText();
      checks.push(
        `live_chat_${result.includes("답변을 완료하지 못했습니다") ? "failed" : "responded"}`,
      );
      fs.writeFileSync(path.join(artifacts, "live-chat.txt"), result);
      assert.ok(result.includes('연결 확인'), 'live model must return the requested answer');
      assert.equal(result.includes('답변을 완료하지 못했습니다'), false);
      await page.screenshot({
        path: path.join(artifacts, "native-live-chat.png"),
        fullPage: true,
      });
      await page
        .getByRole("textbox", { name: "메시지", exact: true })
        .fill("현재 컨텍스트의 실행 기록을 한국어로 간단히 요약해 주세요.");
      await page
        .getByRole("button", { name: "메시지 전송", exact: true })
        .click();
      await page
        .getByRole("button", { name: "답변 중단", exact: true })
        .click();
      await page
        .getByRole("button", { name: "메시지 전송", exact: true })
        .waitFor({ timeout: 15000 });
      checks.push("native_chat_cancel");
    }
    if (!native) {
      for (const width of [390, 768, 1920]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1080,
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        assert.equal(overflow, false, `page overflow at ${width}`);
        const overlaps = await page.evaluate(() => {
          const selectors = [
            ".page-heading",
            ".conversation-bar",
            ".composer",
            ".topbar",
          ];
          return selectors.filter((selector) => {
            const el = document.querySelector(selector);
            return el && el.scrollWidth > el.clientWidth + 1;
          });
        });
        assert.deepEqual(overlaps, [], `element overflow at ${width}`);
        await page.screenshot({
          path: path.join(artifacts, `chat-${width}.png`),
          fullPage: true,
        });
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      checks.push("responsive_390_768_1920_no_overflow");
      await page.setViewportSize({ width: 390, height: 844 });
      for (const name of ["실행 기록", "연결 상태", "프로파일", "설치 점검"]) {
        await page.locator('nav button').filter({ hasText: name }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name);
        await page.screenshot({ path: path.join(artifacts, `mobile-${name}.png`), fullPage: true });
      }
      checks.push("mobile_history_runtime_profile_no_page_overflow");
    }
    assert.deepEqual(errors, []);
    const result = {
      mode: packaged ? "packaged_native" : native ? "native" : "browser",
      checks,
      errors,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(artifacts, packaged ? "packaged-native-smoke.json" : native ? "native-smoke.json" : "browser-smoke.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    if (app) await app.close();
    if (browser) await browser.close();
    if (nativeProfile && path.dirname(nativeProfile) === path.resolve(os.tmpdir()))
      fs.rmSync(nativeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
