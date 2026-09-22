const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { PersonalService, validateModel } = require("../electron/personal.cjs");
const model = { provider: "compatible", endpoint: "https://models.example.test/v1", model: "fixture-model", maxTokens: 512 };
const fixtureKey = "fixture-only-not-a-real-key";
const providers = require("../electron/providers.json");
function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "btk-personal-unit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const encryptionKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "dpapi",
    encryptString: text => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
      return Buffer.concat([iv, cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString: data => {
      const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString("utf8");
    },
  };
  const options = { directory, safeStorage, ...overrides };
  const service = new PersonalService(options);
  return { directory, service, options };
}
const response = (text = "fixture answer", extra = {}) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 }, ...extra }));

test("fresh personal setup does not access central state or start networking", t => {
  const { service } = setup(t, { fetchImpl: () => assert.fail("unexpected network") });
  assert.equal(service.state().mode, null);
  assert.equal(service.setMode("personal").mode, "personal");
  assert.equal(service.state().keyConfigured, false);
});

for (const provider of providers.filter(item => ["deepseek", "kimi", "gemini"].includes(item.id))) {
  test(`${provider.id} pins its endpoint and uses its explicit encrypted key`, async t => {
    let captured;
    const { service, options } = setup(t, { fetchImpl: async (url, options) => { captured = { url, ...options }; return response(); } });
    service.setMode("personal");
    const config = { provider: provider.id, endpoint: provider.endpoint, model: provider.model, maxTokens: provider.maxTokens };
    assert.throws(() => service.save({ ...config, endpoint: "https://other.example.test/v1", apiKey: fixtureKey }));
    assert.throws(() => service.save(config), /API/);
    service.save({ ...config, apiKey: fixtureKey });
    assert.equal(captured, undefined);
    assert.equal(new PersonalService(options).state().provider, provider.id);
    await service.complete([{ role: "user", content: "hello" }], { probe: true });
    assert.equal(captured.url, provider.endpoint + "/chat/completions");
    assert.equal(captured.headers.Authorization, `Bearer ${fixtureKey}`);
    assert.equal(captured.redirect, "error");
    const body = JSON.parse(captured.body);
    assert.equal(body.model, provider.model);
    assert.equal(body.max_tokens, provider.probeTokens);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(JSON.stringify(service.state()).includes(fixtureKey), false);
    const other = providers.find(item => item.fixedEndpoint && item.id !== provider.id);
    assert.throws(() => service.save({ ...config, provider: other.id, endpoint: other.endpoint }), /API/);
    assert.equal(service.state().provider, provider.id);
  });
}
test("endpoint validation rejects unsafe schemes, credentials, queries and remote HTTP", () => {
  for (const endpoint of ["file:///etc/passwd", "http://models.example.test/v1", "https://u:p@models.example.test", "https://models.example.test/?key=x", "https://models.example.test/#fragment", "https://models.example.test/\\bad"]) assert.throws(() => validateModel({ ...model, endpoint }));
  for (const endpoint of ["http://127.0.0.1:11434/v1", "http://localhost:11434/v1", "http://[::1]:11434/v1"]) assert.equal(validateModel({ ...model, provider: "local", endpoint }).endpoint, endpoint);
  assert.throws(() => validateModel({ ...model, provider: "local" }));
  assert.throws(() => validateModel({ ...model, provider: "openai" }));
  for (const maxTokens of [0, 63, 16385, 1.2, "512"]) assert.throws(() => validateModel({ ...model, maxTokens }));
});
test("keys are encrypted at rest and absent from renderer state", t => {
  const { service, options } = setup(t);
  service.setMode("personal");
  const state = service.save({ ...model, apiKey: fixtureKey });
  assert.equal(state.keyConfigured, true);
  assert.equal(JSON.stringify(state).includes(fixtureKey), false);
  const record = fs.readFileSync(service.file, "utf8");
  assert.equal(record.includes(fixtureKey), false);
  assert.equal(new PersonalService(options).state().keyConfigured, true);
  assert.equal(service.removeKey().keyConfigured, false);
});
test("missing encryption or basic_text storage never writes a key", t => {
  for (const safeStorage of [{ isEncryptionAvailable: () => false }, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" }]) {
    const { service } = setup(t, { safeStorage });
    assert.throws(() => service.save({ ...model, apiKey: fixtureKey }), /OS/);
    assert.equal(fs.existsSync(service.file), false);
  }
});
test("saved credentials remain bound to provider and exact API path", t => {
  const { service } = setup(t);
  service.save({ ...model, apiKey: fixtureKey });
  service.save({ ...model, model: "another-model" });
  for (const endpoint of ["https://other.example.test/v1", "https://models.example.test/other"]) assert.throws(() => service.save({ ...model, endpoint }), /API/);
  assert.equal(service.state().endpoint, model.endpoint);
  service.save({ ...model, provider: "local", endpoint: "http://localhost:11434/v1" });
  assert.equal(service.state().keyConfigured, false);
});
test("chat uses only explicit key and messages, not filesystem or environment", async t => {
  let captured;
  const { service } = setup(t, { fetchImpl: async (url, options) => { captured = { url, options }; return response(); } });
  service.setMode("personal"); service.save({ ...model, apiKey: fixtureKey });
  const result = await service.complete([{ role: "user", content: "hello" }]);
  assert.equal(captured.url, model.endpoint + "/chat/completions");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.headers.Authorization, `Bearer ${fixtureKey}`);
  assert.deepEqual(JSON.parse(captured.options.body), { model: model.model, messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 512 });
  assert.equal(result.status, "completed");
  assert.equal(result.usage.total_tokens, 9);
});
test("official provider uses completion limit; probe has a small limit", async t => {
  let body;
  const { service } = setup(t, { fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return response(); } });
  service.setMode("personal"); service.save({ ...model, provider: "openai", endpoint: "https://api.openai.com/v1", apiKey: fixtureKey });
  await service.complete([{ role: "user", content: "hello" }], { probe: true });
  assert.equal(body.max_completion_tokens, 64);
  assert.equal(body.max_tokens, undefined);
});
test("local model requires no key and sends no inherited authorization", async t => {
  const { service } = setup(t, { fetchImpl: async (_url, options) => { assert.equal(options.headers.Authorization, undefined); return response(); } });
  service.setMode("personal"); service.save({ ...model, provider: "local", endpoint: "http://127.0.0.1:11434/v1" });
  await service.complete([{ role: "user", content: "hello" }]);
});
test("error bodies and network exception strings cannot echo keys", async t => {
  for (const fetchImpl of [async () => new Response(fixtureKey, { status: 401 }), async () => { throw new Error(fixtureKey); }]) {
    const { service } = setup(t, { fetchImpl });
    service.setMode("personal"); service.save({ ...model, apiKey: fixtureKey });
    await assert.rejects(service.complete([{ role: "user", content: "hello" }]), error => !error.message.includes(fixtureKey));
  }
});
test("model echo of stored key is redacted and usage is validated", async t => {
  const { service } = setup(t, { fetchImpl: async () => response(fixtureKey, { usage: { total_tokens: -1, prompt_tokens: "9" } }) });
  service.setMode("personal"); service.save({ ...model, apiKey: fixtureKey });
  const result = await service.complete([{ role: "user", content: "hello" }]);
  assert.equal(result.text, "[REDACTED]"); assert.deepEqual(result.usage, {});
});
test("malformed and oversized responses are rejected; truncation is not completion", async t => {
  for (const fetchImpl of [async () => new Response("not JSON"), async () => new Response("a".repeat(2100000)), async () => response("")]) {
    const { service } = setup(t, { fetchImpl });
    service.setMode("personal"); service.save({ ...model, apiKey: fixtureKey });
    await assert.rejects(service.complete([{ role: "user", content: "hello" }]));
  }
  const { service } = setup(t, { fetchImpl: async () => response("partial", { choices: [{ message: { content: "partial" }, finish_reason: "length" }] }) });
  service.setMode("personal"); service.save({ ...model, apiKey: fixtureKey });
  assert.equal((await service.complete([{ role: "user", content: "hello" }])).status, "partial");
});
test("cancel aborts active fetch and guards model/mode changes", async t => {
  const { service } = setup(t, { fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))) });
  service.setMode("personal"); service.save({ ...model, apiKey: fixtureKey });
  const pending = service.complete([{ role: "user", content: "hello" }]);
  assert.throws(() => service.setMode("enterprise"));
  assert.throws(() => service.removeKey());
  await assert.rejects(service.complete([{ role: "user", content: "again" }]));
  assert.equal(service.cancel().cancelled, true);
  await assert.rejects(pending, /취소/);
  assert.equal(service.active, null);
});
test("timeout aborts without retries or leaving an active request", async t => {
  const { service } = setup(t, { timeoutMs: 10, fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))) });
  service.setMode("personal"); service.save({ ...model, apiKey: fixtureKey });
  await assert.rejects(service.complete([{ role: "user", content: "hello" }]), /시간/);
  assert.equal(service.active, null);
});
test("enterprise mode and invalid message roles cannot call a model", async t => {
  const { service } = setup(t, { fetchImpl: () => assert.fail("unexpected network") });
  service.setMode("enterprise"); service.save({ ...model, apiKey: fixtureKey });
  await assert.rejects(service.complete([{ role: "user", content: "hello" }]));
  service.setMode("personal");
  for (const messages of [[], [{ role: "system", content: "hello" }], [{ role: "user", content: "x".repeat(100001) }]]) await assert.rejects(service.complete(messages));
});
test("workspace selection records a directory without reading its contents", t => {
  const { service, directory } = setup(t);
  assert.equal(service.workspace(directory).workspace, fs.realpathSync(directory));
  assert.throws(() => service.workspace(service.file));
});
test("corrupt settings fail closed and are never replaced", t => {
  const { service, options } = setup(t);
  fs.writeFileSync(service.file, "broken");
  assert.throws(() => new PersonalService(options));
  assert.equal(fs.readFileSync(service.file, "utf8"), "broken");
});
