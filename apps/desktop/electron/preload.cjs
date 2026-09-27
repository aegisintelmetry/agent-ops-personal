const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("btk", {
  native: true,
  updates: {
    state: () => ipcRenderer.invoke('btk:updates:state'),
    check: () => ipcRenderer.invoke('btk:updates:check'),
    download: () => ipcRenderer.invoke('btk:updates:download'),
    install: () => ipcRenderer.invoke('btk:updates:install'),
    subscribe: callback => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('btk:updates:changed', listener);
      return () => ipcRenderer.removeListener('btk:updates:changed', listener);
    },
  },
  preferences: {
    read: () => ipcRenderer.invoke('btk:preferences:read'),
    save: language => ipcRenderer.invoke('btk:preferences:save', { language }),
  },
  personal: {
    workspace: {
      read: () => ipcRenderer.invoke('btk:workspace:read'),
      save: groups => ipcRenderer.invoke('btk:workspace:save', groups),
      flush: groups => ipcRenderer.sendSync('btk:workspace:flush', groups),
      import: params => ipcRenderer.invoke('btk:workspace:import', params),
      importFile: async file => {
        // Only a browser File chosen/dropped by the user supplies a native path.
        const filePath = webUtils.getPathForFile(file);
        if (filePath) return ipcRenderer.invoke('btk:workspace:import-file', { filePath });
        if (file.size > 2 * 1024 * 1024) throw new Error('source_native');
        return ipcRenderer.invoke('btk:workspace:import', { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), detailed: true });
      },
    },
    google: {
      state: agentId => ipcRenderer.invoke('btk:google:state', { agentId }),
      import: (agentId, name) => ipcRenderer.invoke('btk:google:import', { agentId, name }),
      login: (agentId, id) => ipcRenderer.invoke('btk:google:login', { agentId, id }),
      reopenLogin: (agentId, id) => ipcRenderer.invoke('btk:google:reopenLogin', { agentId, id }),
      cancelLogin: agentId => ipcRenderer.invoke('btk:google:cancelLogin', { agentId }),
      remove: (agentId, id) => ipcRenderer.invoke('btk:google:remove', { agentId, id }),
      model: (agentId, config) => ipcRenderer.invoke('btk:google:model', { ...config, agentId }),
    },
    gemini: {
      state: agentId => ipcRenderer.invoke('btk:gemini:state', { agentId }),
      login: agentId => ipcRenderer.invoke('btk:gemini:login', { agentId }),
      cancelLogin: agentId => ipcRenderer.invoke('btk:gemini:cancelLogin', { agentId }),
      logout: agentId => ipcRenderer.invoke('btk:gemini:logout', { agentId }),
      model: (agentId, model) => ipcRenderer.invoke('btk:gemini:model', { agentId, model }),
    },
    knowledge: {
      read: agentId => ipcRenderer.invoke('btk:knowledge:read', { agentId }),
      prompt: (agentId, value) => ipcRenderer.invoke('btk:knowledge:prompt', { agentId, value }),
      save: (agentId, record) => ipcRenderer.invoke('btk:knowledge:save', { agentId, record }),
      remove: (agentId, id) => ipcRenderer.invoke('btk:knowledge:remove', { agentId, id }),
    },
    team: {
      clear: () => ipcRenderer.invoke('btk:team:clear'),
      configuration: () => ipcRenderer.invoke('btk:team:configuration'),
      configure: params => ipcRenderer.invoke('btk:team:configure', params),
      state: () => ipcRenderer.invoke('btk:team:state'),
      start: params => ipcRenderer.invoke('btk:team:start', params),
      cancel: () => ipcRenderer.invoke('btk:team:cancel'),
    },
    agents: {
      create: (name) => ipcRenderer.invoke("btk:personal:agent_create", { name }),
      select: (id) => ipcRenderer.invoke("btk:personal:agent_select", { id }),
      rename: (name) => ipcRenderer.invoke("btk:personal:agent_rename", { name }),
    },
    connection: (connection) => ipcRenderer.invoke("btk:personal:connection", { connection }),
    codex: {
      state: () => ipcRenderer.invoke("btk:personal:codex_state"),
      login: () => ipcRenderer.invoke("btk:personal:codex_login"),
      cancelLogin: () => ipcRenderer.invoke("btk:personal:codex_cancelLogin"),
      logout: () => ipcRenderer.invoke("btk:personal:codex_logout"),
      models: () => ipcRenderer.invoke("btk:personal:codex_models"),
      limits: () => ipcRenderer.invoke("btk:personal:codex_limits"),
      model: (model, effort = '') => ipcRenderer.invoke("btk:personal:codex_model", { model, effort }),
    },
    slack: {
      state: () => ipcRenderer.invoke("btk:personal:slack_state"),
      save: (token) => ipcRenderer.invoke("btk:personal:slack_save", { token }),
      enable: (enabled) => ipcRenderer.invoke("btk:personal:slack_enable", { enabled }),
      remove: () => ipcRenderer.invoke("btk:personal:slack_remove"),
      test: () => ipcRenderer.invoke("btk:personal:slack_test"),
      channels: (cursor = "") => ipcRenderer.invoke("btk:personal:slack_channels", { cursor }),
      cancel: () => ipcRenderer.invoke("btk:personal:slack_cancel"),
    },
    state: () => ipcRenderer.invoke("btk:personal:state"),
    mode: (mode) => ipcRenderer.invoke("btk:personal:mode", { mode }),
    save: (params) => ipcRenderer.invoke("btk:personal:save", params),
    removeKey: () => ipcRenderer.invoke("btk:personal:removeKey"),
    folder: () => ipcRenderer.invoke("btk:personal:folder"),
    exportDocument: params => ipcRenderer.invoke('btk:personal:export', params),
    exportImage: params => ipcRenderer.invoke('btk:personal:exportImage', params),
    generateImage: (messages, agentId, imageModel) => ipcRenderer.invoke('btk:personal:generateImage', { messages, agentId, imageModel }),
    copyDocument: content => ipcRenderer.invoke('btk:personal:copy', { content }),
    test: () => ipcRenderer.invoke("btk:personal:test"),
    chat: (messages, agentId) => ipcRenderer.invoke("btk:personal:chat", { messages, agentId }),
    cancel: () => ipcRenderer.invoke("btk:personal:cancel"),
  },
  snapshot: () => ipcRenderer.invoke("btk:snapshot"),
  connection: () => ipcRenderer.invoke("btk:connection"),
  readiness: () => ipcRenderer.invoke("btk:readiness"),
  setupStatus: () => ipcRenderer.invoke("btk:setup_status"),
  enroll: (params) => ipcRenderer.invoke("btk:setup_enroll", params),
  install: (params) => ipcRenderer.invoke("btk:setup_install", params),
  agentStatus: () => ipcRenderer.invoke("btk:agent_status"),
  startAgent: () => ipcRenderer.invoke("btk:agent_start"),
  task: (taskId) => ipcRenderer.invoke("btk:task", { task_id: taskId }),
  chat: (params) => ipcRenderer.invoke("btk:chat", params),
  cancel: (turnId) => ipcRenderer.invoke("btk:cancel", { turn_id: turnId }),
  onChat: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("btk:chat-event", listener);
    return () => ipcRenderer.removeListener("btk:chat-event", listener);
  },
  onDisconnect: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("btk:disconnected", listener);
    return () => ipcRenderer.removeListener("btk:disconnected", listener);
  },
});
