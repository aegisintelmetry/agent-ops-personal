const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DesktopUpdates } = require('../electron/updates.cjs');
function fixture(options = {}) {
  const updater = new EventEmitter();
  const calls = [];
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('update-available', { version: '0.5.16' }); };
  updater.downloadUpdate = async () => { calls.push('download'); updater.emit('download-progress', { percent: 42 }); updater.emit('update-downloaded'); };
  updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
  const service = new DesktopUpdates({ updater, version: '0.5.15', enabled: true, assertIdle() {}, confirmInstall: async () => true, ...options });
  return { updater, calls, service };
}
test('updates require explicit download and confirmed installation, never install on exit', async () => {
  const { updater, calls, service } = fixture();
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false); assert.equal(updater.allowDowngrade, false);
  await service.install(); await service.download(); assert.deepEqual(calls, []);
  await service.check(); assert.deepEqual(calls, ['check']);
  await service.download(); assert.equal(service.state().status, 'ready');
  await service.install(); assert.deepEqual(calls, ['check', 'download', ['install', false, true]]);
});
test('busy work blocks install and is checked again after confirmation', async () => {
  let busy = false;
  const { calls, service } = fixture({ assertIdle() { if (busy) throw new Error('busy'); }, confirmInstall: async () => { busy = true; return true; } });
  await service.check(); await service.download();
  await assert.rejects(service.install(), /busy/);
  assert.deepEqual(calls, ['check', 'download']); assert.equal(service.locked, false);
});
test('cancel preserves downloaded update and duplicate checks are deduplicated', async () => {
  const { updater, calls, service } = fixture({ confirmInstall: async () => false });
  let finish;
  updater.checkForUpdates = () => new Promise(resolve => { finish = resolve; });
  const pending = service.check(); await service.check();
  updater.emit('update-available', { version: '0.5.16' }); finish(); await pending;
  await service.download(); await service.install();
  assert.deepEqual(calls, ['download']); assert.equal(service.state().status, 'ready');
});
test('network errors are sanitized and retryable; no checks for development builds', async () => {
  const { updater, service } = fixture();
  updater.checkForUpdates = async () => { throw new Error('private URL'); };
  await service.check(); assert.equal(service.state().status, 'error');
  assert.ok(!JSON.stringify(service.state()).includes('private'));
  updater.checkForUpdates = async () => updater.emit('update-not-available');
  await service.check(); assert.equal(service.state().status, 'current');
  const disabled = fixture({ enabled: false }); disabled.service.start(); await disabled.service.check();
  assert.deepEqual(disabled.calls, []); assert.equal(disabled.service.timer, undefined);
});
test('failed download cannot be installed and periodic checks preserve ready updates', async () => {
  const { updater, calls, service } = fixture();
  await service.check(); updater.downloadUpdate = async () => { throw new Error('checksum mismatch'); };
  await service.download(); await service.install(); assert.deepEqual(calls, ['check']);
  updater.emit('update-downloaded'); await service.check(); assert.deepEqual(calls, ['check']);
});
