const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UiPreferences } = require('../electron/preferences.cjs');
const catalog = require('../electron/locales/en.json');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-language-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('language defaults to Korean and persists independently of model settings', t => {
  const directory = fixture(t);
  const settings = path.join(directory, 'agents.json');
  fs.writeFileSync(settings, '{"fixture":"unchanged"}');
  const preferences = new UiPreferences(directory);
  assert.deepEqual(preferences.read(), { language: 'ko' });
  preferences.save('en');
  assert.deepEqual(new UiPreferences(directory).read(), { language: 'en' });
  assert.equal(fs.readFileSync(settings, 'utf8'), '{"fixture":"unchanged"}');
  assert.deepEqual(JSON.parse(fs.readFileSync(preferences.file)), { language: 'en' });
});
test('unsupported language cannot alter the saved preference', t => {
  const preferences = new UiPreferences(fixture(t));
  preferences.save('en');
  for (const value of ['fr', '../ko', '', null, {}, ['en']]) assert.throws(() => preferences.save(value));
  assert.deepEqual(preferences.read(), { language: 'en' });
  assert.deepEqual(JSON.parse(fs.readFileSync(preferences.file)), { language: 'en' });
});
test('invalid, oversized, and unknown preferences fall back without overwriting', t => {
  const directory = fixture(t);
  for (const text of ['invalid', 'x'.repeat(2048), '{"language":"fr"}']) {
    fs.writeFileSync(path.join(directory, 'ui-preferences.json'), text);
    assert.equal(new UiPreferences(directory).language, 'ko');
    assert.equal(fs.readFileSync(path.join(directory, 'ui-preferences.json'), 'utf8'), text);
  }
});
test('failed persistence does not change the in-memory language', t => {
  const preferences = new UiPreferences(path.join(fixture(t), 'missing'));
  assert.throws(() => preferences.save('en'));
  assert.equal(preferences.language, 'ko');
});
test('translation switches labels and interpolates without translating user content', async () => {
  const { translate, dateLocale } = await import('../electron/i18n.mjs');
  assert.equal(translate('새 대화', 'en'), 'New chat');
  assert.equal(translate('새 대화', 'ko'), '새 대화');
  assert.equal(translate('{0} 삭제', 'en', ['개인 자료']), 'Delete 개인 자료');
  assert.equal(translate('opaque upstream response', 'en'), 'opaque upstream response');
  assert.equal(translate('constructor', 'en'), 'constructor');
  assert.equal(translate('__proto__', 'en'), '__proto__');
  assert.equal(dateLocale('en'), 'en-US');
  assert.equal(dateLocale('ko'), 'ko-KR');
});
test('translated errors retain transport identifiers and original unknown diagnostics', async () => {
  const { translateError } = await import('../electron/i18n.mjs');
  const prefix = "Error invoking remote method 'btk:personal:chat': Error: HTTP 429: ";
  assert.equal(translateError(prefix + '요청 한도 또는 잔액을 확인해 주세요.', 'en'), prefix + 'Check your rate limit or account balance.');
  assert.equal(translateError('서버 원문', 'en'), '서버 원문');
  assert.equal(translateError('constructor', 'en'), 'constructor');
});
test('catalog entries retain every interpolation slot and contain English translations', () => {
  for (const [key, value] of Object.entries(catalog)) {
    assert.ok(value.trim(), key);
    assert.ok(!/[가-힣]/u.test(value), key);
    assert.deepEqual((value.match(/\{\d+\}/g) || []).sort(), (key.match(/\{\d+\}/g) || []).sort(), key);
  }
});

test('every static translation call has an English catalog entry', async () => {
  const { parseSync } = await import('rolldown/utils');
  const root = path.resolve(__dirname, '..');
  const files = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.jsx')).map(name => path.join(root, 'src', name));
  files.push(path.join(root, 'electron/main.cjs'));
  function visit(node, file) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.name === 't' && typeof node.arguments[0]?.value === 'string') {
      assert.ok(Object.hasOwn(catalog, node.arguments[0].value), `${file}: ${node.arguments[0].value}`);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, file));
      else if (value && typeof value === 'object') visit(value, file);
    }
  }
  for (const file of files) visit(parseSync(file, fs.readFileSync(file, 'utf8')).program, file);
});
