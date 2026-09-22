import { useI18n, LanguageSelect, LanguageProvider } from "./Language";
import React, { useEffect, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Cpu,
  FileText,
  History,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  Monitor,
  PackageCheck,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  Square,
  Workflow,
  X,
} from "lucide-react";
import { api } from "./api";
import SetupPanel from "./SetupPanel";
import { EditionRoot } from "./PersonalApp";
import { initialSessions, MAX_SESSIONS, sessionReducer } from "./sessions.mjs";
import "./styles.css";
import "./workspace.css";

const navigation = [
  ["chat", "에이전트 대화", MessageSquare],
  ["history", "실행 기록", History],
  ["runtime", "연결 상태", Activity],
  ["settings", "프로파일", Settings2],
  ["setup", "설치 점검", PackageCheck],
];
const names = {
  completed: "완료",
  failed: "실패",
  needs_input: "입력 대기",
  blocked: "차단",
  running: "실행 중",
  running_agent: "실행 중",
  pending: "대기",
  cancelled: "취소",
  unknown: "미확인",
  superseded: "대체됨",
};
const formatTime = (value, locale, t) => {
  const date = new Date(value);
  return value && !Number.isNaN(+date)
    ? date.toLocaleString(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : t("시간 미기록");
};
function Status({ value }) {
  const { t } = useI18n();
  return (
    <span className={`status ${value || "unknown"}`} title={value}>
      <span />
      {t(names[value] || value || "미확인")}
    </span>
  );
}
function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
function Facts({ rows }) {
  const { t } = useI18n();
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || t("미설정")}</dd>
        </div>
      ))}
    </dl>
  );
}

