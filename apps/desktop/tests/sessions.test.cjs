const test = require("node:test");
const assert = require("node:assert/strict");
const model = import("../src/sessions.mjs");

test('failed requests never poison subsequent conversation input', async () => {
  const { conversationInput } = await model;
  const messages = [{ role: 'user', content: 'original' }, { role: 'assistant', content: 'answer', state: 'completed' },
    { role: 'user', content: 'blocked', state: 'failed' }, { role: 'user', content: 'in flight', state: 'pending' },
    { role: 'assistant', content: 'unfinished', state: 'partial' }];
  assert.deepEqual(conversationInput(messages, 'clean'), [{ role: 'user', content: 'original' },
    { role: 'assistant', content: 'answer' }, { role: 'user', content: 'clean' }]);
  assert.equal(messages.length, 5);
  assert.equal(conversationInput(Array.from({ length: 30 }, () => messages[0]), 'next').length, 23);
});

test('failed-message recovery preserves unrelated sessions and unsent drafts', async () => {
  const { initialSessions, sessionReducer: reduce } = await model;
  let state = reduce(initialSessions('one'), { type: 'messages', id: 'one', value: [
    { id: 'bad', role: 'user', content: 'revise me', state: 'failed' },
    { id: 'good', role: 'user', content: 'keep me', state: 'completed' }] });
  state = reduce(state, { type: 'create', id: 'two' });
  const recover = { type: 'recover', id: 'one', messageId: 'bad', mode: 'edit' };
  state = reduce(state, { type: 'draft', id: 'one', value: 'unsent' });
  assert.deepEqual(reduce(state, recover), state);
  assert.deepEqual(reduce(state, { ...recover, messageId: 'good', mode: 'remove' }), state);
  state = reduce(state, { type: 'draft', id: 'one', value: '' });
  const edited = reduce(state, recover);
  assert.equal(edited.items[1].draft, 'revise me');
  assert.equal(edited.items[1].title, 'keep me');
  assert.equal(edited.selected, 'two');
  assert.deepEqual(edited.items[0], state.items[0]);
  const removed = reduce(state, { ...recover, mode: 'remove' });
  assert.equal(removed.items[1].draft, '');
  assert.equal(removed.items[1].messages.length, 1);
});

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
