const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PersonalService } = require('../electron/personal.cjs');
const { GoogleAccounts } = require('../electron/google-accounts.cjs');
const { prepareMessages } = require('../electron/transmission-policy.cjs');
const { imageData, generatedImages } = require('../electron/image-data.cjs');
const { exportImage } = require('../electron/workspace-export.cjs');
const { image, png } = require('./image-fixture.cjs');
const key = 'fixture-image-secret';
function service(t, fetchImpl, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-image-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
  const instance = new PersonalService({ directory, safeStorage, fetchImpl, ...extra });
  instance.setMode('personal');
  instance.save({ provider: 'local', endpoint: 'http://127.0.0.1:1234/v1', model: 'fixture-vision', maxTokens: 512 });
  return instance;
}
const generated = () => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: { total_tokens: 18 } }));
const chat = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Image analyzed' }, finish_reason: 'stop' }] }));

test('image policy validates bytes, MIME, limits and immutable user-only attachments', () => {
  assert.equal(imageData(image).mime, 'image/png');
  for (const value of ['https://example.test/img.png', 'file:///private.png', image.replace('png', 'jpeg'), 'data:image/svg+xml;base64,AAAA', image + '=', 'data:image/png;base64,AAAA']) assert.throws(() => imageData(value));
  assert.throws(() => imageData(image, 10));
  const oversizedDimensions = Buffer.from(png); oversizedDimensions.writeUInt32BE(100000, 16); oversizedDimensions.writeUInt32BE(100000, 20);
  assert.throws(() => imageData(`data:image/png;base64,${oversizedDimensions.toString('base64')}`));
  assert.throws(() => prepareMessages([{ role: 'assistant', content: 'bad', images: [image] }]));
  assert.throws(() => prepareMessages([{ role: 'user', content: 'bad', images: Array(6).fill(image) }]));
  const original = [{ role: 'user', content: 'describe', images: [image] }];
  const snapshot = prepareMessages(original); original[0].images[0] = 'changed';
  assert.deepEqual(snapshot[0].images, [image]); assert.ok(Object.isFrozen(snapshot[0].images));
  assert.throws(() => prepareMessages([{ role: 'user', content: 'sk-' + 'fixture'.repeat(5), images: [image] }]), { code: 'transmission_blocked' });
});

test('vision sends binary image parts to the configured endpoint without changing plain chat', async t => {
  const requests = [];
  const instance = service(t, async (url, options) => { requests.push({ url, ...options }); return chat(); });
  await instance.complete([{ role: 'user', content: 'describe', images: [image] }]);
  const content = JSON.parse(requests[0].body).messages[0].content;
  assert.deepEqual(content, [{ type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url: image } }]);
  assert.equal(requests[0].redirect, 'error');
  await instance.complete([{ role: 'user', content: 'hello' }]);
  assert.equal(JSON.parse(requests[1].body).messages[0].content, 'hello');
});

test('generation uses one explicit image model, preserves chat settings and never fetches result URLs', async t => {
  let captured;
  const instance = service(t, async (url, options) => { captured = { url, ...options }; return generated(); });
  const result = await instance.complete([{ role: 'user', content: 'Generate a blue square' }], { imageModel: 'gpt-image-1.5' });
  assert.equal(captured.url, 'http://127.0.0.1:1234/v1/images/generations');
  assert.deepEqual(JSON.parse(captured.body), { model: 'gpt-image-1.5', prompt: 'Generate a blue square', n: 1, size: '1024x1024', output_format: 'png' });
  assert.deepEqual(result.images, [image]); assert.equal(result.usage.total_tokens, 18);
  assert.equal(instance.state().model, 'fixture-vision');
  for (const data of [{ data: [{ url: 'https://example.test/private' }] }, { data: [] }, { data: [{ b64_json: 'AAAA' }] }]) assert.throws(() => generatedImages(data));
});

test('image generation enforces redlines, key binding, provider limits and text-only prompts', async t => {
  let calls = 0;
  const instance = service(t, async () => { calls++; return generated(); });
  instance.save({ provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'fixture', maxTokens: 512, apiKey: key });
  for (const content of [key, 'sk-' + 'fixture'.repeat(5)]) await assert.rejects(instance.complete([{ role: 'user', content }], { imageModel: 'gpt-image-1.5' }), { code: 'transmission_blocked' });
  await assert.rejects(instance.complete([{ role: 'user', content: 'edit', images: [image] }], { imageModel: 'gpt-image-1.5' }), /image_prompt_only/);
  await assert.rejects(instance.complete([{ role: 'user', content: 'draw' }], { imageModel: '../bad?key=x' }), /image_unsupported/);
  instance.connection('codex');
  await assert.rejects(instance.complete([{ role: 'user', content: 'draw' }], { imageModel: 'gpt-image-1.5' }), /image_unsupported/);
  assert.equal(calls, 0);
});

