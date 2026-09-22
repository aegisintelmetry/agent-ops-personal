const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { Writable } = require('node:stream');
const { test } = require('node:test');
const { protectStdio } = require('../electron/stdio.cjs');

test('both log streams tolerate repeated EPIPE errors', () => {
  const streams = [new EventEmitter(), new EventEmitter()];
  protectStdio(streams);
  for (const stream of streams) {
    for (let attempt = 0; attempt < 2; attempt++)
      assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' })));
  }
});

test('unrelated stream errors retain their original failure', () => {
  const stream = new EventEmitter();
  protectStdio([stream]);
  for (const code of ['EIO', 'EACCES', undefined]) {
    const error = Object.assign(new Error('unexpected'), { code });
    assert.throws(() => stream.emit('error', error), actual => actual === error);
  }
});

test('asynchronous broken writes do not become uncaught exceptions', async () => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      setImmediate(() => callback(Object.assign(new Error('closed'), { code: 'EPIPE' })));
    },
  });
  protectStdio([stream]);
  const closed = new Promise(resolve => stream.once('close', resolve));
  stream.write('message');
  await closed;
  assert.equal(stream.errored.code, 'EPIPE');
});

test('healthy output is unchanged and no global exception handler is installed', async () => {
  const before = process.listeners('uncaughtException');
  const chunks = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk.toString()); callback(); } });
  protectStdio([stream]);
  const finished = once(stream, 'finish');
  stream.end('normal output');
  await finished;
  assert.deepEqual(chunks, ['normal output']);
  assert.deepEqual(process.listeners('uncaughtException'), before);
});
