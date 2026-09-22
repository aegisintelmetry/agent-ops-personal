import { useI18n } from "./Language";
import React, { useEffect, useState } from "react";
import { Check, Gauge, LogIn, LogOut, RefreshCw, Save, Square } from "lucide-react";

export default function CodexSettings({ state, busy, run, onSaved }) {
  const { t, locale, errorText } = useI18n();
  const [account, setAccount] = useState(null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(state.model || "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [limits, setLimits] = useState(null);
  const api = window.btk.personal.codex;
  async function refresh() {
    const next = await api.state(); setAccount(next); setError(next.error || "");
    if (next.connected) setModels(await api.models()); else { setModels([]); setLimits(null); }
  }
  useEffect(() => { let live = true;
    api.state().then(next => { if (live) setAccount(next); return next.connected ? api.models() : []; })
      .then(list => { if (live) setModels(list); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!account?.pending) return;
    let live = true;
    let timer;
    const poll = async () => {
      try {
        const next = await api.state();
        if (!live) return;
        setAccount(next); setError(next.error || "");
        if (next.connected) setModels(await api.models());
        if (live && next.pending) timer = setTimeout(poll, 2000);
      } catch (e) { if (live) { setError(e.message); setAccount(old => ({ ...old, pending: false })); } }
    };
    timer = setTimeout(poll, 2000);
    return () => { live = false; clearTimeout(timer); };
  }, [account?.pending]);
  return <section className="personal-settings codex-settings">
    <h1>{t("ChatGPT 연결")}</h1>
    <p role="status">{!account ? t("연결 상태 확인 중") : account.pending ? t("브라우저 로그인 대기 중") : account.connected ? t("연결됨 · {0}", [account.plan || "ChatGPT"]) : t("로그인 필요")}</p>
    {error && <p role="alert">{errorText(error)}</p>}
    <div className="personal-actions">
      <button className="outline-button" disabled={busy || !account || account.pending || account.connected} onClick={() => run(async () => { setError(""); await api.login(); setAccount({ connected: false, pending: true }); })}><LogIn size={16} />{t("ChatGPT로 로그인")}</button>
      {account?.pending && <button className="outline-button" disabled={busy} onClick={() => run(async () => { await api.cancelLogin(); await refresh(); })}><Square size={16} />{t("로그인 취소")}</button>}
      <button className="icon-button" title={t("계정 상태 새로고침")} aria-label={t("계정 상태 새로고침")} disabled={busy} onClick={() => run(refresh)}><RefreshCw size={16} /></button>
      {account?.connected && <button className="outline-button" disabled={busy} onClick={() => run(async () => { await api.logout(); await refresh(); onSaved(await window.btk.personal.state()); })}><LogOut size={16} />{t("로그아웃")}</button>}
      {account?.connected && <button className="outline-button" disabled={busy} onClick={() => run(async () => setLimits(await api.limits()))}><Gauge size={16} />{t("사용 한도")}</button>}
    </div>
    {limits && <div className="personal-notice" role="status">{limits.length ? limits.map(item => <p key={item.name}>{item.windowMinutes != null ? t("{0}분 한도", [item.windowMinutes]) : t("사용 한도")} · {item.usedPercent}{t("% 사용")}{item.resetsAt ? t(" · 초기화 {0}", [new Date(item.resetsAt * 1000).toLocaleString(locale)]) : ""}</p>) : t("사용 한도 정보 미제공")}</div>}
    <form onSubmit={event => { event.preventDefault(); run(async () => { onSaved(await api.model(model)); setNotice("Codex 모델 저장됨"); }); }}>
      <fieldset disabled={busy || !account?.connected}>
        <label>{t("Codex 모델")}<select aria-label={t("Codex 모델")} required value={model} onChange={event => { setModel(event.target.value); setNotice(""); }}><option value="">{t("모델 선택")}</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="personal-actions"><button className="outline-button" disabled={!model || !models.some(item => item.id === model)}><Save size={16} />{t("모델 저장")}</button>
          <button type="button" className="outline-button" disabled={!state.model || state.model !== model} onClick={() => run(async () => { await window.btk.personal.test(); setNotice("대화 연결 확인"); })}><Check size={16} />{t("연결 시험")}</button></div>
      </fieldset>
    </form>
    {notice && <p role="status">{t(notice)}</p>}
  </section>;
}