test('Gemini API-key generation pins the native endpoint and requests image output', async t => {
  let captured;
  const instance = service(t, async (url, options) => { captured = { url, ...options }; return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] })); });
  instance.save({ provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-chat', maxTokens: 512, apiKey: key });
  assert.deepEqual((await instance.complete([{ role: 'user', content: 'draw' }], { imageModel: 'gemini-3.1-flash-image' })).images, [image]);
  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent');
  assert.equal(captured.headers['x-goog-api-key'], key); assert.equal(captured.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(captured.body).generationConfig.responseModalities, ['TEXT', 'IMAGE']);
});

test('Google login vision and generation use inline bytes and frozen input through refresh', async () => {
  const store = Object.create(GoogleAccounts.prototype);
  const messages = [{ role: 'user', content: 'describe', images: [image] }];
  store.credential = async () => { messages[0].images[0] = 'mutated'; return { token: key, project: 'fixture-project' }; };
  let captured;
  store.fetch = async (_url, options) => { captured = options; return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'answer' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] })); };
  const config = { accountId: 'fixture', model: 'gemini-fixture', maxTokens: 512 };
  await store.complete(messages, config, new AbortController().signal);
  assert.equal(JSON.parse(captured.body).contents[0].parts[1].inlineData.data, png.toString('base64'));
  const result = await store.complete([{ role: 'user', content: 'draw' }], config, new AbortController().signal, false, true);
  assert.deepEqual(result.images, [image]); assert.equal(captured.headers.Authorization, `Bearer ${key}`);
});

test('generation cancellation and timeout abort with no retry and release the shared lock', async t => {
  for (const timeout of [false, true]) {
    let calls = 0;
    const instance = service(t, async (_url, options) => { calls++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })); }, { timeoutMs: timeout ? 10 : 10000 });
    const promise = instance.complete([{ role: 'user', content: 'draw' }], { imageModel: 'image-model' });
    assert.throws(() => instance.connection('google'), /중단/);
    if (!timeout) instance.cancel();
    await assert.rejects(promise, timeout ? /초과/ : /취소/);
    assert.equal(calls, 1); assert.equal(instance.active, null);
  }
});

test('image export writes exact bytes only to a chosen matching image path', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-export-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'result.png');
  assert.equal((await exportImage({ name: 'image-1', image }, async () => ({ canceled: true }))).saved, false);
  await exportImage({ name: 'image-1', image }, async () => ({ filePath }));
  assert.deepEqual(fs.readFileSync(filePath), png);
  await assert.rejects(exportImage({ name: '../escape', image }, async () => assert.fail('unexpected dialog')));
  await assert.rejects(exportImage({ name: 'image-1', image }, async () => ({ filePath: path.join(directory, 'bad.exe') })));
});

test('generation errors do not expose response bodies and malformed or oversized images fail', async t => {
  for (const status of [401, 403, 429]) {
    const instance = service(t, async () => new Response('private-provider-error', { status }));
    await assert.rejects(instance.complete([{ role: 'user', content: 'draw' }], { imageModel: 'image-model' }), error => error.message.includes(String(status)) && !error.message.includes('private-provider-error'));
  }
  const instance = service(t, async () => new Response(JSON.stringify({ data: [{ url: 'https://example.test/image.png' }] })));
  await assert.rejects(instance.complete([{ role: 'user', content: 'draw' }], { imageModel: 'image-model' }), /image_missing/);
  assert.throws(() => generatedImages({ data: [{ b64_json: Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]).toString('base64') }] }));
});

test('Gemini generated images retain partial completion status and measured usage', async t => {
  const result = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }], usageMetadata: { totalTokenCount: 25 } };
  const instance = service(t, async () => new Response(JSON.stringify(result)));
  instance.save({ provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-chat', maxTokens: 512, apiKey: key });
  const output = await instance.complete([{ role: 'user', content: 'draw' }], { imageModel: 'gemini-3.1-flash-image' });
  assert.equal(output.status, 'partial'); assert.equal(output.usage.total_tokens, 25);
  const store = Object.create(GoogleAccounts.prototype);
  store.credential = async () => ({ token: key, project: 'fixture' });
  store.fetch = async () => new Response(JSON.stringify(result));
  assert.equal((await store.complete([{ role: 'user', content: 'draw' }], { model: 'gemini-fixture' }, new AbortController().signal, false, true)).status, 'partial');
});
