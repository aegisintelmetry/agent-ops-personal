const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { exportDocument } = require('../electron/workspace-export.cjs');

test('export only writes to a user-selected text path and cancellation does nothing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-export-'));
  const file = path.join(dir, 'result.md');
  let options;
  const params = { name: 'document-1.md', content: '# report\nverified', filePath: path.join(dir, 'ignored.md') };
  assert.deepEqual(await exportDocument(params, async () => ({ canceled: true })), { saved: false });
  assert.deepEqual(await fs.readdir(dir), []);
  const result = await exportDocument(params, async value => { options = value; return { canceled: false, filePath: file }; });
  assert.deepEqual(result, { saved: true, name: 'result.md' });
  assert.equal(await fs.readFile(file, 'utf8'), params.content);
  assert.deepEqual(options.properties, ['showOverwriteConfirmation']);
  assert.deepEqual(await fs.readdir(dir), ['result.md']);
  await fs.unlink(file); await fs.rmdir(dir);
});

test('export rejects traversal names, oversized content and executable destinations', async () => {
  let dialogs = 0;
  const choose = async () => { dialogs++; return { canceled: true }; };
  for (const name of ['../file.md', 'C:\\file.txt', 'file.html', 'file.exe', 'a:b.txt']) {
    await assert.rejects(exportDocument({ name, content: 'hello' }, choose));
  }
  await assert.rejects(exportDocument({ name: 'file.txt', content: 'x'.repeat(1000001) }, choose));
  assert.equal(dialogs, 0);
  await assert.rejects(exportDocument({ name: 'file.txt', content: 'hello' }, async () => ({ canceled: false, filePath: 'output.exe' })));
});
