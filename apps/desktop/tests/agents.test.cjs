const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AgentProfiles } = require("../electron/agents.cjs");
const { PersonalService } = require("../electron/personal.cjs");
const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text.split("").reverse().join("")), decryptString: data => data.toString().split("").reverse().join("") };
const local = model => ({ provider: "local", endpoint: "http://127.0.0.1:11434/v1", model, maxTokens: 512 });
function setup(t, factory) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "btk-agent-profiles-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { directory, safeStorage, ...(factory ? { serviceFactory: factory } : {}) };
  return { options, profiles: new AgentProfiles(options), directory };
}
test("legacy settings and Codex identity remain at their original paths", t => {
  const { profiles, options, directory } = setup(t);
  profiles.service.setMode("personal");
  profiles.service.save(local("legacy"));
  const before = fs.readFileSync(path.join(directory, "personal.json"), "utf8");
  const restored = new AgentProfiles(options);
  assert.equal(restored.state().model, "legacy");
  assert.equal(restored.location("default"), directory);
  assert.equal(fs.readFileSync(path.join(directory, "personal.json"), "utf8"), before);
});
test('team hierarchy persists without changing selected agent or sharing credentials', t => {
  const { profiles, options } = setup(t);
  profiles.service.setMode('personal');
  profiles.service.save({ ...local('master'), apiKey: 'fixture-only-master-key' });
  const worker = profiles.create('worker');
  profiles.configureTeam({ masterId: 'default', workerIds: [worker.agentId] });
  const state = profiles.teamState();
  assert.equal(state.agents.find(a => a.id === 'default').configured, true);
  assert.equal(state.agents.find(a => a.id === worker.agentId).configured, false);
  assert.equal(JSON.stringify(state).includes('fixture-only'), false);
  assert.equal(JSON.stringify(state).includes('encryptedKey'), false);
  assert.equal(profiles.data.selected, worker.agentId);
  const restored = new AgentProfiles(options);
  assert.deepEqual(restored.teamState(), state);
  restored.service.save(local('worker-model'));
  assert.equal(restored.teamState().agents.find(a => a.id === worker.agentId).configured, true);
  restored.configureTeam({ masterId: 'default', workerIds: [] });
  assert.equal(restored.state().agents.length, 2);
});
test('invalid team membership cannot alter saved hierarchy', t => {
  const { profiles } = setup(t);
  const worker = profiles.create('worker');
  profiles.configureTeam({ masterId: 'default', workerIds: [worker.agentId] });
  const before = fs.readFileSync(profiles.file, 'utf8');
  for (const value of [null, {}, { masterId: 'missing', workerIds: [] }, { masterId: 'default', workerIds: ['default'] }, { masterId: 'default', workerIds: [worker.agentId, worker.agentId] }]) assert.throws(() => profiles.configureTeam(value));
  assert.equal(fs.readFileSync(profiles.file, 'utf8'), before);
});
test("agent settings and keys are independent and persist across restart", t => {
  const { profiles, options } = setup(t);
  profiles.service.setMode("personal");
  profiles.service.save({ ...local("alpha"), apiKey: "fixture-alpha-only" });
  const second = profiles.create("조사");
  assert.equal(second.model, "");
  assert.equal(second.keyConfigured, false);
  profiles.service.save(local("beta"));
  assert.equal(new AgentProfiles(options).state().model, "beta");
  assert.equal(profiles.select("default").model, "alpha");
  assert.equal(profiles.state().keyConfigured, true);
  assert.equal(profiles.select(second.agentId).model, "beta");
  assert.equal(profiles.state().keyConfigured, false);
  assert.equal(JSON.stringify(profiles.state()).includes("fixture-alpha"), false);
  assert.equal(fs.readFileSync(profiles.file, "utf8").includes("encryptedKey"), false);
});
test("model dispatch follows selected agent with no key forwarding", async t => {
  const calls = [];
  const { profiles } = setup(t, options => new PersonalService({ ...options, fetchImpl: async (_url, init) => {
    calls.push({ body: JSON.parse(init.body), key: init.headers.Authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content: "fixture reply" }, finish_reason: "stop" }] }));
  } }));
  profiles.service.setMode("personal");
  profiles.service.save({ ...local("alpha"), apiKey: "fixture-alpha-only" });
  await profiles.service.complete([{ role: "user", content: "alpha request" }]);
  profiles.create("Beta");
  profiles.service.save(local("beta"));
  await profiles.service.complete([{ role: "user", content: "beta request" }]);
  assert.deepEqual(calls.map(c => c.body.model), ["alpha", "beta"]);
  assert.equal(calls[0].key, "Bearer fixture-alpha-only");
  assert.equal(calls[1].key, undefined);
});
test("configuration changes are blocked while a request is running", t => {
  const { profiles } = setup(t);
  profiles.service.active = new AbortController();
  for (const action of [() => profiles.create("new"), () => profiles.select("default"), () => profiles.rename("changed")]) assert.throws(action, /진행 중/);
});
test("names, unregistered IDs, and traversal IDs are rejected", t => {
  const { profiles } = setup(t);
  for (const name of ["", " ", "a".repeat(61), "a\nb", null]) assert.throws(() => profiles.create(name));
  assert.throws(() => profiles.select("../outside"));
  assert.throws(() => profiles.location("../outside"));
  assert.equal(profiles.rename("개발").agentName, "개발");
});
test("corrupt metadata fails closed without rewriting existing configuration", t => {
  const { options, directory } = setup(t);
  const file = path.join(directory, "agents.json");
  fs.writeFileSync(file, JSON.stringify({ schema: 1, selected: "../bad", agents: [{ id: "../bad", name: "bad" }] }));
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() => new AgentProfiles(options), /목록을 읽지/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});
test("agent count is bounded without spawning any runtime", t => {
  const { profiles } = setup(t);
  for (let index = 1; index < 20; index++) profiles.create(`agent ${index}`);
  assert.throws(() => profiles.create("overflow"), /최대 20/);
  assert.equal(profiles.state().agents.length, 20);
});
test("conversation groups never share history between agents", async () => {
  const { initialSessions, agentSessionsReducer: reduce } = await import("../src/sessions.mjs");
  let state = { alpha: initialSessions("a") };
  state = reduce(state, { agentId: "alpha", action: { type: "messages", id: "a", value: [{ role: "user", content: "private alpha" }] } });
  state = reduce(state, { agentId: "beta", action: { type: "ensure", id: "b" } });
  assert.equal(state.beta.items[0].messages.length, 0);
  assert.equal(state.alpha.items[0].messages[0].content, "private alpha");
  state = reduce(state, { agentId: "beta", action: { type: "reset", id: "b2" } });
  assert.equal(state.alpha.items[0].messages.length, 1);
});
