import { useI18n } from "./Language";
import React, { useState } from "react";
import tools from "../electron/slack-tools.json";
import { Check, Hash, KeyRound, LoaderCircle, RefreshCw, Save, Square, Trash2 } from "lucide-react";

const sampleChannels = [{ id: "sample-general", name: "general", member: true }, { id: "sample-project", name: "project-ops", member: false }];
export default function SlackPanel({ state, onState, busy, run }) {
  const { t, locale } = useI18n();
  const [token, setToken] = useState("");
  const [sample, setSample] = useState(false);
  const [channels, setChannels] = useState([]);
  const [cursor, setCursor] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const api = window.btk.personal.slack;
  const available = state?.tokenConfigured && state?.enabled;
  async function action(work, clear = false) {
    setPending(true);
    if (clear) { setChannels([]); setCursor(""); setLoaded(false); }
    await run(async () => {
      try { await work(); }
      finally { onState(await api.state()); }
    });
    setPending(false);
  }
  async function load(next = "") {
    await action(async () => {
      const result = await api.channels(next);
      setChannels(old => next ? [...new Map([...old, ...result.channels].map(item => [item.id, item])).values()] : result.channels);
      setCursor(result.nextCursor); setLoaded(true); onState(result.connector);
    }, !next);
  }
  return <section className="personal-settings connector-page">
    <header className="connector-heading"><div><h1>{t("커넥터")}</h1><div className="connector-name"><Hash size={23} /><h2>Slack</h2><span>{t("읽기 전용 · Web API")}</span></div></div>
      <label className="connector-sample"><input type="checkbox" checked={sample} onChange={e => setSample(e.target.checked)} disabled={busy} />{t("샘플 보기")}</label>
    </header>
    {sample ? <div className="connector-sample-state" role="status">{t("샘플 데이터 · 실제 Slack 연결 아님")}</div> : <>
      <div className="connector-state"><span>{!state ? t("상태 확인 중") : !state.tokenConfigured ? t("미연결") : !state.enabled ? t("비활성") : state.authenticated ? t("인증 확인됨") : t("토큰 저장됨 · 미검증")}</span>
        {state?.checkedAt && <small>{state.team} · {new Date(state.checkedAt).toLocaleString(locale)}</small>}
      </div>
      <form onSubmit={event => { event.preventDefault(); const value = token; setToken(""); action(async () => onState(await api.save(value)), true); }}>
        <fieldset disabled={busy || !api}>
          <label>{t("Slack Bot 토큰")}<input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="new-password" maxLength={4005} spellCheck={false} placeholder="xoxb-…" required /></label>
          <div className="personal-actions"><button className="outline-button" type="submit" disabled={!token}><Save size={16} />{t("토큰 저장")}</button>
            <button type="button" className="outline-button" disabled={!available} onClick={() => action(async () => onState(await api.test()), true)}><Check size={16} />{t("Slack 연결 확인")}</button>
            <button type="button" className="icon-button" title={t("Slack 토큰 삭제")} aria-label={t("Slack 토큰 삭제")} disabled={!state?.tokenConfigured} onClick={() => { setToken(""); action(async () => onState(await api.remove()), true); }}><Trash2 size={16} /></button>
          </div>
          <label className="connector-toggle"><input type="checkbox" checked={state?.enabled || false} disabled={!state?.tokenConfigured} onChange={e => action(async () => onState(await api.enable(e.target.checked)), true)} />{t("Slack 사용")}</label>
        </fieldset>
      </form>
    </>}
    <section className="connector-tools" aria-label={t("Slack 도구")}>
      <h2>{t("도구")}</h2>{tools.map(tool => <div key={tool.id}><Check size={17} /><strong>{t(tool.name)}</strong><code>{tool.id}</code><span>{tool.scope || t("읽기")}</span></div>)}
      <p><KeyRound size={14} />{t("메시지 전송 비활성 · 모델 자동 호출 미연결")}</p>
    </section>
    <section className="connector-channels" aria-label={t("Slack 공개 채널")}>
      <header><h2>{t("공개 채널")} {sample ? 2 : channels.length}</h2>
        {!sample && <button className="icon-button" aria-label={t("Slack 채널 새로고침")} title={t("공개 채널 조회")} disabled={busy || !available} onClick={() => load()}><RefreshCw size={17} /></button>}
      </header>
      {(sample ? sampleChannels : channels).map(channel => <div className="connector-channel" key={channel.id}><Hash size={16} /><span>{channel.name}</span><small>{channel.member ? t("참여 중") : t("공개")}</small></div>)}
      {!sample && !channels.length && <p className="summary-empty">{loaded ? t("조회된 공개 채널 없음") : t("아직 조회하지 않음")}</p>}
      {!sample && state?.channelStatus === "failed" && <p className="summary-warning">{t("최근 조회 실패")}</p>}
      {!sample && cursor && <button className="outline-button" disabled={busy || channels.length >= 500} onClick={() => load(cursor)}>{t("다음 페이지")}</button>}
      {!sample && state?.channelsCheckedAt && <small>{t("최근 성공 조회")} {new Date(state.channelsCheckedAt).toLocaleString(locale)}</small>}
    </section>
    {pending && <div className="connector-pending" role="status"><LoaderCircle className="spin" size={16} />{t("Slack 요청 중")}<button className="icon-button" aria-label={t("Slack 요청 취소")} title={t("요청 취소")} onClick={() => api.cancel()}><Square size={15} /></button></div>}
  </section>;
}
