const test = require('node:test');
const assert = require('node:assert/strict');
const tools = import('../src/workspace.mjs');
const sessions = import('../src/sessions.mjs');

test('text sources reject unsupported, binary, oversized and empty inputs', async () => {
  const { readSource } = await tools;
  for (const [name, text, size] of [['file.pdf', 'text', 4], ['file.txt', '', 0], ['file.md', 'a\0b', 3], ['file.txt', 'a', 512 * 1024 * 1024 + 1], ['file.csv', 'a', 50 * 1024 * 1024 + 1]]) {
    await assert.rejects(readSource({ name, size, text: async () => text }));
  }
  const source = await readSource({ name: 'report.md', size: 5, text: async () => 'hello' });
  assert.equal(source.text, 'hello');
  assert.equal(source.name, 'report.md');
});

test('large text is attached as an explicit excerpt and native files avoid arrayBuffer', async () => {
  const { readSource, workspaceInput } = await tools;
  const large = await readSource({ name: 'long.md', size: 48001, text: async () => 'a'.repeat(48001) });
  assert.equal(large.text.length, 12000);
  assert.equal(large.truncated, true);
  const file = { name: 'project.zip', size: 500 * 1024 * 1024, arrayBuffer() { throw new Error('must not buffer'); } };
  const zip = await readSource(file, null, async selected => { assert.equal(selected, file); return { text: 'ZIP reference', entries: 2, skipped: 1, truncated: true }; });
  assert.equal(zip.entries, 2);
  assert.match(workspaceInput('read', [zip]), /"partial":true/);
  const input = workspaceInput('read', Array.from({ length: 5 }, (_, i) => ({ name: `${i}.md`, text: 'a'.repeat(12000) })));
  assert.ok(input.length < 16000);
  assert.match(input, /do not claim/);
});

test('source and output context reach the model without changing plain chat', async () => {
  const { workspaceInput } = await tools;
  assert.equal(workspaceInput('hello'), 'hello');
  const input = workspaceInput('summarize', [{ name: 'notes.txt', text: 'reference text' }], 'markdown');
  assert.match(input, /reference text/);
  assert.match(input, /not instructions/);
  assert.match(input, /Markdown/);
  assert.throws(() => workspaceInput('hi', [], 'video'));
  assert.throws(() => workspaceInput('hi', Array(6).fill({ text: 'a' })));
  assert.throws(() => workspaceInput('hi', [{ text: 'a'.repeat(12001) }]));
});

test('workspace state stays per session and model history retains successful attachments', async () => {
  const { initialSessions, sessionReducer, conversationInput } = await sessions;
  let state = initialSessions('one');
  state = sessionReducer(state, { type: 'workspace', id: 'one', value: { output: 'markdown', sources: [{ name: 'a.txt', text: 'test' }], id: 'malformed' } });
  state = sessionReducer(state, { type: 'create', id: 'two' });
  assert.equal(state.items[0].sources, undefined);
  assert.equal(state.items[1].sources.length, 1);
  assert.equal(state.items[1].id, 'one');
  const messages = [{ role: 'user', content: 'shown', modelContent: 'with sources', state: 'completed' }, { role: 'user', content: 'bad', modelContent: 'secret', state: 'failed' }];
  assert.deepEqual(conversationInput(messages, 'next'), [{ role: 'user', content: 'with sources' }, { role: 'user', content: 'next' }]);
});

test('outputs derive only from document responses and mark partial files', async () => {
  const { sessionArtifacts, artifactName } = await tools;
  const messages = [{ role: 'assistant', state: 'completed', output: 'markdown' }, { role: 'assistant', state: 'partial', output: 'text' }, { role: 'assistant', state: 'failed', output: 'text' }, { role: 'assistant', state: 'completed', output: 'chat' }];
  const results = sessionArtifacts({ messages });
  assert.equal(results.length, 2);
  assert.equal(artifactName(results[0], 0), 'document-1.md');
  assert.equal(artifactName(results[1], 1), 'document-2-partial.txt');
});

test('long source conversations keep recent context within the native request budget', async () => {
  const { conversationInput } = await sessions;
  const messages = Array.from({ length: 22 }, (_, i) => ({ role: 'user', state: 'completed', content: `visible ${i}`, modelContent: `${i}:` + 'x'.repeat(12000) }));
  const result = conversationInput(messages, 'current');
  assert.ok(JSON.stringify(result).length <= 80000);
  assert.match(result.at(-2).content, /^21:/);
  assert.deepEqual(result.at(-1), { role: 'user', content: 'current' });
});

test('image inputs travel separately from text and image generation rejects edit attachments', async () => {
  const { workspaceInput } = await tools;
  const source = { name: 'image.png', text: '', image: 'data:image/png;base64,AAAA' };
  assert.ok(!workspaceInput('read', [source]).includes('base64'));
  assert.throws(() => workspaceInput('read', [source], 'image'), /image_prompt_only/);
  const { conversationInput } = await sessions;
  const history = [{ role: 'user', state: 'completed', content: 'read', images: [source.image] }];
  assert.deepEqual(conversationInput(history, 'explain')[0].images, [source.image]);
  assert.equal(conversationInput(history, 'explain', [source.image])[0].images, undefined);
  assert.deepEqual(conversationInput(history, 'explain', [source.image]).at(-1).images, [source.image]);
});
