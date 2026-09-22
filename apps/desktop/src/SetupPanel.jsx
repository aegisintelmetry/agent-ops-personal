import { useI18n } from "./Language";
import React, { useEffect, useState } from "react";
import { Check, CircleAlert, Download, Link2, LoaderCircle, LockKeyhole, Play, RefreshCw } from "lucide-react";
import { api } from "./api";

const labels = { idle: "설치 대기", running: "설치 중", completed: "완료", partial: "검증 미완료", failed: "실패", pending: "대기", skipped: "미요청" };

export default function SetupPanel({ profile, onChanged }) {
  const { t, locale, errorText } = useI18n();
  const [central, setCentral] = useState(profile?.central_url || "");
  const [profileId, setProfileId] = useState(profile?.central_profile_id || "");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(null);
  const [job, setJob] = useState({ status: "idle", steps: [] });
  const [start, setStart] = useState(true);
  const [autostart, setAutostart] = useState(false);
  const [agent, setAgent] = useState({ status: "unknown" });
  const busy = pending || job.status === "running";
  const agentLabels = { running: t("실행 중"), starting: t("시작 중"), stopped: t("중지됨"), failed: t("실패"), unknown: t("미확인"), unavailable: t("조회 불가"), other_profile: t("다른 프로파일 실행 중") };

  useEffect(() => {
    let active = true, timer;
    const read = async () => {
      clearTimeout(timer);
      if (!active || document.hidden) return;
      try { const state = await api.agentStatus(); if (active) setAgent(state); }
      catch { if (active) setAgent({ status: "unknown" }); }
      if (active) timer = setTimeout(read, 5000);
    };
    const visibility = () => { if (document.hidden) clearTimeout(timer); else void read(); };
    void read();
    document.addEventListener("visibilitychange", visibility);
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  async function startAgent() {
    setPending(true); setError("");
    try { await api.startAgent(); setAgent(await api.agentStatus()); onChanged(); }
    catch (e) { setError(e.message); }
    finally { setPending(false); }
  }

  useEffect(() => {
    let active = true;
    api.setupStatus().then(data => { if (active) setJob(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (job.status !== "running") return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const data = await api.setupStatus();
        if (!active) return;
        setJob(data);
        if (data.status !== "running") onChanged();
      } catch (e) { if (active) setError(e.message); }
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [job.status]);
  useEffect(() => {
    if (profile?.central_url) setCentral(profile.central_url);
    if (profile?.central_profile_id) setProfileId(profile.central_profile_id);
  }, [profile?.central_url, profile?.central_profile_id]);

  async function connect(event) {
    event.preventDefault();
    setPending(true); setError("");
    try {
      const result = await api.enroll({ central_url: central, profile_id: profileId, bootstrap_token: code });
      setRegistered(result);
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setCode(""); setPending(false); }
  }
  async function install() {
    setPending(true); setError("");
    try { setJob(await api.install({ start_services: start, autostart })); }
    catch (e) { setError(e.message); }
    finally { setPending(false); }
  }
  return <div className="setup-flow">
    <div className="agent-runtime-row">
      <div><h2>{t("백그라운드 에이전트")}</h2><span>{agentLabels[agent.status] || t("미확인")}{agent.owner_pid ? ` · PID ${agent.owner_pid}` : ""}</span></div>
      <div className="agent-runtime-actions">
        <button type="button" className="icon-button" title={t("실행 상태 새로고침")} aria-label={t("실행 상태 새로고침")} onClick={async () => { try { setAgent(await api.agentStatus()); } catch { setAgent({ status: "unknown" }); } }}><RefreshCw size={16} /></button>
        <button type="button" className="secondary-button" onClick={startAgent} disabled={!api.native || busy || agent.status !== "stopped" || !profile?.central_profile_id}><Play size={16} />{t("에이전트 시작")}</button>
      </div>
    </div>
    {agent.error && <p className="setup-error" role="alert"><CircleAlert size={16} />{errorText(agent.error)}</p>}
    <div className="section-header"><h2>{t("PC 연결 및 서비스 설치")}</h2>{!api.native && <span className="muted"><LockKeyhole size={14} /> {t("조회 전용")}</span>}</div>
    <form className="enroll-form" onSubmit={connect}>
      <label>{t("중앙 서버")}<input type="url" required value={central} disabled={!api.native || busy} onChange={e => setCentral(e.target.value)} placeholder="https://" /></label>
      <label>{t("프로파일 ID")}<input required maxLength={160} value={profileId} disabled={!api.native || busy} onChange={e => setProfileId(e.target.value)} /></label>
      <label>{t("일회용 등록 코드")}<input type="password" autoComplete="off" maxLength={512} value={code} disabled={!api.native || busy} onChange={e => setCode(e.target.value)} /></label>
      <button className="secondary-button" disabled={!api.native || busy}><Link2 size={16} />{t("프로파일 연결")}</button>
    </form>
    {registered && <p className="setup-feedback"><Check size={16} />{registered.runner} {t("연결됨 ·")} {registered.engine}</p>}
    <div className="setup-install-actions">
      <label><input type="checkbox" checked={start} onChange={e => setStart(e.target.checked)} disabled={!api.native || busy} />{t("설치 후 서비스 시작")}</label>
      <label><input type="checkbox" checked={autostart} onChange={e => setAutostart(e.target.checked)} disabled={!api.native || busy} />{t("Windows 로그인 시 자동시작")}</label>
      <button className="secondary-button" onClick={install} disabled={!api.native || busy || !(registered || profile?.central_profile_id)}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{t("서비스 설치")} </button>
    </div>
    {(error || job.error) && <p role="alert" className="setup-error"><CircleAlert size={16} />{errorText(error || job.error)}</p>}
    {job.steps.length > 0 && <div aria-live="polite" className="setup-progress">
      <h3>{t(labels[job.status])}</h3>
      {job.deployment && <p>{t("중앙 배포")} <code>{job.deployment.deploy_id}</code> · {job.central_reporting === "connected" ? t("연결됨") : t("보고 실패")}</p>}
      {job.report_error && <p role="alert" className="setup-error">{errorText(job.report_error)}</p>}
      <ol>{job.steps.map(step => <li key={step.id}>
        <span>{t(step.label)}</span><span className={`readiness-state ${step.status}`}>
          {step.status === "running" ? <LoaderCircle size={14} className="spin" /> : step.status === "completed" ? <Check size={14} /> : null}
          {t(labels[step.status])}</span>
      </li>)}</ol>
      {job.activation && <p>{t("실행기")} {["started", "already_running"].includes(job.activation.status) ? t("시작됨") : t("시작 안 함")} {t("· 자동시작")} {job.startup?.status === "registered" ? t("등록됨") : t("등록 안 함")} {t("· 중앙 heartbeat")} {job.heartbeat_age_minutes == null ? t("미확인") : t("{0} / {1}분 전", [job.heartbeat_status, job.heartbeat_age_minutes])}</p>}
    </div>}
  </div>;
}
