const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { PersonalService } = require("../electron/personal.cjs");
const { SlackConnector } = require("../electron/slack.cjs");
const token = "xoxb-fixture-not-a-real-token";
function setup(t, fetchImpl, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "btk-slack-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const safeStorage = { isEncryptionAvailable: () => true,
    encryptString: text => { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decryptString: data => { const cipher = crypto.createDecipheriv("aes-256-gcm", key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString(); } };
  const personal = new PersonalService({ directory, safeStorage });
  personal.setMode("personal");
  const slack = new SlackConnector({ personal, fetchImpl, ...options });
  return { slack, personal };
}
const reply = body => new Response(JSON.stringify(body));
const auth = () => reply({ ok: true, team: "Fixture", team_id: "T123" });
test("Slack config encrypts token, exposes metadata only and never requests on save", t => {
  const { slack, personal } = setup(t, () => assert.fail("unexpected network"));
  assert.equal(slack.state().tokenConfigured, false);
  slack.save(token);
  assert.equal(slack.state().enabled, true);
  assert.equal(slack.state().authenticated, false);
  assert.equal(JSON.stringify(slack.state()).includes(token), false);
  assert.equal(JSON.stringify(personal.state()).includes(token), false);
  assert.equal(fs.readFileSync(personal.file, "utf8").includes(token), false);
});
test("Slack bot token format and unavailable secure storage fail closed", t => {
  const { slack, personal } = setup(t, auth);
  for (const value of ["", "xoxp-fixture-user-token", "xoxb-short", "xoxb-fixture\nmalformed", 123]) assert.throws(() => slack.save(value));
  personal.safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => slack.save(token));
  assert.equal(slack.state().tokenConfigured, false);
});
test("auth.test pins Slack URL, uses header auth and disallows redirects", async t => {
  let request;
  const { slack } = setup(t, async (url, options) => { request = { url, options }; return auth(); });
  slack.save(token);
  const state = await slack.call("auth.test");
  assert.equal(request.url, "https://slack.com/api/auth.test");
  assert.equal(request.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.body, "");
  assert.equal(state.authenticated, true);
  assert.equal(state.agentCallable, false);
  assert.equal(state.channelStatus, "unchecked");
});
test("channel listing requests only public channels and supports bounded cursor pages", async t => {
  let body;
  const { slack } = setup(t, async (url, options) => { body = new URL(url).searchParams; assert.equal(options.method, "GET"); assert.equal(options.body, undefined); return reply({ ok: true, channels: [{ id: "C123", name: "general", is_member: true, topic: { value: "not returned" } }], response_metadata: { next_cursor: "next==" } }); });
  slack.save(token);
  const result = await slack.call("conversations.list", "current==");
  assert.equal(body.get("types"), "public_channel"); assert.equal(body.get("cursor"), "current=="); assert.equal(body.get("limit"), "50");
  assert.deepEqual(result.channels, [{ id: "C123", name: "general", member: true }]);
  assert.equal(result.nextCursor, "next==");
  assert.equal(slack.state().channelStatus, "verified");
});
test("missing_scope is sanitized and marks channel check failed", async t => {
  const { slack } = setup(t, async () => reply({ ok: false, error: "missing_scope", detail: token }));
  slack.save(token);
  await assert.rejects(slack.call("conversations.list"), error => error.message.includes("channels:read") && !error.message.includes(token));
  assert.equal(slack.state().channelStatus, "failed");
});
test("revocation clears previously observed authentication", async t => {
  let revoked = false;
  const { slack } = setup(t, async () => revoked ? reply({ ok: false, error: "token_revoked" }) : auth());
  slack.save(token); await slack.call("auth.test"); revoked = true;
  await assert.rejects(slack.call("conversations.list"));
  assert.equal(slack.state().authenticated, false);
});
test("rate limiting, response errors and thrown strings cannot expose token", async t => {
  for (const fetchImpl of [async () => new Response(token, { status: 429 }), async () => reply({ ok: false, error: token }), async () => { throw new Error(token); }]) {
    const { slack } = setup(t, fetchImpl); slack.save(token);
    await assert.rejects(slack.call("auth.test"), error => !error.message.includes(token));
  }
});
test("no write methods, malformed cursors or enterprise invocation", async t => {
  const { slack, personal } = setup(t, () => assert.fail("unexpected network")); slack.save(token);
  await assert.rejects(slack.call("chat.postMessage"));
  await assert.rejects(slack.call("conversations.list", "cursor\nvalue"));
  personal.setMode("enterprise");
  await assert.rejects(slack.call("auth.test")); assert.throws(() => slack.save(token));
});
test("disabling, deleting, replacing and restart invalidate verification", async t => {
  const { slack, personal } = setup(t, auth); slack.save(token); await slack.call("auth.test");
  assert.equal(new SlackConnector({ personal }).state().authenticated, false);
  slack.enable(false); await assert.rejects(slack.call("auth.test"));
  slack.enable(true); assert.equal(slack.state().authenticated, false);
  await slack.call("auth.test"); slack.save(token); assert.equal(slack.state().authenticated, false);
  slack.remove(); assert.equal(personal.data.slack.encryptedToken, ""); await assert.rejects(slack.call("auth.test"));
});
test("active connector prevents mode/key changes and is cancellable", async t => {
  const { slack, personal } = setup(t, (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  slack.save(token); const pending = slack.call("auth.test");
  assert.throws(() => personal.setMode("enterprise")); assert.throws(() => slack.remove());
  await assert.rejects(slack.call("conversations.list"));
  slack.cancel(); await assert.rejects(pending, /취소/);
  assert.equal(personal.connectorActive, null);
});
test("Slack timeout releases lock without retry", async t => {
  const { slack, personal } = setup(t, (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))), { timeoutMs: 10 });
  slack.save(token); await assert.rejects(slack.call("auth.test"), /시간/); assert.equal(personal.connectorActive, null);
});
test("malformed and oversized Slack payloads are rejected", async t => {
  for (const body of [{ ok: true, channels: "bad" }, { ok: true, channels: [{ id: "bad", name: "bad" }] }, { ok: true, channels: [], response_metadata: { next_cursor: token } }]) {
    const { slack } = setup(t, async () => reply(body)); slack.save(token); await assert.rejects(slack.call("conversations.list"));
  }
  const { slack } = setup(t, async () => new Response("a".repeat(2100000))); slack.save(token); await assert.rejects(slack.call("auth.test"));
});
test("Slack upstream token echoes in names are redacted", async t => {
  const { slack } = setup(t, async () => reply({ ok: true, team: token, team_id: "T123" })); slack.save(token);
  assert.equal((await slack.call("auth.test")).team, "[REDACTED]");
});
