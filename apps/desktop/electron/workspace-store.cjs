const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { imageList, imageData } = require('./image-data.cjs');
const LIMIT = 32 * 1024 * 1024;
const fail = () => { throw new Error('workspace_storage'); };
const string = (value, max) => { if (typeof value !== 'string' || value.length > max) fail(); return value; };
const id = value => { if (!/^[A-Za-z0-9_-]{1,100}$/.test(string(value, 100)) || ['__proto__', 'constructor', 'prototype'].includes(value)) fail(); return value; };
const list = (value, max) => { if (!Array.isArray(value) || value.length > max) fail(); return value; };
const output = value => { if (!['chat', 'markdown', 'text', 'image'].includes(value ?? 'chat')) fail(); return value ?? 'chat'; };
const usage = value => value && Object.fromEntries(Object.entries(value).filter(([key, count]) => ['total_tokens', 'prompt_tokens', 'completion_tokens'].includes(key) && Number.isFinite(count) && count >= 0));

function validateGroups(groups, recover = false) {
  if (!groups || typeof groups !== 'object' || Array.isArray(groups) || Object.keys(groups).length > 20 || Buffer.byteLength(JSON.stringify(groups)) > LIMIT) fail();
  return Object.fromEntries(Object.entries(groups).map(([agent, group]) => {
    id(agent);
    const items = list(group.items, 20).map(item => {
      const sources = list(item.sources || [], 5).map(source => {
        const result = { id: id(source.id), name: string(source.name, 255), text: string(source.text, 12000) };
        if (source.image) {
          imageData(source.image);
          result.image = source.image;
        }
        return result;
      });
      if (sources.reduce((sum, source) => sum + source.text.length, 0) > 12000) fail();
      const messages = list(item.messages, 500).map(row => {
        if (!['user', 'assistant'].includes(row.role) || !['pending', 'completed', 'partial', 'failed'].includes(row.state)) fail();
        return { id: id(row.id), role: row.role, content: string(row.content, 100000), state: recover && row.state === 'pending' ? 'failed' : row.state,
          ...(row.modelContent !== undefined ? { modelContent: string(row.modelContent, 100000) } : {}),
          ...(row.images !== undefined ? { images: imageList(row.images, { output: row.role === 'assistant' }) } : {}),
          ...(row.model ? { model: string(row.model, 200) } : {}), output: output(row.output), usage: usage(row.usage) };
      });
      if (new Set(messages.map(row => row.id)).size !== messages.length) fail();
      const result = { id: id(item.id), title: string(item.title, 80), draft: string(item.draft, 16000), output: output(item.output), sources, messages };
      if (item.imageModel !== undefined) result.imageModel = string(item.imageModel, 200);
      if (item.latestRun) {
        const run = item.latestRun;
        if (!['running', 'completed', 'partial', 'failed', 'cancelled'].includes(run.status)) fail();
        result.latestRun = { id: id(run.id), startedAt: string(run.startedAt, 40), status: recover && run.status === 'running' ? 'cancelled' : run.status, usage: usage(run.usage),
          ...(run.model ? { model: string(run.model, 200) } : {}), ...(run.agentId ? { agentId: id(run.agentId) } : {}) };
      }
      return result;
    });
    if (!items.length || new Set(items.map(item => item.id)).size !== items.length || !items.some(item => item.id === group.selected)) fail();
    return [agent, { selected: group.selected, items }];
  }));
}

class WorkspaceStore {
  constructor({ directory, safeStorage }) { this.directory = directory; this.file = path.join(directory, 'workspace.enc'); this.safe = safeStorage; this.loaded = false; }
  guard() {
    if (!this.safe.isEncryptionAvailable() || this.safe.getSelectedStorageBackend?.() === 'basic_text') fail();
    for (const file of [this.directory, this.file]) if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail();
  }
  load() {
    this.guard();
    let groups = {};
    if (fs.existsSync(this.file)) {
      try {
        if (fs.statSync(this.file).size > LIMIT * 2) fail();
        const value = JSON.parse(this.safe.decryptString(fs.readFileSync(this.file)));
        if (value.schema !== 1) fail();
        groups = validateGroups(value.groups, true);
      } catch { fail(); }
    }
    this.loaded = true;
    return groups;
  }
  save(groups) {
    this.guard();
    // A corrupt/unreadable store must never be overwritten by a fresh UI session.
    if (!this.loaded) fail();
    const data = JSON.stringify({ schema: 1, groups: validateGroups(groups) });
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, this.safe.encryptString(data), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, this.file);
    } catch { fail(); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return { saved: true };
  }
}
module.exports = { WorkspaceStore, validateGroups };
