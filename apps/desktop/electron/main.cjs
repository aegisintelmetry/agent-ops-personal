require("./stdio.cjs").protectStdio();
const { app, BrowserWindow, ipcMain, session, dialog, safeStorage, shell } = require("electron");
const { CodexConnection } = require("./codex.cjs");
const { PersonalError } = require("./personal.cjs");
const { AgentProfiles } = require("./agents.cjs");
const { TeamCoordinator } = require('./team.cjs');
const { SlackConnector } = require("./slack.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Bridge, METHODS } = require("./bridge.cjs");
const { trustedFrame, bundledResource } = require("./security.cjs");
const { UiPreferences } = require('./preferences.cjs');

// This utility has no WebGL/video surfaces. Avoid retaining a hardware compositor
// allocation for a mostly static control window; background work lives outside Electron.
app.disableHardwareAcceleration();

const isolatedUserData = app.commandLine.getSwitchValue("user-data-dir");
if (isolatedUserData) app.setPath("userData", path.resolve(isolatedUserData));
const bridge = new Bridge({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, version: app.getVersion() });
const entry = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
let window;
let setupActive = false;
let setupMonitor;
let personal;
let slack;
let codex;
let agents;
let team;
let personalDialogActive = false;
let t = text => text;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const { translate } = await import('./i18n.mjs');
    const preferences = new UiPreferences(app.getPath('userData'));
    t = text => translate(text, preferences.language);
    for (const method of ['read', 'save']) {
      ipcMain.handle(`btk:preferences:${method}`, (event, params) => {
        if (!trustedFrame(event, window, entry)) throw new Error('Untrusted request');
        return method === 'read' ? preferences.read() : preferences.save(params?.language);
      });
    }
    let personalFailure = false;
    try {
      const directory = path.join(app.getPath("userData"), "agent-ops-personal");
      const relative = path.relative(path.resolve(__dirname, "../../.."), directory);
      if (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) throw new Error();
      agents = new AgentProfiles({ directory, safeStorage });
      personal = agents.service;
      slack = new SlackConnector({ personal });
      codex = new CodexConnection({ directory: agents.location(agents.data.selected), openExternal: url => shell.openExternal(url) });
    } catch { personalFailure = true; }
    const complete = async (messages, options) => {
      if (personal.data.connection !== "codex") return personal.complete(messages, options);
      personal.idle(); personal.codexActive = true;
      try { return await codex.complete(messages, personal.data.codexModel); }
      finally { personal.codexActive = false; }
    };
    team = new TeamCoordinator({ open: id => {
      const service = agents.open(id);
      const state = service.state();
      if (state.mode !== 'personal' || !state.model || (state.connection !== 'codex' && state.provider !== 'local' && !state.keyConfigured)) throw new PersonalError('참여 에이전트의 모델 연결을 설정해 주세요.');
      const connection = state.connection === 'codex' ? new CodexConnection({ directory: agents.location(id), openExternal: url => shell.openExternal(url) }) : null;
      return { model: state.model, complete: messages => connection ? connection.complete(messages, state.model) : service.complete(messages), cancel: () => connection ? connection.cancel() : service.cancel(), close: () => connection?.stop() };
    } });
    for (const method of ['state', 'start', 'cancel']) ipcMain.handle(`btk:team:${method}`, async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('Untrusted request');
      if (method === 'state') return team.state();
      if (method === 'cancel') return team.cancel();
      personal.idle();
      if (personalDialogActive || codex.loginId) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
      if (team.active) throw new PersonalError('팀 작업이 진행 중입니다.');
      personalDialogActive = true;
      try {
        const answer = await dialog.showMessageBox(window, { type: 'question', title: t('팀 작업 실행 확인'), buttons: [t('취소'), t('계속')], defaultId: 0, cancelId: 0, message: t('선택한 모델로 팀 작업을 실행할까요?'), detail: t('목표와 작업 결과가 참여 모델 공급자에게 전송됩니다. 최대 6회 호출하며 API 요금 또는 구독 한도가 소비됩니다. 기존 대화와 파일은 전송하지 않습니다. 실행 기록은 앱 종료 시 사라집니다.') });
        if (answer.response !== 1) return team.state();
      } finally { personalDialogActive = false; }
      return team.start(params, agents.data.agents);
    });
    for (const method of ["state", "agent_create", "agent_select", "agent_rename", "mode", "connection", "codex_state", "codex_login", "codex_cancelLogin", "codex_logout", "codex_models", "codex_limits", "codex_model", "save", "removeKey", "folder", "test", "chat", "cancel", "slack_state", "slack_save", "slack_enable", "slack_remove", "slack_test", "slack_channels", "slack_cancel"]) {
      ipcMain.handle(`btk:personal:${method}`, async (event, params) => {
        if (!trustedFrame(event, window, entry)) throw new Error("신뢰할 수 없는 요청입니다.");
        if (personalFailure) throw new Error("개인용 보안 설정을 읽지 못했습니다. 저장 위치와 기존 설정을 확인해 주세요.");
        try {
          if (method === "state") return agents.state();
          if (team.active) throw new PersonalError('팀 작업이 진행 중입니다.');
          if (personalDialogActive) throw new PersonalError("열린 확인 창을 먼저 닫아 주세요.");
          if (method === "mode") {
            if (setupActive || bridge.pending.size) throw new PersonalError("진행 중인 작업을 먼저 완료해 주세요.");
            const state = personal.setMode(params?.mode);
            codex.stop();
            if (state.mode === "personal") bridge.stop();
            return agents.state(state);
          }
          if (personal.data.mode !== "personal") throw new PersonalError("개인용 모드를 선택해 주세요.");
          if (method.startsWith("agent_")) {
            personal.idle();
            if (codex.loginId) throw new PersonalError("진행 중인 로그인을 완료하거나 취소해 주세요.");
            if (method === "agent_rename") return agents.rename(params?.name);
            const state = method === "agent_create" ? agents.create(params?.name) : agents.select(params?.id);
            codex.stop();
            personal = agents.service;
            slack = new SlackConnector({ personal });
            codex = new CodexConnection({ directory: agents.location(state.agentId), openExternal: url => shell.openExternal(url) });
            return state;
          }
          if (method === "connection") { const state = personal.connection(params?.connection); codex.stop(); return agents.state(state); }
          if (method.startsWith("codex_")) {
            if (personal.data.connection !== "codex") throw new PersonalError("ChatGPT 로그인 연결을 선택해 주세요.");
            personal.idle();
            personal.codexActive = true;
            try {
            if (method === "codex_state") return await codex.state();
            if (method === "codex_cancelLogin") return await codex.cancelLogin();
            if (method === "codex_login") return await codex.login();
            if (method === "codex_logout") return await codex.logout();
            if (method === "codex_models") return await codex.models();
            if (method === "codex_limits") return await codex.limits();
            if (method === "codex_model") {
              if (!(await codex.models()).some(model => model.id === params?.model)) throw new PersonalError("사용 가능한 Codex 모델을 선택해 주세요.");
              personal.codexActive = false;
              return agents.state(personal.codexModel(params.model));
            }
            } finally { personal.codexActive = false; }
          }
          if (method === "slack_state") return slack.state();
          if (method === "slack_save") return slack.save(params?.token);
          if (method === "slack_enable") return slack.enable(params?.enabled);
          if (method === "slack_remove") return slack.remove();
          if (method === "slack_test") return await slack.call("auth.test");
          if (method === "slack_channels") return await slack.call("conversations.list", params?.cursor ?? "");
          if (method === "slack_cancel") return slack.cancel();
          if (method === "save") return agents.state(personal.save(params));
          if (method === "removeKey") return agents.state(personal.removeKey());
          if (method === "cancel") return personal.data.connection === "codex" ? codex.cancel() : personal.cancel();
          if (method === "folder") {
            personal.idle();
            personalDialogActive = true;
            try {
              const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
              return agents.state(selection.canceled ? personal.state() : personal.workspace(selection.filePaths[0]));
            } finally { personalDialogActive = false; }
          }
          if (method === "test") {
            personal.idle();
            personalDialogActive = true;
            let answer;
            try {
              answer = await dialog.showMessageBox(window, { type: "question", title: t("모델 연결 시험"), buttons: [t("취소"), t("시험")], defaultId: 0, cancelId: 0,
                message: t("저장된 모델로 시험 요청을 보낼까요?"), detail: personal.data.connection === "codex" ? t("ChatGPT 구독의 Codex 사용 한도가 소비됩니다. 작업 폴더는 전송하지 않습니다.") : `${personal.data.endpoint}\n${personal.data.model}\n${t("선택한 주소로 요청이 전송됩니다. 외부 공급자는 API 사용 요금이 발생할 수 있습니다. 작업 폴더는 전송하지 않습니다.")}` });
            } finally { personalDialogActive = false; }
            if (answer.response !== 1) throw new PersonalError("연결 시험을 취소했습니다.");
            const result = await complete([{ role: "user", content: "Reply with OK." }], { probe: true });
            return { status: result.status, usage: result.usage, checkedAt: result.checkedAt };
          }
          if (params?.agentId !== agents.data.selected) throw new PersonalError("대화의 에이전트가 변경되었습니다. 선택 상태를 확인해 주세요.");
          const agent = agents.state();
          const result = await complete(params?.messages);
          return { ...result, agentId: agent.agentId, agentName: agent.agentName, model: agent.model };
        } catch (error) {
          throw new Error(error instanceof PersonalError ? error.message : "개인용 요청을 처리하지 못했습니다.");
        }
      });
    }
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
      callback({ cancel: !bundledResource(request.url, path.resolve(__dirname, "../dist")) });
    });
    for (const method of METHODS) {
      ipcMain.handle(`btk:${method}`, async (event, params) => {
        if (!trustedFrame(event, window, entry))
          throw new Error("신뢰할 수 없는 요청입니다.");
        if (personalFailure || personal?.data.mode !== "enterprise") throw new Error("조직용 기능은 정상 설정된 조직 연결 모드에서만 사용할 수 있습니다.");
        if (["setup_enroll", "setup_install", "agent_start"].includes(method)) {
          if (setupActive) throw new Error("설치 작업을 진행 중입니다.");
          setupActive = true;
          try {
            const answer = await dialog.showMessageBox(window, {
              type: "question", buttons: [t("취소"), t("계속")], defaultId: 0, cancelId: 0,
              title: t("AEGIS Agent Ops 설치 확인"),
              message: method === "agent_start" ? t("설치된 에이전트를 백그라운드에서 시작할까요?") : method === "setup_enroll" ? t("이 PC를 중앙 프로파일에 연결할까요?") : t("필수 도구와 운영 서비스를 설치할까요?"),
              detail: method === "setup_enroll" ? t("등록 코드는 중앙 인증에만 사용됩니다. 기존 러너 신원은 바꾸지 않습니다.")
                : method === "agent_start" ? t("현재 프로파일의 검증된 런타임만 시작합니다. 창을 닫아도 실행은 유지되며 기존 운영 서비스가 있으면 중복 시작하지 않습니다.")
                : t("공식 배포 번들과 필요한 외부 도구를 내려받습니다. 모델 인증과 Windows 권한 승인이 필요할 수 있습니다. 선택한 경우 서비스 시작 및 로그인 시 자동시작을 등록합니다."),
            });
            if (answer.response !== 1) throw new Error("사용자가 취소했습니다.");
            const result = await bridge.call(method, params);
            if (method === "setup_install" && result.status === "running") {
              setupMonitor = setInterval(async () => {
                try {
                  if ((await bridge.call("setup_status")).status !== "running") {
                    setupActive = false; clearInterval(setupMonitor);
                  }
                } catch { setupActive = false; clearInterval(setupMonitor); }
              }, 1500);
            } else setupActive = false;
            return result;
          } catch (error) { setupActive = false; throw error; }
        }
        return bridge.call(method, params);
      });
    }
    window = new BrowserWindow({
      title: "AEGIS Agent Ops",
      width: 1360,
      height: 900,
      minWidth: 760,
      minHeight: 600,
      backgroundColor: "#f6f7f8",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    bridge.on("chat", (data) => {
      if (!window.isDestroyed())
        window.webContents.send("btk:chat-event", data);
    });
    bridge.on("disconnected", () => {
      if (!window.isDestroyed()) window.webContents.send("btk:disconnected");
    });
    window.loadURL(entry);
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (setupActive) { event.preventDefault(); return; }
    clearInterval(setupMonitor);
    personal?.cancel();
    team?.cancel();
    codex?.stop();
    slack?.cancel();
    bridge.stop();
  });
  app.on("browser-window-created", (_event, created) => {
    created.on("close", (event) => {
      if (setupActive) {
        event.preventDefault();
        dialog.showMessageBox(created, { type: "info", message: t("설치가 진행 중입니다."), detail: t("완료 또는 실패 결과를 확인한 뒤 닫을 수 있습니다.") });
      }
    });
  });
}
