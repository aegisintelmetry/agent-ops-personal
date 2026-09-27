const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { WorkspaceImporter } = require('../electron/workspace-import.cjs');
const { FILE_LIMIT, CSV_LIMIT, EXCERPT_LIMIT } = require('../electron/workspace-limits.cjs');
const { pdfFixture, docxFixture } = require('./workspace-fixtures.cjs');

const readZip = async zip => new WorkspaceImporter().read({ name: 'reference.zip', bytes: await zip.generateAsync({ type: 'nodebuffer' }), detailed: true });

test('ZIP reads text, code, PDF and Word, skips binaries and never executes entries', async () => {
  const zip = new JSZip();
  zip.file('notes.txt', 'Revenue: 42');
  zip.file('src/test.py', 'print("reference only")');
  zip.file('report.pdf', pdfFixture());
  zip.file('report.docx', await docxFixture());
  zip.file('run.exe', 'not executable');
  const result = await readZip(zip);
  assert.match(result.text, /Revenue: 42/);
  assert.match(result.text, /src\/test.py/);
  assert.match(result.text, /Workspace PDF reference/);
  assert.match(result.text, /Workspace Word reference/);
  assert.equal(result.entries, 5);
  assert.equal(result.skipped, 1);
  assert.equal(result.truncated, true);
});

test('ZIP preview bounds, unsupported archives and resource guards', async () => {
  const zip = new JSZip().file('large.txt', 'abc '.repeat(20000));
  const result = await readZip(zip);
  assert.equal(result.text.length, EXCERPT_LIMIT);
  assert.equal(result.truncated, true);
  await assert.rejects(readZip(new JSZip().file('nested.zip', 'binary')), /source_archive_empty/);
  const many = new JSZip();
  for (let i = 0; i < 2001; i++) many.file(`${i}.txt`, 'a');
  await assert.rejects(readZip(many), /source_archive/);
  const bomb = await new JSZip().file('huge.txt', 'a'.repeat(17 * 1024 * 1024)).generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(new WorkspaceImporter().read({ name: 'bomb.zip', bytes: bomb }), /source_archive/);
});

test('ZIP rejects traversal, symlinks, encryption and malformed archives', async () => {
  const traversal = await new JSZip().file('safe/a.txt', 'bad').generateAsync({ type: 'nodebuffer' });
  // Equal-length rename in local and central headers, preserving the ZIP structure.
  for (let offset = traversal.indexOf('safe/a.txt'); offset >= 0; offset = traversal.indexOf('safe/a.txt')) traversal.write('../bad.txt', offset);
  await assert.rejects(new WorkspaceImporter().read({ name: 'traversal.zip', bytes: traversal }), /source_archive|source_content/);
  const symlink = new JSZip().file('link', '/outside', { unixPermissions: 0o120777 });
  const linkBytes = await symlink.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
  await assert.rejects(new WorkspaceImporter().read({ name: 'link.zip', bytes: linkBytes }), /source_archive/);
  const encrypted = await new JSZip().file('a.txt', 'reference longer than encryption header').generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  await assert.rejects(new WorkspaceImporter().read({ name: 'encrypted.zip', bytes: encrypted }), /source_encrypted/);
  await assert.rejects(new WorkspaceImporter().read({ name: 'broken.zip', bytes: Buffer.from('not zip') }), /source_archive/);
});

test('native file path accepts 512MiB text/ZIP and 50MiB CSV boundaries without full buffering', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-source-limits-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const importer = new WorkspaceImporter();
  for (const [name, limit] of [['large.txt', FILE_LIMIT], ['large.csv', CSV_LIMIT]]) {
    const file = path.join(directory, name);
    fs.writeFileSync(file, 'reference,'.repeat(6000));
    fs.truncateSync(file, limit);
    const result = await importer.readFile(file);
    assert.equal(result.size, limit); assert.equal(result.truncated, true);
    fs.truncateSync(file, limit + 1);
    await assert.rejects(importer.readFile(file), /source_size/);
  }
  // A valid padded ZIP fixture exercises random-access reading at the exact byte limit.
  const bytes = await new JSZip().file('notes.txt', 'At 512MiB ZIP boundary').generateAsync({ type: 'nodebuffer' });
  const padding = FILE_LIMIT - bytes.length;
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const end = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  bytes.writeUInt32LE(padding, central + 42);
  bytes.writeUInt32LE(central + padding, end + 16);
  const archive = path.join(directory, 'boundary.zip');
  const fd = fs.openSync(archive, 'w');
  try { fs.writeSync(fd, bytes, 0, bytes.length, padding); } finally { fs.closeSync(fd); }
  assert.match((await importer.readFile(archive)).text, /At 512MiB ZIP boundary/);
  fs.truncateSync(archive, FILE_LIMIT + 1);
  await assert.rejects(importer.readFile(archive), /source_size/);
  const docx = await JSZip.loadAsync(await docxFixture());
  docx.file('word/media/large.bin', Buffer.alloc(3 * 1024 * 1024, 65));
  for (const [name, bytes] of [['reference.pdf', pdfFixture(3 * 1024 * 1024)], ['reference.docx', await docx.generateAsync({ type: 'nodebuffer' })]]) {
    const file = path.join(directory, name); fs.writeFileSync(file, bytes);
    assert.match((await importer.readFile(file)).text, /Workspace/);
  }
  await assert.rejects(importer.readFile(directory), /source_type/);
});
