const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { GeminiCli } = require('../electron/gemini-cli.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-gemini-runtime-'));
const cli = new GeminiCli({ directory });
(async () => {
  await cli.start();
  assert.equal(cli.state().connected, false);
  assert.equal(cli.requests.size, 0);
  console.log(JSON.stringify({ status: 'passed', realBundledRuntime: true, acpInitialize: true, authenticationRequested: false, modelRequests: 0 }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => { cli.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
