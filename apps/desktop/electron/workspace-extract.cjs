const fs = require('node:fs');
const yauzl = require('yauzl');
const { MiB, EXCERPT_LIMIT: LIMIT, TEXT_EXTENSIONS, fileLimit } = require('./workspace-limits.cjs');
const fail = code => { throw new Error(code); };

function safeEntry(entry) {
  const name = entry.fileName;
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
  if (!name || name.length > 1024 || /[\x00-\x1f\\:]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || mode === 0xa000) fail('source_archive');
  if (entry.isEncrypted()) fail('source_encrypted');
  if (entry.uncompressedSize > MiB && entry.uncompressedSize / Math.max(1, entry.compressedSize) > 1000) fail('source_archive');
}

// Archives are never extracted to disk. Streams and retained excerpts are bounded.
function visitZip(input, visit) {
  return new Promise((resolve, reject) => {
    const opened = (error, zip) => {
      if (error) return reject(new Error('source_archive'));
      let count = 0, total = 0, settled = false;
      const stop = error => {
        if (!settled) {
          settled = true; zip.close();
          reject(/^source_/.test(error.message) ? error : new Error(/encrypt/i.test(error.message) ? 'source_encrypted' : 'source_archive'));
        }
      };
      zip.on('error', stop);
      zip.on('end', () => { if (!settled) { settled = true; resolve(); } });
      zip.on('entry', entry => {
        Promise.resolve().then(async () => {
          safeEntry(entry);
          if (++count > 2000 || (total += entry.uncompressedSize) > 1024 * MiB) fail('source_archive');
          await visit(entry, (maxBytes, partial = false) => new Promise((resolve, reject) => {
            if (!partial && entry.uncompressedSize > maxBytes) return reject(new Error('source_archive'));
            zip.openReadStream(entry, (error, stream) => {
              if (error) return reject(error);
              let length = 0;
              const chunks = [];
              stream.on('error', reject);
              stream.on('data', chunk => {
                const remaining = maxBytes - length;
                chunks.push(chunk.subarray(0, remaining)); length += Math.min(remaining, chunk.length);
                if (length >= maxBytes && partial) { stream.destroy(); resolve(Buffer.concat(chunks, length)); }
                else if (chunk.length > remaining) { stream.destroy(); reject(new Error('source_archive')); }
              });
              stream.on('end', () => resolve(Buffer.concat(chunks, length)));
            });
          }));
          if (!settled) zip.readEntry();
        }).catch(stop);
      });
      zip.readEntry();
    };
    const options = { lazyEntries: true, validateEntrySizes: true, strictFileNames: true };
    if (input.filePath) yauzl.open(input.filePath, options, opened);
    else yauzl.fromBuffer(Buffer.from(input.bytes), options, opened);
  });
}

function decode(bytes, partial = false) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: partial });
  if (text.includes('\0')) fail('source_content');
  return text;
}

async function word(input) {
  const parts = new Map();
  let retained = 0;
  await visitZip(input, async (entry, read) => {
    if (!/\.(xml|rels)$/i.test(entry.fileName)) return;
    retained += entry.uncompressedSize;
    if (retained > 16 * MiB) fail('source_archive');
    parts.set(entry.fileName, await read(16 * MiB));
  });
  // Mammoth's file adapter avoids buffering large embedded images or ZIP padding.
  const file = {
    exists: name => parts.has(name),
    read: async (name, encoding) => {
      if (!parts.has(name)) fail('source_content');
      return encoding ? parts.get(name).toString(encoding) : parts.get(name);
    },
  };
  const text = (await require('mammoth').extractRawText({ file }, { externalFileAccess: false })).value;
  return { text: text.slice(0, LIMIT), truncated: text.length > LIMIT };
}

