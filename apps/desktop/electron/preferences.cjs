const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class UiPreferences {
  constructor(directory) {
    this.file = path.join(directory, 'ui-preferences.json');
    this.language = 'ko';
    try {
      if (fs.lstatSync(this.file).isSymbolicLink()) return;
      if (fs.statSync(this.file).size > 1024) return;
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (['ko', 'en'].includes(value.language)) this.language = value.language;
    } catch { /* A missing or invalid UI preference must not prevent startup. */ }
  }
  read() { return { language: this.language }; }
  save(language) {
    if (!['ko', 'en'].includes(language)) throw new Error('Unsupported language');
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ language }), { encoding: 'utf8', flag: 'wx' });
      try {
        if (fs.existsSync(this.file) && fs.lstatSync(this.file).isSymbolicLink()) throw new Error();
        fs.renameSync(temporary, this.file);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    } catch { throw new Error('Could not save language preference'); }
    this.language = language;
    return this.read();
  }
}
module.exports = { UiPreferences };
