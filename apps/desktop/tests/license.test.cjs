const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const pkg = require('../package.json');
const builder = require('../electron-builder.json');

test('product license and copyright match the approved metadata', () => {
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(builder.copyright, 'Copyright (c) 2026 aegisintelmetry');
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  assert.match(license, /Version 2\.0, January 2004/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  const notice = fs.readFileSync(path.join(root, 'NOTICE'), 'utf8');
  assert.match(notice, /Copyright \(c\) 2026 aegisintelmetry/);
  assert.match(notice, /source-import\.json/);
});

test('Windows package preserves first-party and third-party notices', () => {
  for (const name of ['LICENSE', 'NOTICE']) {
    assert.ok(builder.extraResources.some(entry =>
      entry.from === `../../${name}` && entry.to === name));
  }
  assert.ok(builder.extraResources.some(entry => entry.to === 'THIRD-PARTY-NOTICES.txt'));
  assert.deepEqual(builder.publish, { provider: 'github', owner: 'aegisintelmetry', repo: 'agent-ops-personal', releaseType: 'release' });
  assert.equal(pkg.private, true);
});