function App({ onModeChange, modeBusy }) {
  const { t, locale, errorText } = useI18n();
  const time = value => formatTime(value, locale, t);
  const [view, setView] = useState("chat");
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [sessions, dispatchSession] = useReducer(sessionReducer, null, () => initialSessions(crypto.randomUUID()));
  const { messages, draft } = sessions.items.find(item => item.id === sessions.selected);
  const selectedId = useRef(sessions.selected);
  selectedId.current = sessions.selected;
  const setMessages = value => dispatchSession({ type: "messages", id: selectedId.current, value });
  const setDraft = value => dispatchSession({ type: "draft", id: selectedId.current, value });
  const [showContext, setShowContext] = useState(false);
  const [deleteSession, setDeleteSession] = useState(null);
  const deleteDialog = useRef(null);
  const profileIdentity = useRef(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const activeTurn = useRef(null);
  const detailRequest = useRef(0);
  const dialog = useRef(null);
  const transcript = useRef(null);
  const follow = useRef(true);
  const input = useRef(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await api.snapshot();
      const identity = `${result.profile?.central_profile_id || ""}:${result.profile?.runner || ""}`;
      if (profileIdentity.current !== null && profileIdentity.current !== identity) {
        const turn = activeTurn.current;
        activeTurn.current = null;
        if (turn) api.cancel(turn).catch(() => {});
        setBusy(false);
        dispatchSession({ type: "reset", id: crypto.randomUUID() });
      }
      profileIdentity.current = identity;
      setSnapshot(result);
      if (result.registration_required) setView("setup");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  async function checkConnection() {
    setChecking(true);
    try {
      setConnection(await api.connection());
    } catch (e) {
      setConnection({
        transport: "error",
        status: "unknown",
        error: e.message,
      });
    } finally {
      setChecking(false);
    }
  }
  async function inspectInstall() {
    setInspecting(true);
    setInspectError("");
    try { setReadiness(await api.readiness()); }
    catch (e) { setInspectError(e.message); }
    finally { setInspecting(false); }
  }
  useEffect(() => {
    refresh();
    checkConnection();
    inspectInstall();
    const off = api.onChat((event) => {
      if (event.turn_id !== activeTurn.current) return;
      setMessages((rows) =>
        rows.map((row) =>
          row.id !== event.turn_id
            ? row
            : {
                ...row,
                content: event.text ?? row.content,
                state:
                  event.status === "finished" ? event.outcome : event.status,
                elapsed: event.elapsed_seconds ?? row.elapsed,
              },
        ),
      );
      if (event.status === "finished") {
        activeTurn.current = null;
        setBusy(false);
      }
    });
    const disconnected = api.onDisconnect(() => {
      setError("로컬 연결이 끊겼습니다. 새로고침해 주세요.");
      if (activeTurn.current)
        setMessages((rows) =>
          rows.map((row) =>
            row.id === activeTurn.current
              ? {
                  ...row,
                  state: "backend_unavailable",
                  content: t("연결이 종료되어 답변을 완료하지 못했습니다."),
                }
              : row,
          ),
        );
      activeTurn.current = null;
      setBusy(false);
    });
    return () => {
      off();
      disconnected();
    };
  }, []);
  useEffect(() => {
    if (follow.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages]);

  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || !api.native || !snapshot?.chat.available) return;
    const id = crypto.randomUUID();
    const history = messages
      .filter((row) => row.role === "user" || row.state === "completed")
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));
    activeTurn.current = id;
    follow.current = true;
    setBusy(true);
    setDraft("");
    setError("");
    setMessages((rows) => [
      ...rows,
      { id: `user-${id}`, role: "user", content: text },
      { id, role: "assistant", content: "", state: "thinking", elapsed: 0 },
    ]);
    try {
      await api.chat({ turn_id: id, message: text, history });
    } catch (e) {
      if (activeTurn.current !== id) return;
      setMessages((rows) =>
        rows.map((row) =>
          row.id === id
            ? { ...row, content: e.message, state: "backend_unavailable" }
            : row,
        ),
      );
      activeTurn.current = null;
      setBusy(false);
    }
  }
  async function cancel() {
    try {
      await api.cancel(activeTurn.current);
    } catch (e) {
      setError(e.message);
    }
  }
  async function openTask(task) {
    const request = ++detailRequest.current;
    setDetail({ ...task, loading: true });
    setDetailError("");
    dialog.current.showModal();
    try {
      const result = await api.task(task.task_id);
      if (request === detailRequest.current) setDetail(result);
    } catch (e) {
      if (request === detailRequest.current) setDetailError(e.message);
    }
  }

  const profile = snapshot?.profile;
  const tasks = snapshot?.tasks || [];
  const visibleTasks = tasks.filter(
    (task) =>
      (filter === "all" || task.status === filter) &&
      `${task.task_id} ${task.runner_id} ${task.reason}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const connected = connection?.transport === "connected";
  const subtitle = {
    chat: t("로컬 에이전트"),
    history: t("이 PC의 실행 기록"),
    runtime: t("런타임 관측"),
    settings: t("연결된 프로파일"),
    setup: t("설치 및 시작 상태"),
  }[view];

  return (
    <div className={`app workspace-app ${view === "chat" ? "chat-view" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">
            <Workflow size={21} strokeWidth={1.7} />
          </span>
          <div>
            AEGIS<small>{snapshot?.host || "Agent Ops"}</small>
          </div>
        </div>
        <button
          className="new-chat"
          disabled={busy || sessions.items.length >= MAX_SESSIONS}
          title={sessions.items.length >= MAX_SESSIONS ? t("대화를 삭제한 후 새로 시작할 수 있습니다.") : t("새 대화")}
          onClick={() => {
            dispatchSession({ type: "create", id: crypto.randomUUID() });
            setView("chat");
          }}
        >
          <Plus size={17} />{t("새 대화")} </button>
        <nav aria-label={t("주 탐색")}>
          {navigation.map(([key, name, Icon]) => (
            <button
              key={key}
              className={view === key ? "active" : ""}
              onClick={() => setView(key)}
            >
              <Icon size={18} />
              <span>{t(name)}</span>
              {key === "history" && <small>{tasks.length}</small>}
            </button>
          ))}
        </nav>
        <section className="session-list" aria-label={t("대화 세션")}>
          <h2>{t("세션")} <span>{sessions.items.length}</span></h2>
          {sessions.items.map(session => <div className={`session-row ${session.id === sessions.selected && view === "chat" ? "selected" : ""}`} key={session.id}>
            <button className="session-select" disabled={busy} aria-current={session.id === sessions.selected && view === "chat" ? "page" : undefined}
              title={session.messages.length ? session.title : t("새 대화")} onClick={() => { dispatchSession({ type: "select", id: session.id }); setView("chat"); }}>
              <MessageSquare size={15} /><span>{session.messages.length ? session.title : t("새 대화")}</span>
            </button>
            <IconButton label={t("{0} 대화 삭제", [session.title])} disabled={busy} onClick={() => { setDeleteSession(session); deleteDialog.current.showModal(); }}><X size={13} /></IconButton>
          </div>)}
        </section>
        <div className="sidebar-bottom">
          {onModeChange && <IconButton label={t("개인용으로 전환")} disabled={busy || modeBusy} onClick={onModeChange}><Cpu size={18} /></IconButton>}
          <div className="avatar">
            {(profile?.team_id || "AEGIS").replace("team-", "T")}
          </div>
          <div>
            <strong>{profile?.name || t("프로파일 확인 중")}</strong>
              <small>{profile?.runner || (snapshot?.registration_required ? t("등록 대기") : t("연결 중"))}</small>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{t("워크스페이스")}</span>
            <ChevronRight size={14} />
            <strong>{t(navigation.find((row) => row[0] === view)[1])}</strong>
          </div>
          <div className="topbar-actions">
            <LanguageSelect />
            {view === "chat" && <IconButton label={t("컨텍스트 표시")} aria-pressed={showContext} onClick={() => setShowContext(value => !value)}><PanelRight size={17} /></IconButton>}
            <span
              className={`connection-badge ${connected ? "connected" : ""}`}
            >
              <span />
              {checking
                ? t("중앙 확인 중")
                : connected
                  ? t("중앙 연결됨")
                  : t("중앙 확인 필요")}
            </span>
            <IconButton
              label={t("기록 새로고침")}
              disabled={loading}
              onClick={refresh}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </IconButton>
          </div>
        </header>
        {error && (
          <div className="alert" role="alert">
            <CircleAlert size={17} />
            <span>{errorText(error)}</span>
            <IconButton label={t("오류 닫기")} onClick={() => setError("")}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        <div className="page-heading">
          <div>
            <span className="eyebrow">{subtitle}</span>
            <h1>{t(navigation.find((row) => row[0] === view)[1])}</h1>
          </div>
          <span className="mode-label">
            <LockKeyhole size={13} />
            {api.native ? t("읽기 전용 대화") : t("브라우저 조회 모드")}
          </span>
        </div>

        {view === "chat" && (
          <div className={`chat-layout ${showContext ? "with-context" : ""}`}>
            <section className={`conversation ${messages.length ? "has-messages" : "is-empty"}`} aria-label={t("에이전트 대화")}>
              <div className="conversation-bar">
                <div className="agent-mark">
                  <Cpu size={18} />
                </div>
                <div>
                  <strong>AEGIS Assistant</strong>
                  <span>
                    {snapshot?.model.engine || t("엔진 확인 중")}
                    <b>·</b>
                    {snapshot?.model.model || t("기본 모델")}
                  </span>
                </div>
                <span className="effort">
                  {snapshot?.model.effort || "default"}
                </span>
              </div>
              <div
                ref={transcript}
                className="transcript"
                aria-live="polite"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  follow.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 70;
                }}
              >
                {!messages.length && (
                  <div className="empty-chat">
                    <Workflow size={30} strokeWidth={1.4} className="workspace-logo" />
                    <h2>{t("지금 무엇을 확인할까요?")}</h2>
                  </div>
                )}
                {messages.map((message) => (
                  <article
                    className={`message ${message.role}`}
                    key={message.id}
                  >
                    <div className="message-label">
                      {message.role === "user" ? (
                        t("나")
                      ) : (
                        <>
                          <Shield size={14} />
                          AEGIS Assistant
                        </>
                      )}
                      {message.state === "completed" && <Check size={13} />}
                    </div>
                    <div className="message-content">
                      {message.content || (
                        <span className="thinking">
                          <LoaderCircle size={15} className="spin" /> {t("답변 생성 중 ·")} {message.elapsed || 0}{t("초")} </span>
                      )}
                    </div>
                    {message.state === "cancelled" && (
                      <small className="muted">{t("중단됨")}</small>
                    )}
                    {message.state === "backend_unavailable" && (
                      <small className="failure-note"> {t("답변을 완료하지 못했습니다.")} </small>
                    )}
                  </article>
                ))}
              </div>
              <form className="composer" onSubmit={send}>
                <textarea
                  ref={input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={5000}
                  rows={3}
                  aria-label={t("메시지")}
                  placeholder={t("AEGIS에게 메시지 보내기")}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      send(e);
                    }
                  }}
                />
                <div className="composer-bottom">
                  <span>
                    <LockKeyhole size={12} /> {t("도구 실행 차단")} </span>
                  <div>
                    <small>
                      {draft.length > 4500 ? `${draft.length}/5000` : ""}
                    </small>
                    {busy ? (
                      <IconButton
                        label={t("답변 중단")}
                        type="button"
                        onClick={cancel}
                      >
                        <Square size={17} />
                      </IconButton>
                    ) : (
                      <button
                        className="send"
                        type="submit"
                        title={t("메시지 전송")}
                        aria-label={t("메시지 전송")}
                        disabled={
                          !draft.trim() ||
                          !snapshot?.chat.available ||
                          !api.native
                        }
                      >
                        <ArrowUp size={19} />
                      </button>
                    )}
                  </div>
                </div>
              </form>
              <div className="composer-note">
                {!api.native
                  ? t("브라우저 조회 모드")
                  : snapshot?.chat.reason || ""}
              </div>
            </section>
            {showContext && <aside className="context-panel">
              <div className="context-heading">
                <span>{t("현재 컨텍스트")}</span>
                <FileText size={16} />
              </div>
              <Facts
                rows={[
                  ["PC", snapshot?.host],
                  [t("러너"), profile?.runner],
                  [t("팀"), profile?.team_id],
                ]}
              />
              <div className="context-heading spaced">
                <span>{t("최근 실행")}</span>
                <button
                  className="text-button"
                  onClick={() => setView("history")}
                > {t("전체 보기")} <ArrowRight size={13} />
                </button>
              </div>
              <div className="recent-tasks">
                {tasks.slice(0, 4).map((task) => (
                  <button
                    className="recent-task"
                    key={task.task_id}
                    onClick={() => openTask(task)}
                  >
                    <Status value={task.status} />
                    <strong title={task.task_id}>{task.task_id}</strong>
                    <small>
                      {task.runner_id || t("러너 미기록")}
                      <ChevronRight size={13} />
                    </small>
                  </button>
                ))}
                {!tasks.length && (
                  <p className="muted">
                    {loading
                      ? t("기록을 읽고 있습니다.")
                      : t("로컬 실행 기록이 없습니다.")}
                  </p>
                )}
              </div>
              <div className="context-footer">
                <Clock3 size={14} />
                <span> {t("관측 시각")} <br />
                  <strong>{time(snapshot?.observed_at)}</strong>
                </span>
              </div>
            </aside>}
          </div>
        )}

        {view === "history" && (
          <section className="content-page">
            <div className="toolbar">
              <label className="search">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("작업, 러너, 이유 검색")}
                  aria-label={t("실행 기록 검색")}
                />
              </label>
              <select
                aria-label={t("상태 필터")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">{t("전체 상태")}</option>
                {[...new Set(tasks.map((task) => task.status))]
                  .sort()
                  .map((status) => (
                    <option key={status} value={status}>
                      {t(names[status] || status)}
                    </option>
                  ))}
              </select>
              <span className="muted">{visibleTasks.length}{t("건")}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("작업")}</th>
                    <th>{t("러너")}</th>
                    <th>{t("상태")}</th>
                    <th>{t("기록 시각")}</th>
                    <th>
                      <span className="sr-only">{t("상세")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTasks.map((task) => (
                    <tr key={task.task_id}>
                      <td>
                        <button
                          className="task-link"
                          onClick={() => openTask(task)}
                        >
                          {task.task_id}
                        </button>
                        <span className="mobile-runner">{task.runner_id || t("러너 미기록")}</span>
                        {task.reason && (
                          <span className="reason-preview" title={task.reason}>
                            {task.reason}
                          </span>
                        )}
                      </td>
                      <td className="runner-cell">
                        {task.runner_id || t("미기록")}
                      </td>
                      <td>
                        <Status value={task.status} />
                      </td>
                      <td className="date-cell">{time(task.updated_at)}</td>
                      <td>
                        <IconButton
                          label={t("{0} 상세", [task.task_id])}
                          onClick={() => openTask(task)}
                        >
                          <ChevronRight size={16} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleTasks.length && (
                <div className="empty-state">
                  <Search size={24} />
                  <p>
                    {loading
                      ? t("기록을 읽는 중입니다.")
                      : t("일치하는 실행 기록이 없습니다.")}
                  </p>
                </div>
              )}
            </div>
            <footer className="table-footer"> {t("최근 로컬 기록")} {tasks.length}{t("건")} <span>{t("기준: runs/<task>/status.json")}</span>
            </footer>
            {Boolean(snapshot?.warnings.length) && (
              <p className="failure-note"> {t("읽지 못한 기록")} {snapshot.warnings.length}{t("건")} </p>
            )}
          </section>
        )}

        {view === "runtime" && (
          <section className="content-page settings-page">
            <div className="section-header">
              <div>
                <h2>{t("중앙 연결")}</h2>
                <span className="muted">
                  {connection?.authority || "runner.heartbeat.list"}
                </span>
              </div>
              <button
                className="outline-button"
                disabled={checking}
                onClick={checkConnection}
              >
                <RefreshCw size={15} className={checking ? "spin" : ""} /> {t("다시 확인")} </button>
            </div>
            <Facts
              rows={[
                [
                  t("통신 상태"),
                  checking ? t("확인 중") : connected ? t("연결됨") : t("확인 실패"),
                ],
                [t("러너 상태"), connection?.status || "unknown"],
                [
                  t("Heartbeat 경과"),
                  connection?.heartbeat_age_minutes != null
                    ? t("{0}분", [connection.heartbeat_age_minutes])
                    : t("측정값 없음"),
                ],
                [t("마지막 heartbeat"), time(connection?.last_seen_at)],
                [t("관측 시각"), time(connection?.observed_at)],
              ]}
            />
            {connection?.error && (
              <div className="connection-error">
                <CircleAlert size={18} />
                <p>{connection.error}</p>
              </div>
            )}
            <div className="section-header spaced">
              <h2>{t("로컬 연결")}</h2>
              <span className="status completed">
                <span />
                {snapshot ? t("프로파일 읽기 완료") : t("미확인")}
              </span>
            </div>
            <Facts
              rows={[
                ["PC", snapshot?.host],
                [t("작업 경로"), profile?.workspace],
                [
                  t("인증 정보"),
                  profile?.credential_configured ? t("설정됨") : t("미설정"),
                ],
                [t("서비스 제어"), t("기존 supervisor에서 관리")],
                [t("앱 버전"), snapshot?.version],
              ]}
            />
          </section>
        )}

        {view === "setup" && <section className="content-page settings-page">
          <SetupPanel profile={profile} onChanged={() => { refresh(); inspectInstall(); checkConnection(); }} />
          <div className="section-header"><div><h2>{t("시작 전 점검")}</h2><span className="muted">{readiness?.release.bundled ? t("앱 · Python 코어 동봉") : t("개발 소스 연결")}</span></div>
            <button className="outline-button" disabled={inspecting} onClick={inspectInstall}><RefreshCw size={15} className={inspecting ? "spin" : ""} />{t("다시 점검")}</button></div>
          {inspectError && <div className="connection-error" role="alert"><CircleAlert size={18} /><p>{errorText(inspectError)}</p></div>}
          {!readiness && inspecting && <p className="thinking setup-loading"><LoaderCircle size={16} className="spin" />{t("설치 상태를 확인하고 있습니다.")}</p>}
          <div className="readiness-list">{readiness?.checks.map(check => <div className="readiness-row" key={check.id}>
            <span className={`check-icon ${check.state}`}>{check.state === "ready" ? <Check size={18} /> : <CircleAlert size={18} />}</span>
            <div><h3>{t(check.label)}</h3><p>{t(check.detail)}</p><small>{t(check.source)}</small></div><span className={`readiness-state ${check.state}`}>{check.state === "ready" ? t("확인됨") : check.state === "unknown" ? t("미확인") : t("확인 필요")}</span>
          </div>)}</div>
          <div className="section-header spaced"><div><h2>{t("기존 백그라운드 프로세스")}</h2><span className="muted">{t("Win32_Process · 기존 supervisor 관리")}</span></div><LockKeyhole size={16} /></div>
          {readiness?.process_observation.status === "observed" ? <Facts rows={[
            ["Supervisor", t("{0}개 감지", [readiness.process_observation.processes.filter(p => p.component === "start_btk_supervisor.ps1").length])],
            [t("A2A 응답기"), t("{0}개 감지", [readiness.process_observation.processes.filter(p => p.component === "a2a_chat_responder.py").length])],
            [t("작업 실행기"), t("{0}개 감지", [readiness.process_observation.processes.filter(p => p.component === "run_agent_executor_loop.py").length])],
            [t("서비스 관리"), t("검증된 Supervisor · 앱 실행기 관리")], [t("관측 시각"), time(readiness.process_observation.observed_at || readiness.observed_at)]
          ]} /> : <p className="muted setup-loading">{readiness?.process_observation.reason || t("관측 중")}</p>}
          <div className="section-header spaced"><h2>{t("릴리스")}</h2><PackageCheck size={18} /></div>
          <Facts rows={[[t("앱 · 코어 버전"), readiness?.release.version], [t("빌드"), readiness?.release.build_id], [t("배포 채널"), readiness?.release.channel], [t("코어 통신"), readiness ? `stdio / v${readiness.release.protocol_version}` : t("확인 중")]]} />
        </section>}
        {view === "settings" && (
          <section className="content-page settings-page">
            <div className="section-header">
              <h2>{t("현재 프로파일")}</h2>
              <span className="mode-label">
                <LockKeyhole size={13} /> {t("조회 전용")} </span>
            </div>
            <Facts
              rows={[
                [t("프로파일"), profile?.name],
                [t("러너"), profile?.runner],
                [t("팀"), profile?.team_id],
                [t("작업 경로"), profile?.workspace],
              ]}
            />
            <div className="section-header spaced">
              <h2>{t("대화 모델")}</h2>
              <Cpu size={18} />
            </div>
            <Facts
              rows={[
                [t("엔진"), snapshot?.model.engine],
                [t("모델"), snapshot?.model.model || t("엔진 기본값")],
                [t("추론 강도"), snapshot?.model.effort || t("엔진 기본값")],
                [t("설정 출처"), t(snapshot?.model.source)],
                [t("도구 권한"), t("비활성화")],
                [t("MCP 도구"), t("비활성화")],
              ]}
            />
            {snapshot?.chat.reason && (
              <div className="connection-error">
                <CircleAlert size={18} />
                <p>{t(snapshot.chat.reason)}</p>
              </div>
            )}
          </section>
        )}
      </div>

      <dialog ref={deleteDialog} className="task-dialog session-dialog" aria-labelledby="delete-session-heading">
        <div className="dialog-header"><h2 id="delete-session-heading">{t("대화를 삭제할까요?")}</h2></div>
        <div className="dialog-body">
          <p>{deleteSession?.title}</p>
          <div className="session-dialog-actions">
            <button className="outline-button" onClick={() => deleteDialog.current.close()}>{t("취소")}</button>
            <button className="outline-button" disabled={busy} onClick={() => {
              dispatchSession({ type: "remove", id: deleteSession?.id, replacementId: crypto.randomUUID() });
              deleteDialog.current.close(); setDeleteSession(null);
            }}>{t("삭제")}</button>
          </div>
        </div>
      </dialog>
      <dialog
        ref={dialog}
        className="task-dialog"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="dialog-header">
          <div>
            <span className="eyebrow">{t("실행 상세")}</span>
            <h2>{detail?.task_id}</h2>
          </div>
          <IconButton label={t("상세 닫기")} onClick={() => dialog.current.close()}>
            <X size={20} />
          </IconButton>
        </div>
        {detailError ? (
          <p role="alert" className="connection-error">
            {errorText(detailError)}
          </p>
        ) : (
          <div className="dialog-body">
            <Status value={detail?.status} />
            <Facts
              rows={[
                [t("러너"), detail?.runner_id],
                [t("상태 기준"), detail?.authority],
                [t("기록 시각"), time(detail?.updated_at)],
              ]}
            />
            {detail?.reason && (
              <section>
                <h3>{t("중단 또는 결과 사유")}</h3>
                <pre>{detail.reason}</pre>
              </section>
            )}
            {detail?.next_action && (
              <section>
                <h3>{t("다음 조치")}</h3>
                <pre>{detail.next_action}</pre>
              </section>
            )}
            {detail?.loading ? (
              <p className="thinking">
                <LoaderCircle size={16} className="spin" /> {t("기록을 읽는 중입니다.")} </p>
            ) : (
              detail?.artifacts?.map((artifact) => (
                <details key={artifact.name}>
                  <summary>
                    <FileText size={15} />
                    {artifact.name}
                    {artifact.truncated && <small>{t("일부 표시")}</small>}
                  </summary>
                  <pre>{artifact.content}</pre>
                </details>
              ))
            )}
          </div>
        )}
      </dialog>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<LanguageProvider><EditionRoot Enterprise={App} /></LanguageProvider>);