async function pdf(input, size) {
  const { getDocument, PDFDataRangeTransport } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let fd, task;
  try {
    let source;
    if (input.filePath) {
      fd = fs.openSync(input.filePath, 'r');
      const readRange = (begin, end) => {
        const bytes = new Uint8Array(end - begin);
        if (fs.readSync(fd, bytes, 0, bytes.length, begin) !== bytes.length) fail('source_content');
        return bytes;
      };
      const range = new PDFDataRangeTransport(size, readRange(0, Math.min(size, 65536)), true);
      range.requestDataRange = (begin, end) => {
        try { range.onDataRange(begin, readRange(begin, end)); }
        catch { task.destroy(); }
      };
      source = { range, length: size, disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536 };
    } else source = { data: new Uint8Array(input.bytes) };
    task = getDocument({ ...source, isEvalSupported: false, useSystemFonts: false, useWorkerFetch: false, disableFontFace: true, verbosity: 0 });
    task.onPassword = () => task.destroy();
    const document = await task.promise;
    let text = '', pageNumber = 0;
    while (pageNumber < Math.min(document.numPages, 100) && text.length <= LIMIT) {
      const page = await document.getPage(++pageNumber);
      const content = await page.getTextContent();
      text += content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('') + '\n';
      page.cleanup();
    }
    return { text: text.slice(0, LIMIT), truncated: text.length > LIMIT || pageNumber < document.numPages };
  } finally { if (task) await task.destroy(); if (fd !== undefined) fs.closeSync(fd); }
}

async function archive(input) {
  let text = '', entries = 0, skipped = 0, truncated = false;
  await visitZip(input, async (entry, read) => {
    if (entry.fileName.endsWith('/')) return;
    entries++;
    const name = entry.fileName;
    if (!TEXT_EXTENSIONS.test(name) && !/\.(pdf|docx)$/i.test(name)) { skipped++; return; }
    const remaining = LIMIT - text.length;
    if (remaining < name.length + 100) { skipped++; truncated = true; return; }
    let result;
    if (TEXT_EXTENSIONS.test(name)) {
      const bytes = await read(Math.min(entry.uncompressedSize, remaining * 4), true);
      try { result = { text: decode(bytes, bytes.length < entry.uncompressedSize), truncated: bytes.length < entry.uncompressedSize }; }
      catch { skipped++; return; }
    } else {
      if (entry.uncompressedSize > 16 * MiB) { skipped++; return; }
      const bytes = await read(16 * MiB);
      try { result = /\.pdf$/i.test(name) ? await pdf({ bytes }, bytes.length) : await word({ bytes }); }
      catch { skipped++; return; }
    }
    const section = `\n--- ${name} ---\n${result.text}`;
    text += section.slice(0, remaining);
    truncated ||= result.truncated || section.length > remaining;
  });
  if (!text.trim()) fail('source_archive_empty');
  return { text, truncated: truncated || skipped > 0, entries, skipped };
}

async function extract(input) {
  const stat = input.filePath ? fs.lstatSync(input.filePath) : null;
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) fail('source_content');
  const size = stat ? stat.size : input.bytes.length;
  if (!size) fail('source_content');
  if (size > fileLimit(input.name)) fail('source_size');
  let result;
  if (/\.zip$/i.test(input.name)) result = await archive(input);
  else if (/\.docx$/i.test(input.name)) result = await word(input);
  else if (/\.pdf$/i.test(input.name)) result = await pdf(input, size);
  else {
    const length = Math.min(size, LIMIT * 4);
    let bytes;
    if (input.filePath) {
      const fd = fs.openSync(input.filePath, 'r');
      try { bytes = Buffer.alloc(length); fs.readSync(fd, bytes, 0, length, 0); }
      finally { fs.closeSync(fd); }
    } else bytes = input.bytes.subarray(0, length);
    const text = decode(bytes, length < size);
    result = { text: text.slice(0, LIMIT), truncated: length < size || text.length > LIMIT };
  }
  if (!result.text.trim() || result.text.includes('\0')) fail('source_content');
  return { ...result, size };
}
module.exports = { extract };
