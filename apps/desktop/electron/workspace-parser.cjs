const { parentPort, workerData } = require('node:worker_threads');
const { extract } = require('./workspace-extract.cjs');
extract(workerData).then(result => parentPort.postMessage(result), error => {
  const code = /^source_(content|size|archive|archive_empty|encrypted)$/.test(error.message) ? error.message : 'source_content';
  parentPort.postMessage({ error: code });
});
