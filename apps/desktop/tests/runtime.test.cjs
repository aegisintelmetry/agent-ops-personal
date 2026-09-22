const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyRelease, verifyHandshake, runtimeLaunch } = require('../electron/runtime.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'btk-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'core'));
  const bytes = Buffer.from('not an executable, test fixture');
  fs.writeFileSync(path.join(root, 'core/btk-desktop-core.exe'), bytes);
  fs.writeFileSync(path.join(root, 'core/btk-agent-runtime.exe'), bytes);
  const release = { schema: 'btk.desktop.release.v1', version: '0.2.0', protocol_version: 1,
    build_id: 'fixture-build', core: { entry: 'btk-desktop-core.exe', runtime_entry: 'btk-agent-runtime.exe', files: [{
      path: 'btk-desktop-core.exe', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }, { path: 'btk-agent-runtime.exe', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] } };
  const save = () => fs.writeFileSync(path.join(root, 'desktop-release.json'), JSON.stringify(release));
  save();
  return { root, release, save };
}
test('packaged launch uses bundled executable, never PATH Python', t => {
  const { root } = fixture(t);
  const launch = runtimeLaunch({ packaged: true, resourcesPath: root, version: '0.2.0' });
  assert.equal(launch.executable, path.join(root, 'core/btk-desktop-core.exe'));
  assert.deepEqual(launch.args, []);
});
test('missing packaged core does not fall back to checkout or PATH', t => {
  const { root } = fixture(t);
  fs.unlinkSync(path.join(root, 'core/btk-desktop-core.exe'));
  assert.throws(() => verifyRelease(root, '0.2.0'));
});
test('version mismatch is rejected before launch', t => {
  const { root } = fixture(t);
  assert.throws(() => verifyRelease(root, '0.1.0'));
});
test('unexpected files in the core are rejected', t => {
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, 'core/extra.dll'), 'unexpected');
  assert.throws(() => verifyRelease(root, '0.2.0'));
});
test('modified core bytes fail integrity checks', t => {
  const { root } = fixture(t);
  fs.appendFileSync(path.join(root, 'core/btk-desktop-core.exe'), 'tampered');
  assert.throws(() => verifyRelease(root, '0.2.0'));
});
test('manifest paths cannot escape package or reference alternate data streams', t => {
  const { root, release, save } = fixture(t);
  for (const entry of ['../outside', 'C:/outside', '/outside', 'file.exe:payload', 'nested\\outside']) {
    release.core.files[0].path = entry;
    save();
    assert.throws(() => verifyRelease(root, '0.2.0'), entry);
  }
});
test('duplicate manifest entries are rejected', t => {
  const { root, release, save } = fixture(t);
  release.core.files.push(release.core.files[0]);
  save();
  assert.throws(() => verifyRelease(root, '0.2.0'));
});
test('runtime handshake checks protocol, version and build together', () => {
  const expected = { version: '0.2.0', protocol_version: 1, build_id: 'build-1' };
  assert.doesNotThrow(() => verifyHandshake(expected, expected));
  for (const changed of [{ version: '0.1.0' }, { protocol_version: 2 }, { build_id: 'build-2' }])
    assert.throws(() => verifyHandshake({ ...expected, ...changed }, expected));
});
