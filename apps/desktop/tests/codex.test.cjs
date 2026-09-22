const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { CodexConnection, safeAuthUrl, childEnvironment, lockedConfig } = require("../electron/codex.cjs");
const { PersonalService } = require("../electron/personal.cjs");

function fixture(t, custom = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "btk-codex-unit-"));
  const calls = [];
  let child;
  const emit = data => child.stdout.write(JSON.stringify(data) + "\n");
  const spawnImpl = (exe, args, options) => {
    calls.push({ exe, args, options });
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; };
    child.stdin = new Writable({ write(chunk, encoding, callback) {
      const message = JSON.parse(chunk.toString()); calls.push(message); callback();
      if (message.id == null || !message.method || custom.silent) return;
      setImmediate(() => {
        if (custom.handle?.(message, emit)) return;
        const results = {
          initialize: {}, "account/read": { account: { type: "chatgpt", planType: "plus", accessToken: "fixture-secret-not-real" } },
          "account/login/start": { loginId: "fixture-login", authUrl: "https://auth.openai.com/oauth/authorize?state=fixture-not-real" },
          "model/list": { data: [{ model: "fixture-model", displayName: "Fixture model" }, { model: "hidden-model", hidden: true }] },
          "thread/start": { thread: { id: "fixture-thread" } }, "turn/start": { turn: { id: "fixture-turn" } },
        };
        emit({ id: message.id, result: results[message.method] || {} });
        if (message.method === "turn/start" && !custom.wait) {
          emit({ method: "item/completed", params: { threadId: "fixture-thread", item: { type: "agentMessage", text: "fixture response" } } });
          emit({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { status: "completed" } } });
        }
      });
    } });
    return child;
  };
  const opened = [];
  const service = new CodexConnection({ directory, executable: "fixture-codex", spawnImpl, timeoutMs: custom.timeoutMs || 1000, openExternal: async url => opened.push(url) });
  t.after(() => { service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { service, calls, opened, emit, directory, child: () => child };
}

test("Codex startup is lazy, isolates home and strips inherited credentials", async t => {
  const f = fixture(t); assert.equal(f.calls.length, 0);
  const state = await f.service.state();
  assert.deepEqual(state, { connected: true, plan: "plus", pending: false, error: "" });
  assert.equal(JSON.stringify(state).includes("fixture-secret"), false);
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.equal(f.calls[0].options.shell, false);
  assert.equal(f.calls[0].options.env.CODEX_HOME, path.join(f.directory, "codex-home"));
  assert.equal(childEnvironment("fixture-home").OPENAI_API_KEY, undefined);
  assert.equal(lockedConfig.cli_auth_credentials_store, "keyring");
  assert.equal(lockedConfig["features.shell_tool"], false);
  assert.equal(lockedConfig.sandbox_mode, "read-only");
});
test("Codex login opens only an official HTTPS URL and supports cancel", async t => {
  const f = fixture(t); await f.service.login();
  assert.equal(f.opened.length, 1); assert.equal((await f.service.state()).pending, true);
  await f.service.cancelLogin(); assert.equal(f.service.loginId, null);
  assert.ok(f.calls.some(call => call.method === "account/login/cancel"));
  for (const url of ["http://auth.openai.com/", "https://auth.openai.com.evil.test/", "file:///C:/test", "https://user@auth.openai.com/", "https://auth.openai.com:444/"]) assert.throws(() => safeAuthUrl(url));
});
test("login completion checks login identity and never exposes the raw error", async t => {
  const f = fixture(t); await f.service.login();
  f.emit({ method: "account/login/completed", params: { loginId: "other", success: true } });
  assert.equal(f.service.loginId, "fixture-login");
  f.emit({ method: "account/login/completed", params: { loginId: "fixture-login", success: false, error: "fixture-secret-not-real" } });
  assert.equal(f.service.loginId, null); assert.equal(f.service.loginError.includes("fixture-secret"), false);
});
test("Codex models return a sanitized visible list", async t => {
  const f = fixture(t); assert.deepEqual(await f.service.models(), [{ id: "fixture-model", name: "Fixture model" }]);
});
test("quota view exposes only measured numeric fields", async t => {
  const f = fixture(t, { handle: (message, emit) => {
    if (message.method !== "account/rateLimits/read") return false;
    emit({ id: message.id, result: { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000, token: "fixture-not-real" }, secondary: { usedPercent: "invalid" } } } }); return true;
  } });
  assert.deepEqual(await f.service.limits(), [{ name: "primary", usedPercent: 25, windowMinutes: 300, resetsAt: 1800000000 }]);
});
test("failed turns never become completed even when a text item arrived", async t => {
  const f = fixture(t, { handle: (message, emit) => {
    if (message.method !== "turn/start") return false;
    emit({ id: message.id, result: {} });
    emit({ method: "item/completed", params: { threadId: "fixture-thread", item: { type: "agentMessage", text: "unfinished" } } });
    emit({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { status: "failed", error: "fixture-not-real" } } }); return true;
  } });
  await assert.rejects(f.service.complete([{ role: "user", content: "hello" }], "fixture-model"), /완료되지/);
});
test("Codex chat creates an ephemeral isolated read-only thread", async t => {
  const f = fixture(t); const result = await f.service.complete([{ role: "user", content: "hello" }], "fixture-model");
  assert.equal(result.text, "fixture response"); assert.equal(result.status, "completed");
  const start = f.calls.find(call => call.method === "thread/start");
  assert.equal(start.params.ephemeral, true); assert.equal(start.params.cwd, path.join(f.directory, "codex-workspace"));
  assert.equal(start.params.approvalPolicy, "never"); assert.equal(f.service.active, null);
});
test("tool approvals are rejected and RPC errors are sanitized", async t => {
  const f = fixture(t, { handle: (message, emit) => {
    if (message.method !== "model/list") return false;
    emit({ id: message.id, error: { message: "fixture-secret-not-real" } }); return true;
  } });
  await assert.rejects(f.service.models(), error => !error.message.includes("fixture-secret"));
  f.emit({ id: "approval", method: "item/commandExecution/requestApproval", params: {} });
  assert.equal(f.calls.at(-1).error.code, -32601);
});
test("cancel terminates the owned runtime and rejects its pending turn", async t => {
  const f = fixture(t, { wait: true });
  const result = f.service.complete([{ role: "user", content: "wait" }], "fixture-model");
  while (!f.calls.some(call => call.method === "turn/start")) await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(f.service.cancel(), { cancelled: true });
  await assert.rejects(result, /취소/); assert.equal(f.child().killed, true);
});
test("RPC timeout stops the runtime without retries", async t => {
  const f = fixture(t, { silent: true, timeoutMs: 10 });
  await assert.rejects(f.service.state(), /시간/); assert.equal(f.child().killed, true); assert.equal(f.service.pending.size, 0);
});
test("invalid chat input never starts Codex", async t => {
  const f = fixture(t); await assert.rejects(f.service.complete([{ role: "system", content: "no" }], "model")); assert.equal(f.calls.length, 0);
});
test("switching to Codex preserves API settings and guards active work", t => {
  const f = fixture(t);
  const personal = new PersonalService({ directory: f.directory, safeStorage: { isEncryptionAvailable: () => false } });
  personal.setMode("personal"); personal.save({ provider: "local", endpoint: "http://127.0.0.1:11434/v1", model: "local-model", maxTokens: 1024 });
  personal.connection("codex"); personal.codexModel("codex-fixture"); assert.equal(personal.state().model, "codex-fixture");
  personal.connection("api"); assert.equal(personal.state().model, "local-model");
  personal.codexActive = true; assert.throws(() => personal.connection("codex"));
});
