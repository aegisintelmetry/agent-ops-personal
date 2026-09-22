import { useI18n, LanguageSelect } from "./Language";
import React, { useEffect, useReducer, useState } from "react";
import { ArrowUp, Check, CircleAlert, Cpu, FolderOpen, KeyRound, LoaderCircle, MessageSquare, PanelLeft, PanelRight, Plug, Plus, Save, Settings2, Shield, Square, Trash2, Workflow, X } from "lucide-react";
import RunSummary from "./RunSummary";
import SlackPanel from "./SlackPanel";
import CodexSettings from "./CodexSettings";
import TeamPanel from './TeamPanel';
import providers from "../electron/providers.json";
import { initialSessions, agentSessionsReducer, MAX_SESSIONS } from "./sessions.mjs";
import "./personal.css";

const native = () => window.btk.personal;
function ButtonIcon({ label, children, ...props }) {
  return <button type="button" className="icon-button" title={label} aria-label={label} {...props}>{children}</button>;
}

export function EditionRoot({ Enterprise }) {
  const { t, locale, errorText } = useI18n();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const supported = Boolean(window.btk?.personal);
  useEffect(() => {
    if (!supported) return;
    native().state().then(setState).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  async function select(mode) {
    setBusy(true); setError("");
    try { setState(await native().mode(mode)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (!supported) return <Enterprise />;
  if (loading) return <div className="edition-choice" role="status">{t("설정 확인 중")}</div>;
  if (state?.mode === "personal") return <PersonalApp initial={state} onModeChange={() => select("enterprise")} modeBusy={busy} modeError={errorText(error)} />;
  if (state?.mode === "enterprise") return <><Enterprise onModeChange={() => select("personal")} modeBusy={busy} />{error && <p className="mode-error" role="alert">{errorText(error)}</p>}</>;
  return <main className="edition-choice">
    <LanguageSelect />
    <Workflow size={36} className="workspace-logo" /><h1>AEGIS Agent Ops</h1>
    <div className="edition-options" role="group" aria-label={t("실행 모드")}>
      <button disabled={busy || !state} onClick={() => select("personal")}><MonitorMark /><strong>{t("개인용")}</strong><span>Personal</span></button>
      <button disabled={busy || !state} onClick={() => select("enterprise")}><Shield size={25} /><strong>{t("조직 연결")}</strong><span>Enterprise</span></button>
    </div>
    {error && <p role="alert">{errorText(error)}</p>}
  </main>;
}
function MonitorMark() { return <Cpu size={25} />; }

function AgentName({ state, busy, run, onSaved }) {
  const { t, locale, errorText } = useI18n();
  const [name, setName] = useState(state.agentName || t("기본 에이전트"));
  return <form className="personal-agent-name" onSubmit={event => { event.preventDefault(); run(async () => onSaved(await native().agents.rename(name))); }}>
    <label>{t("에이전트 이름")}<input required maxLength={60} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
    <button type="submit" className="outline-button" disabled={busy || !name.trim() || name.trim() === state.agentName}><Save size={16} />{t("이름 저장")}</button>
  </form>;
}

function ModelSettings({ state, busy, run, onSaved }) {
  const { t, locale, errorText } = useI18n();
  const [form, setForm] = useState({ provider: state.provider, endpoint: state.endpoint, model: state.model, maxTokens: state.maxTokens, apiKey: "" });
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const preset = providers.find(item => item.id === form.provider);
  const matchingKey = state.keyConfigured && form.provider === state.provider && form.endpoint === state.endpoint;
  function field(key, value) { setForm(old => ({ ...old, [key]: value })); setDirty(true); setNotice(""); }
  function provider(value) {
    const selected = providers.find(item => item.id === value);
    setForm({ provider: value, endpoint: selected.endpoint, model: selected.model, apiKey: "", maxTokens: selected.maxTokens });
    setDirty(true); setNotice("");
  }
  async function save(event) {
    event.preventDefault(); setNotice("");
    const input = { ...form };
    setForm(old => ({ ...old, apiKey: "" }));
    await run(async () => {
      const result = await native().save(input);
      onSaved(result); setDirty(false); setNotice("설정 저장됨 · 연결 미검증");
    });
    input.apiKey = "";
  }
  return <section className="personal-settings">
    <h1>{t("모델 연결")}</h1>
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <label>{t("공급자")}<select aria-label={t("공급자")} value={form.provider} onChange={e => provider(e.target.value)}>
          {providers.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
        </select></label>
        <label>{t("API 주소")}<input type="url" required value={form.endpoint} readOnly={preset?.fixedEndpoint} placeholder="https://model.example.com/v1" onChange={e => field("endpoint", e.target.value)} /></label>
        <label>{t("모델 ID")}<input required maxLength={200} value={form.model} onChange={e => field("model", e.target.value)} autoComplete="off" /></label>
        <label>{t("API 키")}<input type="password" value={form.apiKey} maxLength={8192} autoComplete="new-password" spellCheck={false} placeholder={state.keyConfigured && form.endpoint === state.endpoint && form.provider === state.provider ? t("저장된 키 유지") : form.provider === "local" ? t("선택 사항") : t("API 키")} onChange={e => field("apiKey", e.target.value)} /></label>
        <div className="personal-key-state"><KeyRound size={15} /><span>{matchingKey ? t("키 저장됨") : t("키 미등록")}</span><span>{state.secureStorage ? t("OS 암호화 사용 가능") : t("보안 저장소 사용 불가")}</span></div>
        <label>{t("최대 출력 토큰")}<input type="number" min={64} max={16384} step={1} required value={form.maxTokens} onChange={e => field("maxTokens", Number(e.target.value))} /></label>
        <div className="personal-actions">
          <button type="submit" className="outline-button"><Save size={16} />{t("저장")}</button>
          <button type="button" className="outline-button" disabled={dirty || !state.model} onClick={() => run(async () => {
            const result = await native().test();
            setNotice({ key: result.status === "completed" ? "연결 확인" : "응답 수신 · 출력 불완전", at: result.checkedAt });
          })}><Check size={16} />{t("연결 시험")}</button>
          <ButtonIcon label={t("저장된 키 삭제")} disabled={!matchingKey} onClick={() => run(async () => {
            onSaved(await native().removeKey()); setNotice("키 삭제됨");
          })}><Trash2 size={16} /></ButtonIcon>
        </div>
      </fieldset>
    </form>
    {notice && <p className="personal-notice" role="status">{typeof notice === 'string' ? t(notice) : `${t(notice.key)} · ${new Date(notice.at).toLocaleTimeString(locale)}`}</p>}
  </section>;
}

function PersonalApp({ initial, onModeChange, modeBusy, modeError }) {
  const { t, locale, errorText } = useI18n();
  const [state, setState] = useState(initial);
  const [view, setView] = useState(initial.model ? "chat" : "settings");
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [teamRun, setTeamRun] = useState(null);
  useEffect(() => {
    let alive = true;
    let timer;
    const poll = async () => {
      try { const value = await native().team.state(); if (alive) { setTeamRun(value); if (value?.status === 'running') timer = setTimeout(poll, 1000); } }
      catch (e) { if (alive) setError(e.message); }
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [teamRun?.status]);
  const [error, setError] = useState("");
  const [sessionGroups, dispatchGroup] = useReducer(agentSessionsReducer, null, () => ({ [initial.agentId || "default"]: initialSessions(crypto.randomUUID()) }));
  const agentId = state.agentId || "default";
  const sessions = sessionGroups[agentId];
  const dispatch = action => dispatchGroup({ agentId, action });
  const [slack, setSlack] = useState(null);
  const [showSummary, setShowSummary] = useState(() => window.innerWidth > 1100);
  const [navOpen, setNavOpen] = useState(() => window.innerWidth > 900);
  useEffect(() => {
    const nav = window.matchMedia("(max-width: 900px)");
    const summary = window.matchMedia("(max-width: 1100px)");
    const updateNav = () => setNavOpen(!nav.matches);
    const updateSummary = () => setShowSummary(!summary.matches);
    const escape = event => { if (event.key === "Escape") { if (nav.matches) setNavOpen(false); if (summary.matches) setShowSummary(false); } };
    nav.addEventListener("change", updateNav); summary.addEventListener("change", updateSummary);
    window.addEventListener("keydown", escape);
    return () => { nav.removeEventListener("change", updateNav); summary.removeEventListener("change", updateSummary); window.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => {
    let current = true;
    if (native().slack) native().slack.state().then(value => { if (current) setSlack(value); }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [agentId]);
  const selected = sessions.items.find(item => item.id === sessions.selected);
  const locked = busy || chatBusy || modeBusy || teamRun?.status === 'running';
  function navigate(next) { setError(""); setView(next); if (window.innerWidth <= 900) setNavOpen(false); }
  async function run(action) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function saved(result) {
    setState(result);
    dispatch({ type: "reset", id: crypto.randomUUID() });
  }
  function agentChanged(result) {
    dispatchGroup({ agentId: result.agentId, action: { type: "ensure", id: crypto.randomUUID() } });
    setSlack(null);
    setState(result);
    setView(result.model ? "chat" : "settings");
  }
  async function send(event) {
    event.preventDefault();
    if (locked || !selected.draft.trim()) return;
    const id = selected.id;
    const text = selected.draft.trim();
    const latestRun = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), status: "running" };
    dispatch({ type: "run", id, value: latestRun });
    const messages = [...selected.messages.filter(row => row.role === "user" || row.state === "completed").slice(-22).map(({ role, content }) => ({ role, content })), { role: "user", content: text }];
    dispatch({ type: "messages", id, value: rows => [...rows, { id: crypto.randomUUID(), role: "user", content: text }] });
    dispatch({ type: "draft", id, value: "" });
    setChatBusy(true); setError("");
    try {
      const result = await native().chat(messages, agentId);
      dispatch({ type: "run", id, value: { ...latestRun, status: result.status, usage: result.usage, agentId: result.agentId, model: result.model } });
      dispatch({ type: "messages", id, value: rows => [...rows, { id: crypto.randomUUID(), role: "assistant", content: result.text, state: result.status, usage: result.usage }] });
    } catch (e) {
      setError(e.message);
      dispatch({ type: "run", id, value: { ...latestRun, status: e.message.includes("요청을 취소했습니다") ? "cancelled" : "failed" } });
    }
    finally { setChatBusy(false); }
  }
  return <div className={`app workspace-app personal-app ${navOpen ? "nav-open" : "nav-closed"}`}>
    {navOpen && <button className="personal-nav-scrim" aria-label={t("탐색 닫기")} onClick={() => setNavOpen(false)} />}
    <aside className="sidebar">
      <div className="brand"><span className="brand-symbol"><Workflow size={21} /></span><div>AEGIS<small>Agent Ops Personal</small></div></div>
      <button className="new-chat" disabled={locked || sessions.items.length >= MAX_SESSIONS} onClick={() => { dispatch({ type: "create", id: crypto.randomUUID() }); navigate("chat"); }}><Plus size={17} />{t("새 대화")}</button>
      <nav aria-label={t("개인용 탐색")}>
        <button className={view === 'team' ? 'active' : ''} disabled={busy || chatBusy} onClick={() => navigate('team')}><Workflow size={18} />{t('팀 작업')}</button>
        <button className={view === "chat" ? "active" : ""} disabled={busy} onClick={() => navigate("chat")}><MessageSquare size={18} />{t("작업 공간")}</button>
        <button className={view === "settings" ? "active" : ""} disabled={locked} onClick={() => navigate("settings")}><Settings2 size={18} />{t("모델 연결")}</button>
        <button className={view === "connectors" ? "active" : ""} disabled={locked} onClick={() => navigate("connectors")}><Plug size={18} />{t("커넥터")}</button>
        <button disabled={locked} onClick={() => run(async () => { const result = await native().folder(); if (result.workspace !== state.workspace) saved(result); })}><FolderOpen size={18} />{t("작업 폴더")}</button>
      </nav>
      <section className="session-list" aria-label={t("개인 대화 세션")}><h2>{t("세션")} <span>{sessions.items.length}</span></h2>
        {sessions.items.map(item => <div key={item.id} className={`session-row ${item.id === selected.id ? "selected" : ""}`}>
          <button className="session-select" disabled={locked} title={item.messages.length ? item.title : t("새 대화")} onClick={() => { dispatch({ type: "select", id: item.id }); navigate("chat"); }}><MessageSquare size={15} /><span>{item.messages.length ? item.title : t("새 대화")}</span></button>
          <ButtonIcon label={t("{0} 삭제", [item.title])} disabled={locked} onClick={() => { if (window.confirm(t("이 대화를 삭제할까요?"))) dispatch({ type: "remove", id: item.id, replacementId: crypto.randomUUID() }); }}><X size={13} /></ButtonIcon>
        </div>)}
      </section>
      <div className="sidebar-bottom"><button className="outline-button" disabled={locked} onClick={onModeChange}><Shield size={16} />{t("조직 연결")}</button></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb"><ButtonIcon label={t("탐색 표시")} aria-expanded={navOpen} onClick={() => setNavOpen(value => !value)}><PanelLeft size={17} /></ButtonIcon><span>Personal</span><strong>{view === "settings" ? t("모델 연결") : view === "connectors" ? t("커넥터") : t("작업 공간")}</strong></div><div className="topbar-actions"><LanguageSelect /><span className="personal-local">{t("중앙 연결 없음")}</span>{view === "chat" && <ButtonIcon label={t("실행 요약 표시")} aria-pressed={showSummary} onClick={() => setShowSummary(value => !value)}><PanelRight size={17} /></ButtonIcon>}</div></header>
      {(error || modeError) && <div className="personal-error" role="alert"><CircleAlert size={17} /><span>{errorText(error || modeError)}</span></div>}
      <div className="personal-agent-bar"><label>{t("에이전트")}<select aria-label={t("에이전트")} disabled={locked} value={agentId} onChange={event => { const id = event.target.value; run(async () => agentChanged(await native().agents.select(id))); }}>{(state.agents || [{ id: "default", name: t("기본 에이전트") }]).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><ButtonIcon label={t("에이전트 추가")} disabled={locked || (state.agents?.length || 1) >= 20} onClick={() => run(async () => agentChanged(await native().agents.create(t("새 에이전트"))))}><Plus size={18} /></ButtonIcon><span>{state.model || t("모델 미설정")}</span></div>
      {view === 'team' ? <TeamPanel agents={state.agents} selectedId={agentId} run={teamRun} busy={locked} onStart={params => run(async () => setTeamRun(await native().team.start(params)))} onCancel={() => run(async () => setTeamRun(await native().team.cancel()))} /> :
      view === "settings" ? <div className="personal-settings-scroll"><AgentName key={agentId} state={state} busy={locked} run={run} onSaved={setState} /><div className="personal-connection"><label>{t("연결 방식")}<select aria-label={t("연결 방식")} value={state.connection || "api"} disabled={locked} onChange={event => { const value = event.target.value; run(async () => saved(await native().connection(value))); }}><option value="api">{t("API 키 / 로컬 모델")}</option><option value="codex">{t("ChatGPT 로그인")}</option></select></label></div>{state.connection === "codex" ? <CodexSettings key={agentId} state={state} busy={locked} run={run} onSaved={saved} /> : <ModelSettings key={`${agentId}:${state.connection || "api"}`} state={state} busy={locked} run={run} onSaved={saved} />}</div> : view === "connectors" ? <div className="personal-settings-scroll"><SlackPanel key={agentId} state={slack} onState={setSlack} busy={locked} run={run} /></div> :
        <div className={`personal-workspace ${showSummary ? "with-summary" : ""}`}>
        <section className="personal-chat">
          <div className="personal-context"><FolderOpen size={15} /><span title={state.workspace}>{state.workspace || t("작업 폴더 미선택")}</span><small>{t("파일 접근 비활성")}</small></div>
          <div className="personal-transcript" role="log" aria-label={t("개인 대화")}>
            {!selected.messages.length && <div className="personal-empty"><Workflow size={32} className="workspace-logo" /><h1>AEGIS Agent Ops</h1><span>{state.model || t("모델 미연결")}</span></div>}
            {selected.messages.map(row => <article className={`personal-message ${row.role}`} key={row.id}><strong>{row.role === "user" ? t("나") : state.model}</strong><p>{row.content}</p>{row.state === "partial" && <small>{t("응답 불완전")}</small>}{row.usage && <small>{t("토큰")} {row.usage.total_tokens ?? t("미제공")}</small>}</article>)}
            {chatBusy && <div className="personal-pending" role="status"><LoaderCircle size={16} className="spin" />{t("응답 대기 중")}</div>}
          </div>
          <form className="composer" onSubmit={send}><textarea aria-label={t("개인 메시지")} maxLength={16000} disabled={locked} value={selected.draft} onChange={e => dispatch({ type: "draft", id: selected.id, value: e.target.value })} />
            <div className="composer-bottom"><span>{state.model || t("모델 미연결")}</span>{chatBusy ? <ButtonIcon label={t("개인 답변 중단")} onClick={() => native().cancel().catch(e => setError(e.message))}><Square size={16} /></ButtonIcon> : <button className="send" aria-label={t("개인 메시지 전송")} title={t("전송")} disabled={locked || !state.model || !selected.draft.trim() || (!state.keyConfigured && !["local", "codex"].includes(state.provider))}><ArrowUp size={18} /></button>}</div>
          </form>
          <div className="personal-destination"><span title={state.endpoint}>{state.endpoint || t("API 주소 미설정")}</span><span>{t("도구 실행 비활성")}</span></div>
        </section>
        {showSummary && <><button className="personal-summary-scrim" aria-label={t("실행 요약 닫기")} onClick={() => setShowSummary(false)} /><RunSummary state={state} session={selected} slack={slack} onConnectors={() => { if (!locked) navigate("connectors"); }} /></>}
        </div>}
    </main>
  </div>;
}
