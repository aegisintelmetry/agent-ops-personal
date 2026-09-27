const { Worker } = require('node:worker_threads');
const path = require('node:path');

class WorkspaceImporter {
  async read(params) {
    if (this.active) throw new Error('source_busy');
    if (!params || !/\.(pdf|docx)$/i.test(params.name) || !(params.bytes instanceof Uint8Array) || !params.bytes.length || params.bytes.length > 2 * 1024 * 1024) throw new Error('source_type');
    this.active = true;
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'workspace-parser.cjs'), {
          workerData: params, resourceLimits: { maxOldGenerationSizeMb: 128 }, stdout: true, stderr: true,
        });
        // Parser diagnostics can include document content; do not forward them to logs.
        worker.stdout.resume(); worker.stderr.resume();
        let done = false;
        const finish = (error, value) => {
          if (done) return;
          done = true; clearTimeout(timer);
          worker.terminate().finally(() => error ? reject(new Error(error)) : resolve(value));
        };
        const timer = setTimeout(() => finish('source_timeout'), 15000);
        worker.once('message', result => finish(result.error, result.text));
        worker.once('error', () => finish('source_content'));
        worker.once('exit', () => finish('source_content'));
      });
    } finally { this.active = false; }
  }
}
module.exports = { WorkspaceImporter };
