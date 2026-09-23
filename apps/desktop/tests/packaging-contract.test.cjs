const { test } = require('node:test');
const assert = require('node:assert/strict');
const builder = require('../electron-builder.json');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

test('preview updates retain application identity and do not delete user data', () => {
  assert.equal(builder.appId, 'aegis.agentops.preview');
  assert.equal(pkg.name, 'btk-agent-desktop');
  assert.equal(builder.productName, 'AEGIS Agent Ops Preview');
  assert.equal(builder.nsis.perMachine, false);
  assert.equal(builder.nsis.allowElevation, false);
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false);
  assert.equal(builder.nsis.runAfterFinish, false);
});

test('candidate package version and dependency lock agree', () => {
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(builder.win.artifactName, 'AEGIS-Agent-Ops-Setup-${version}-preview.${ext}');
});
