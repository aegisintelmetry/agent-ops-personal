const { parentPort, workerData } = require('node:worker_threads');
const LIMIT = 12000;

// Validate every ZIP stream before Mammoth expands the document in memory.
async function inspectZip(buffer) {
  const yauzl = require('yauzl');
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      let count = 0, total = 0;
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', entry => {
        if (++count > 500 || (total += entry.uncompressedSize) > 16 * 1024 * 1024 || entry.isEncrypted()) return fail(new Error('source_content'));
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          stream.on('error', fail);
          stream.on('end', () => zip.readEntry());
          stream.resume();
        });
      });
      zip.readEntry();
    });
  });
}

async function extract() {
  const buffer = Buffer.from(workerData.bytes);
  let text = '';
  if (/\.docx$/i.test(workerData.name)) {
    await inspectZip(buffer);
    text = (await require('mammoth').extractRawText({ buffer }, { externalFileAccess: false })).value;
  } else {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, useWorkerFetch: false, disableFontFace: true, verbosity: 0 });
    task.onPassword = () => task.destroy();
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new Error('source_content');
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        text += content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('') + '\n';
        page.cleanup();
        if (text.length > LIMIT) throw new Error('source_content');
      }
    } finally { await task.destroy(); }
  }
  if (!text.trim() || text.length > LIMIT || text.includes('\0')) throw new Error('source_content');
  return text;
}
extract().then(text => parentPort.postMessage({ text }), () => parentPort.postMessage({ error: 'source_content' }));
