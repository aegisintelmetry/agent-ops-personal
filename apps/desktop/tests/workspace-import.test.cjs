const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkspaceImporter } = require('../electron/workspace-import.cjs');
const { pdfFixture, docxFixture } = require('./workspace-fixtures.cjs');

test('isolated parser extracts actual PDF and Word text without Office installation', async () => {
  const importer = new WorkspaceImporter();
  assert.match(await importer.read({ name: 'reference.pdf', bytes: pdfFixture() }), /Workspace PDF reference/);
  assert.match(await importer.read({ name: 'reference.docx', bytes: await docxFixture() }), /Workspace Word reference/);
  assert.equal(importer.active, false);
});

test('parser rejects unsupported, oversized and broken inputs and serializes work', async () => {
  const importer = new WorkspaceImporter();
  await assert.rejects(importer.read({ name: 'x.exe', bytes: Buffer.from('x') }), /source_type/);
  await assert.rejects(importer.read({ name: 'x.pdf', bytes: Buffer.alloc(2 * 1024 * 1024 + 1) }), /source_type/);
  const broken = importer.read({ name: 'x.pdf', bytes: Buffer.from('not a PDF') });
  await assert.rejects(importer.read({ name: 'x.pdf', bytes: pdfFixture() }), /source_busy/);
  await assert.rejects(broken, /source_content/);
  await assert.rejects(importer.read({ name: 'x.docx', bytes: Buffer.from('not a ZIP') }), /source_content/);
});

test('ZIP expansion limit rejects compressed document bombs before Mammoth', async () => {
  const zip = new (require('jszip'))();
  zip.file('word/document.xml', 'a'.repeat(17 * 1024 * 1024));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(new WorkspaceImporter().read({ name: 'bomb.docx', bytes }), /source_content/);
});
