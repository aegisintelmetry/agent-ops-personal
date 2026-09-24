const { EventEmitter } = require('node:events');

class DesktopUpdates extends EventEmitter {
  constructor({ updater, version, enabled, assertIdle, confirmInstall }) {
    super();
    Object.assign(this, { updater, assertIdle, confirmInstall });
    this.value = { currentVersion: version, version: '', status: enabled ? 'idle' : 'unavailable', percent: 0 };
    this.locked = false;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.logger = null;
    updater.on('update-available', info => this.set({ status: 'available', version: info.version, percent: 0 }));
    updater.on('update-not-available', () => this.set({ status: 'current', version: '' }));
    updater.on('download-progress', info => this.set({ percent: Math.max(0, Math.min(100, Math.round(info.percent) || 0)) }));
    updater.on('update-downloaded', () => this.set({ status: 'ready', percent: 100 }));
    updater.on('error', () => this.set({ status: 'error' }));
  }
  state() { return { ...this.value }; }
  set(patch) { Object.assign(this.value, patch); this.emit('change', this.state()); }
  start() {
    if (this.timer || this.value.status === 'unavailable') return;
    this.timer = setTimeout(() => { this.check(); this.interval = setInterval(() => this.check(), 6 * 60 * 60 * 1000); this.interval.unref(); }, 15000);
    this.timer.unref();
  }
  stop() { clearTimeout(this.timer); clearInterval(this.interval); }
  async check() {
    if (this.locked || !['idle', 'current', 'error'].includes(this.value.status)) return this.state();
    this.locked = true; this.set({ status: 'checking' });
    try { await this.updater.checkForUpdates(); }
    catch { this.set({ status: 'error' }); }
    finally { this.locked = false; }
    return this.state();
  }
  async download() {
    if (this.locked || this.value.status !== 'available') return this.state();
    this.locked = true; this.set({ status: 'downloading', percent: 0 });
    try { await this.updater.downloadUpdate(); }
    catch { this.set({ status: 'error' }); }
    finally { this.locked = false; }
    return this.state();
  }
  async install() {
    if (this.locked || this.value.status !== 'ready') return this.state();
    this.locked = true;
    try {
      this.assertIdle();
      if (!await this.confirmInstall()) return this.state();
      // Work may have started while the native confirmation was open.
      this.assertIdle();
      this.updater.quitAndInstall(false, true);
    } finally { this.locked = false; }
    return this.state();
  }
}
module.exports = { DesktopUpdates };
