const test = require("node:test");
const assert = require("node:assert/strict");
const model = import("../src/sessions.mjs");

test("sessions keep independent messages and drafts when switching", async () => {
  const { initialSessions, sessionReducer: reduce } = await model;
  let state = initialSessions("one");
  state = reduce(state, { type: "messages", id: "one", value: [{ role: "user", content: "First question" }] });
  state = reduce(state, { type: "draft", id: "one", value: "Unsent" });
  state = reduce(state, { type: "create", id: "two" });
  assert.equal(state.items[0].messages.length, 0);
  state = reduce(state, { type: "select", id: "one" });
  assert.equal(state.selected, "one");
  assert.equal(state.items[1].draft, "Unsent");
  assert.equal(state.items[1].title, "First question");
});
test("stream updates target their session and never the newly selected one", async () => {
  const { initialSessions, sessionReducer: reduce } = await model;
  let state = reduce(initialSessions("one"), { type: "create", id: "two" });
  state = reduce(state, { type: "messages", id: "one", value: rows => [...rows, { role: "assistant", content: "Answer" }] });
  assert.equal(state.items[0].messages.length, 0);
  assert.equal(state.items[1].messages[0].content, "Answer");
});

test("execution summary belongs to its session and resets with a new session", async () => {
  const { initialSessions, sessionReducer: reduce } = await model;
  let state = reduce(initialSessions("one"), { type: "run", id: "one", value: { status: "failed" } });
  state = reduce(state, { type: "create", id: "two" });
  assert.equal(state.items[0].latestRun, undefined);
  assert.equal(state.items[1].latestRun.status, "failed");
  state = reduce(state, { type: "run", id: "two", value: { status: "partial" } });
  assert.equal(state.items[0].latestRun.status, "partial");
  assert.equal(state.items[1].latestRun.status, "failed");
});
test("bounded sessions preserve history; deletion and profile reset clear only intended data", async () => {
  const { initialSessions, sessionReducer: reduce, MAX_SESSIONS } = await model;
  let state = initialSessions("0");
  for (let i = 1; i <= MAX_SESSIONS; i++) state = reduce(state, { type: "create", id: String(i) });
  assert.equal(state.items.length, MAX_SESSIONS);
  assert.equal(state.items.at(-1).id, "0");
  state = reduce(state, { type: "remove", id: state.selected, replacementId: "replacement" });
  assert.equal(state.selected, state.items[0].id);
  state = reduce(state, { type: "reset", id: "profile-change" });
  assert.deepEqual(state, initialSessions("profile-change"));
  state = reduce(state, { type: "remove", id: "profile-change", replacementId: "empty" });
  assert.deepEqual(state, initialSessions("empty"));
});
