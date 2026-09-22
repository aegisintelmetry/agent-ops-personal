const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { KnowledgeStore, contextFor, enrich } = require('../electron/knowledge.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-knowledge-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split('').reverse().join('')), decryptString: value => value.toString().split('').reverse().join('') };
  const options = { directory, safeStorage };
  return { store: new KnowledgeStore(options), options };
}
const record = (scope, title = 'memory', enabled = true) => ({ scope, title, content: 'Project mercury uses metric units.', source: 'operator', enabled });
test('memory and role prompt survive restart without plaintext at rest', t => {
  const { store, options } = fixture(t);
  store.prompt('alpha', 'Prefer concise answers.');
  store.upsert('alpha', record('agent'));
  assert.equal(fs.readFileSync(store.file).includes(Buffer.from('metric units')), false);
  assert.deepEqual(new KnowledgeStore(options).state('alpha'), store.state('alpha'));
});
test('scope, opt-in and relevance control context without sharing private agent data', t => {
  const { store } = fixture(t);
  store.upsert('alpha', record('agent', 'private-alpha'));
  store.upsert('alpha', record('global', 'shared'));
  store.upsert('alpha', record('team', 'team-only'));
  store.upsert('alpha', record('global', 'disabled', false));
  const context = contextFor(store.snapshot('beta', true), 'mercury');
  assert.ok(context.includes('shared')); assert.ok(context.includes('team-only'));
  assert.ok(!context.includes('private-alpha')); assert.ok(!context.includes('disabled'));
  assert.ok(!contextFor(store.snapshot('beta'), 'mercury').includes('team-only'));
  assert.equal(contextFor(store.snapshot('beta'), 'unrelated'), '');
});
test('memory writes reject known secrets, unknown IDs and foreign private mutations', t => {
  const { store } = fixture(t);
  const saved = store.upsert('alpha', record('agent')).records[0];
  assert.throws(() => store.remove('beta', saved.id));
  assert.throws(() => store.upsert('beta', { ...saved, content: 'changed' }));
  assert.throws(() => store.prompt('alpha', 'sk-' + 'x'.repeat(30)));
  assert.throws(() => store.upsert('alpha', { ...record('agent'), content: 'Bearer ' + 'x'.repeat(30) }));
  assert.equal(store.state('alpha').records.length, 1);
});
test('editing, deleting, disabling and context snapshots are explicit', t => {
  const { store } = fixture(t);
  const r = store.upsert('a', record('agent')).records[0];
  const snapshot = store.snapshot('a');
  store.upsert('a', { ...r, enabled: false });
  assert.equal(contextFor(store.snapshot('a'), 'mercury'), '');
  assert.ok(contextFor(snapshot, 'mercury').includes('metric'));
  store.remove('a', r.id); assert.equal(store.state('a').records.length, 0);
});
test('corrupt files and unavailable encryption never replace saved memory', t => {
  const { store, options } = fixture(t);
  store.upsert('a', record('global'));
  const original = fs.readFileSync(store.file);
  options.safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => store.prompt('a', 'changed'));
  assert.deepEqual(fs.readFileSync(store.file), original);
  fs.writeFileSync(store.file, 'corrupt');
  assert.throws(() => store.prompt('a', 'replace'));
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'corrupt');
});
test('context has bounded retrieval and enriches only the current request', t => {
  const { store } = fixture(t);
  for (let i = 0; i < 5; i++) store.upsert('a', record('global', `memory-${i}`));
  const messages = [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'history' }, { role: 'user', content: 'mercury' }];
  const result = enrich(messages, store.snapshot('a'), 'mercury');
  assert.equal((result[2].content.match(/"title"/g) || []).length, 3);
  assert.deepEqual(result.slice(0, 2), messages.slice(0, 2));
  assert.equal(messages[2].content, 'mercury');
  assert.ok(result[2].content.includes('untrusted reference data'));
});
