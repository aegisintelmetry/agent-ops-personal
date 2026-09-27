const fs = require('node:fs/promises');
const path = require('node:path');

async function exportDocument(params, choosePath) {
  if (!params || typeof params.content !== 'string' || !params.content.trim() || Buffer.byteLength(params.content, 'utf8') > 1000000 ||
      typeof params.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.(md|txt)$/.test(params.name)) throw new Error('Invalid document');
  const content = params.content;
  const selection = await choosePath({ defaultPath: params.name, filters: [{ name: 'Text document', extensions: [path.extname(params.name).slice(1)] }], properties: ['showOverwriteConfirmation'] });
  if (selection.canceled || !selection.filePath) return { saved: false };
  if (!['.md', '.txt'].includes(path.extname(selection.filePath).toLowerCase())) throw new Error('Invalid extension');
  await fs.writeFile(selection.filePath, content, { encoding: 'utf8' });
  return { saved: true, name: path.basename(selection.filePath) };
}

module.exports = { exportDocument };
