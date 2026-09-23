const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareMessages, BLOCKED_MESSAGE, POLICY_VERSION } = require('../electron/transmission-policy.cjs');

test('transmission policy blocks credential patterns without echoing content', () => {
  const samples = ['sk-' + 'fixture'.repeat(5), 'xoxb-' + '1234567890'.repeat(3), 'ghp_' + 'X'.repeat(30),
    'github_pat_' + 'X'.repeat(30), '-----BEGIN PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----', 'Bearer ' + 'X'.repeat(30)];
  for (const content of samples) {
    assert.throws(() => prepareMessages([{ role: 'user', content }]), error => {
      assert.equal(error.message, BLOCKED_MESSAGE);
      assert.equal(error.code, 'transmission_blocked');
      assert.equal(error.policyVersion, POLICY_VERSION);
      assert.ok(!JSON.stringify(error).includes(content));
      return true;
    });
  }
});
test('all roles and exact configured credentials are inspected', () => {
  const secret = 'synthetic-credential-value';
  assert.throws(() => prepareMessages([{ role: 'assistant', content: secret }], { secrets: [secret] }), { code: 'transmission_blocked' });
  assert.doesNotThrow(() => prepareMessages([{ role: 'user', content: 'Explain API key storage without real credentials.' }]));
});
test('validated messages are detached and frozen', () => {
  const input = [{ role: 'user', content: 'safe text', extra: 'not forwarded' }];
  const result = prepareMessages(input);
  input[0].content = 'changed'; input.push({ role: 'assistant', content: 'changed' });
  assert.deepEqual(result, [{ role: 'user', content: 'safe text' }]);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result[0]));
});
test('malformed and oversized inputs fail closed', () => {
  for (const value of [null, [], [{ role: 'system', content: 'x' }], [{ role: 'user', content: ' ' }], [{ role: 'user', content: 'x'.repeat(100001) }]]) {
    assert.throws(() => prepareMessages(value), { code: 'invalid_input' });
  }
});
