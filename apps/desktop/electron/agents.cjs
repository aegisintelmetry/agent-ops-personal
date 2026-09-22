const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PersonalError, PersonalService } = require("./personal.cjs");

const fail = message => { throw new PersonalError(message); };
const validId = id => id === "default" || (typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id));
function nameOf(name) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60 || /[\x00-\x1f]/.test(name)) fail("에이전트 이름은 1~60자로 입력해 주세요.");
  return name.trim();
}
function teamOf(value, agents) {
  if (!value || !Array.isArray(value.workerIds) || value.workerIds.length > 4 ||
      new Set([value.masterId, ...value.workerIds]).size !== value.workerIds.length + 1 ||
      [value.masterId, ...value.workerIds].some(id => !agents.some(a => a.id === id))) fail('팀 구성이 올바르지 않습니다.');
  return { masterId: value.masterId, workerIds: [...value.workerIds] };
}

// Metadata lives here; model credentials remain in each PersonalService's OS-encrypted file.
// The default agent keeps its original paths, including its existing Codex keyring identity.
class AgentProfiles {
  constructor({ directory, safeStorage, serviceFactory = options => new PersonalService(options) }) {
    this.directory = directory;
    this.options = { safeStorage };
    this.factory = serviceFactory;
    this.file = path.join(directory, "agents.json");
    this.data = { schema: 1, selected: "default", agents: [{ id: "default", name: "기본 에이전트" }] };
    if (fs.existsSync(this.file)) {
      try {
        if (fs.lstatSync(this.file).isSymbolicLink() || fs.statSync(this.file).size > 16000) throw new Error();
        const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (data.schema !== 1 || !Array.isArray(data.agents) || !data.agents.length || data.agents.length > 20 ||
            data.agents.some(a => !a || !validId(a.id) || nameOf(a.name) !== a.name) ||
            new Set(data.agents.map(a => a.id)).size !== data.agents.length ||
            !data.agents.some(a => a.id === "default") || !data.agents.some(a => a.id === data.selected)) throw new Error();
        this.data = { schema: 1, selected: data.selected, agents: data.agents.map(({ id, name }) => ({ id, name })), ...(data.team ? { team: teamOf(data.team, data.agents) } : {}) };
      } catch { fail("에이전트 목록을 읽지 못했습니다. 기존 설정은 덮어쓰지 않았습니다."); }
    }
    this.service = this.open(this.data.selected);
  }
  location(id) {
    if (!validId(id)) fail("에이전트 ID가 올바르지 않습니다.");
    const location = id === "default" ? this.directory : path.join(this.directory, "agents", id);
    for (const candidate of [this.directory, path.join(this.directory, "agents"), location]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) fail("에이전트 저장 경로가 올바르지 않습니다.");
    }
    return location;
  }
  open(id) { return this.factory({ ...this.options, directory: this.location(id) }); }
  teamState() {
    return { ...(this.data.team || { masterId: 'default', workerIds: [] }), agents: this.data.agents.map(agent => {
      try {
        const state = (agent.id === this.data.selected ? this.service : this.open(agent.id)).state();
        return { ...agent, model: state.model, connection: state.connection, provider: state.provider,
          configured: Boolean(state.mode === 'personal' && state.model && (state.connection === 'codex' || state.provider === 'local' || state.keyConfigured)) };
      } catch { return { ...agent, model: '', connection: '', provider: '', configured: false }; }
    }) };
  }
  configureTeam(value) {
    this.service.idle();
    this.persist({ ...this.data, team: teamOf(value, this.data.agents) });
    return this.teamState();
  }
  state(value = this.service.state()) {
    const agent = this.data.agents.find(a => a.id === this.data.selected);
    return { ...value, agentId: agent.id, agentName: agent.name, agents: this.data.agents.map(a => ({ ...a })) };
  }
  persist(data) {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = this.file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temp, JSON.stringify(data), { flag: "wx", mode: 0o600 });
      fs.renameSync(temp, this.file);
      this.data = data;
    } catch { fail("에이전트 목록 저장에 실패했습니다."); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  create(name) {
    this.service.idle();
    if (this.data.agents.length >= 20) fail("에이전트는 최대 20개까지 등록할 수 있습니다.");
    const agent = { id: randomUUID(), name: nameOf(name) };
    const service = this.open(agent.id);
    service.setMode("personal");
    this.persist({ ...this.data, selected: agent.id, agents: [...this.data.agents, agent] });
    this.service = service;
    return this.state();
  }
  select(id) {
    this.service.idle();
    if (!this.data.agents.some(a => a.id === id)) fail("등록된 에이전트를 선택해 주세요.");
    const service = this.open(id);
    service.setMode("personal");
    this.persist({ ...this.data, selected: id });
    this.service = service;
    return this.state();
  }
  rename(name) {
    this.service.idle();
    const value = nameOf(name);
    this.persist({ ...this.data, agents: this.data.agents.map(a => a.id === this.data.selected ? { ...a, name: value } : a) });
    return this.state();
  }
}

module.exports = { AgentProfiles };
