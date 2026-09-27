const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { WorkspaceStore, validateGroups } = require('../electron/workspace-store.cjs');
const key = crypto.randomBytes(32);
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(value) { const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final()]); },
  decryptString(value) { const cipher = crypto.createDecipheriv('aes-256-cbc', key, value.subarray(0, 16)); return Buffer.concat([cipher.update(value.subarray(16)), cipher.final()]).toString('utf8'); },
};
const groups = () => ({ default: { selected: 'session1', items: [{ id: 'session1', title: 'Private document', draft: 'Unsent draft', output: 'markdown', sources: [{ id: 'source1', name: 'ref.txt', text: 'Private reference' }], messages: [{ id: 'message1', role: 'assistant', state: 'completed', content: '# Private result', output: 'markdown' }] }] } });
function store() { return new WorkspaceStore({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-store-')), safeStorage }); }

test('encrypted workspace restores drafts, sources and result authority across restarts', () => {
  const value = store();
  assert.deepEqual(value.load(), {});
  const data = groups(); data.default.items[0].messages[0].model = 'original-model';
  value.save(data);
  assert.ok(!fs.readFileSync(value.file).includes(Buffer.from('Private')));
  const reopened = new WorkspaceStore({ directory: value.directory, safeStorage });
  const result = reopened.load().default.items[0];
  assert.equal(result.draft, 'Unsent draft');
  assert.equal(result.sources[0].text, 'Private reference');
  assert.equal(result.messages[0].content, '# Private result');
  assert.equal(result.messages[0].model, 'original-model');
  value.save({});
  assert.deepEqual(reopened.load(), {});
});

test('interrupted requests become retryable failures, never completed history', async () => {
  const data = groups();
  data.default.items[0].messages = [{ id: 'pending', role: 'user', state: 'pending', content: 'interrupted request' }];
  data.default.items[0].latestRun = { id: 'run1', startedAt: '2026-09-27T00:00:00Z', status: 'running' };
  const recovered = validateGroups(data, true).default.items[0];
  assert.equal(recovered.messages[0].state, 'failed');
  assert.equal(recovered.latestRun.status, 'cancelled');
  const { conversationInput } = await import('../src/sessions.mjs');
  assert.deepEqual(conversationInput(recovered.messages, 'next'), [{ role: 'user', content: 'next' }]);
});

test('archive excerpts and limits persist without accepting unbounded metadata', () => {
  const data = groups();
  data.default.items[0].sources = Array.from({ length: 5 }, (_, i) => ({
    id: `source${i}`, name: `${i}.zip`, text: 'a'.repeat(12000), size: 512 * 1024 * 1024,
    truncated: true, entries: 8, skipped: 2,
  }));
  const value = store(); value.load(); value.save(data);
  const restored = new WorkspaceStore({ directory: value.directory, safeStorage }).load().default.items[0].sources;
  assert.deepEqual(restored, data.default.items[0].sources);
  for (const [field, invalid] of [['size', 512 * 1024 * 1024 + 1], ['entries', 2001], ['skipped', -1], ['truncated', 'yes']]) {
    const bad = structuredClone(data); bad.default.items[0].sources[0][field] = invalid;
    assert.throws(() => value.save(bad), /workspace_storage/);
  }
});

test('image results and selected generation model survive encrypted restart', () => {
  const { image } = require('./image-fixture.cjs');
  const value = store(); value.load();
  const data = groups(); const session = data.default.items[0];
  session.output = 'image'; session.imageModel = 'fixture-image-model';
  session.messages[0] = { ...session.messages[0], content: '', images: [image], output: 'image' };
  value.save(data);
  assert.ok(!fs.readFileSync(value.file).includes(Buffer.from(image)));
  const result = new WorkspaceStore({ directory: value.directory, safeStorage }).load().default.items[0];
  assert.equal(result.imageModel, 'fixture-image-model');
  assert.deepEqual(result.messages[0].images, [image]);
});

test('corrupt store and unavailable encryption preserve original bytes', () => {
  const value = store();
  fs.writeFileSync(value.file, 'corrupt');
  assert.throws(() => value.load(), /workspace_storage/);
  assert.throws(() => value.save(groups()), /workspace_storage/);
  assert.equal(fs.readFileSync(value.file, 'utf8'), 'corrupt');
  const unavailable = new WorkspaceStore({ directory: value.directory, safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });
  assert.throws(() => unavailable.load(), /workspace_storage/);
});

test('invalid state cannot replace saved data or mix agents', () => {
  const value = store(); value.load(); value.save(groups());
  const before = fs.readFileSync(value.file);
  const invalid = groups(); invalid.default.selected = 'missing';
  assert.throws(() => value.save(invalid));
  assert.deepEqual(fs.readFileSync(value.file), before);
  assert.throws(() => validateGroups(JSON.parse('{"__proto__":{}}')));
  const data = groups(); data.second = { selected: 'session2', items: [{ id: 'session2', title: 'Other agent', draft: '', messages: [] }] };
  const saved = validateGroups(data);
  assert.equal(saved.second.items[0].sources.length, 0);
  assert.equal(saved.default.items[0].messages.length, 1);
  data.default.items[0].sources.push({ id: 'evil', name: 'image.svg', text: '', image: 'data:image/svg+xml;base64,AAAA' });
  assert.throws(() => validateGroups(data));
});
