const test = require('node:test');
const assert = require('node:assert/strict');
const { TeamCoordinator } = require('../electron/team.cjs');
const roster = ['m', 'a', 'b', 'c', 'd'].map(id => ({ id, name: id }));
const input = { masterId: 'm', workerIds: ['a', 'b', 'c', 'd'], objective: 'Compare approaches' };
function fixture({ invalid = false, partial = false, fail = false, delay = 5 } = {}) {
  let active = 0, peak = 0, masterCalls = 0;
  const calls = [], closed = [], pending = new Map();
  const team = new TeamCoordinator({ open: id => ({ model: `${id}-model`, close: () => closed.push(id), cancel: () => pending.get(id)?.(), complete: async messages => {
    calls.push({ id, messages });
    if (id === 'm') {
      masterCalls++;
      return { status: 'completed', text: masterCalls === 1 ? invalid ? '{}' : JSON.stringify({ tasks: input.workerIds.map(agentId => ({ agentId, task: `Task for ${agentId}` })) }) : 'Final synthesis' };
    }
    active++; peak = Math.max(peak, active);
    try {
      await new Promise((resolve, reject) => { const timer = setTimeout(resolve, delay); pending.set(id, () => { clearTimeout(timer); reject(new Error('cancel')); }); });
      if (fail && id === 'a') throw new Error('private upstream diagnostic');
      return { status: partial && id === 'a' ? 'partial' : 'completed', text: `Result ${id}` };
    } finally { active--; pending.delete(id); }
  } }) });
  return { team, calls, closed, peak: () => peak };
}
test('master dispatches isolated sessions with concurrency 2 and at most 6 calls', async () => {
  const f = fixture(); const started = f.team.start(input, roster);
  assert.equal(started.status, 'running'); assert.throws(() => f.team.start(input, roster));
  await f.team.done;
  const run = f.team.state();
  assert.equal(run.status, 'completed'); assert.equal(run.text, 'Final synthesis');
  assert.equal(run.calls, 6); assert.equal(f.peak(), 2); assert.equal(new Set(run.workers.map(w => w.sessionId)).size, 4);
  assert.equal(f.closed.length, 5);
  for (const call of f.calls.filter(c => c.id !== 'm')) {
    assert.equal(call.messages.length, 1);
    assert.ok(call.messages[0].content.includes(`Task for ${call.id}`));
    assert.ok(!call.messages[0].content.includes('Result '));
  }
  run.workers[0].status = 'failed'; assert.equal(f.team.state().workers[0].status, 'completed');
});
test('invalid roster and duplicates make zero calls', () => {
  const f = fixture();
  for (const workerIds of [[], ['m'], ['a', 'a'], ['unknown'], ['a', 'b', 'c', 'd', 'e']]) assert.throws(() => f.team.start({ ...input, workerIds }, roster));
  assert.equal(f.calls.length, 0);
});
test('invalid master plan fails without worker execution', async () => {
  const f = fixture({ invalid: true }); f.team.start(input, roster); await f.team.done;
  assert.equal(f.team.state().status, 'failed'); assert.equal(f.calls.length, 1); assert.equal(f.team.active, false);
});
for (const option of ['partial', 'fail']) test(`${option} leaf prevents synthesis and completed mission`, async () => {
  const f = fixture({ [option]: true }); f.team.start(input, roster); await f.team.done;
  assert.equal(f.team.state().status, 'partial'); assert.equal(f.calls.length, 5);
  assert.ok(!JSON.stringify(f.team.state()).includes('private upstream'));
});
test('cancel aborts active workers and never starts queued workers or synthesis', async () => {
  const f = fixture({ delay: 10000 }); f.team.start(input, roster);
  await new Promise(resolve => setImmediate(resolve)); f.team.cancel(); await f.team.done;
  assert.equal(f.team.state().status, 'cancelled'); assert.equal(f.calls.length, 3);
  assert.ok(f.team.state().workers.every(w => w.status === 'cancelled')); assert.equal(f.team.active, false);
});
test('follow-up context is limited to the same team and clear removes it', async () => {
  const f = fixture(); f.team.start(input, roster); await f.team.done;
  f.team.start({ ...input, objective: 'Follow up' }, roster); await f.team.done;
  assert.ok(f.calls[6].messages[0].content.includes('Final synthesis'));
  assert.equal(f.team.state().turns.length, 2);
  f.team.clear(); assert.equal(f.team.state(), null);
});
test('changing team membership excludes previous conversation and history is bounded', async () => {
  const f = fixture(); f.team.start(input, roster); await f.team.done;
  f.team.start({ ...input, workerIds: ['a'] }, roster); await f.team.done;
  assert.ok(f.calls[6].messages[0].content.includes('"priorTeamConversation":[]'));
  for (let i = 2; i < 20; i++) { f.team.start(input, roster); await f.team.done; }
  assert.throws(() => f.team.start(input, roster), /새 팀 대화/);
  f.team.clear(); assert.equal(f.team.state(), null);
});
test('retry reuses completed workers and exposes only sanitized failure reason', async () => {
  let attempts = 0; const calls = [];
  const team = new TeamCoordinator({ open: id => ({ model: id, cancel() {}, close() {}, async complete(messages) {
    calls.push(id);
    if (messages[0].content.startsWith('Plan')) return { status: 'completed', text: JSON.stringify({ tasks: ['a', 'b'].map(agentId => ({ agentId, task: 'review' })) }) };
    if (id === 'a' && attempts++ === 0) throw new Error('HTTP 429 secret fixture must not appear');
    return { status: 'completed', text: 'Result' };
  } }) });
  const params = { masterId: 'm', workerIds: ['a', 'b'], objective: 'Review' };
  team.start(params, roster); await team.done;
  const first = team.state(); assert.equal(first.status, 'partial');
  assert.ok(first.workers[0].error.includes('한도')); assert.ok(!JSON.stringify(first).includes('secret fixture'));
  team.start({ ...params, retryOf: first.id }, roster); await team.done;
  assert.equal(team.state().status, 'completed'); assert.equal(calls.filter(id => id === 'b').length, 1);
  assert.equal(team.state().calls, 2);
  assert.throws(() => team.start({ ...params, retryOf: first.id }, roster));
});
