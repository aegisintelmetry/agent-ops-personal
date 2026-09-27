const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SOURCE_EXTENSIONS, fileLimit } = require('./workspace-limits.cjs');

class WorkspaceImporter {
  async read(params) {
    if (this.active) throw new Error('source_busy');
    if (!params || typeof params.name !== 'string' || !SOURCE_EXTENSIONS.test(params.name) || !(params.bytes instanceof Uint8Array) || !params.bytes.length || params.bytes.length > 2 * 1024 * 1024) throw new Error('source_type');
    return this.run({ name: params.name, bytes: params.bytes }, params.detailed === true);
  }
  async readFile(filePath) {
    if (this.active) throw new Error('source_busy');
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('source_type');
    const name = path.basename(filePath);
    if (name.length > 255 || !SOURCE_EXTENSIONS.test(name)) throw new Error('source_type');
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('source_content');
    if (stat.size > fileLimit(name)) throw new Error('source_size');
    if (this.active) throw new Error('source_busy');
    return this.run({ name, filePath }, true);
  }
  async run(params, detailed) {
    this.active = true;
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'workspace-parser.cjs'), {
          workerData: params, resourceLimits: { maxOldGenerationSizeMb: 192 }, stdout: true, stderr: true,
        });
        // Parser diagnostics can include document content; do not forward them to logs.
        worker.stdout.resume(); worker.stderr.resume();
        let done = false;
        const finish = (error, value) => {
          if (done) return;
          done = true; clearTimeout(timer);
          worker.terminate().finally(() => error ? reject(new Error(error)) : resolve(value));
        };
        const timer = setTimeout(() => finish('source_timeout'), 60000);
        worker.once('message', result => finish(result.error, detailed ? result : result.text));
        worker.once('error', () => finish('source_content'));
        worker.once('exit', () => finish('source_content'));
      });
    } finally { this.active = false; }
  }
}
module.exports = { WorkspaceImporter };
