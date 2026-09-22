import React, { useEffect, useState } from 'react';
import { Check, FileKey, LogIn, Save, Square, Trash2 } from 'lucide-react';
import { useI18n } from './Language';

export default function GoogleSettings({ state, busy, run, onSaved }) {
  const { t, errorText } = useI18n();
  const api = window.btk.personal.google;
  const [data, setData] = useState(null);
  const [id, setId] = useState(state.accountId || '');
  const [name, setName] = useState('Gemini');
  const [model, setModel] = useState(state.model || '');
  const [maxTokens, setMaxTokens] = useState(state.maxTokens || 1024);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const account = data?.accounts.find(a => a.id === id);
  const locked = busy || Boolean(data?.loginId);
  useEffect(() => {
    let live = true;
    api.state(state.agentId).then(value => { if (live) setData(value); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [state.agentId]);
  useEffect(() => {
    if (!data?.loginId) return;
    let live = true, timer;
    const poll = async () => {
      try {
        const next = await api.state(state.agentId);
        if (!live) return;
        setData(next); setError(next.error);
        if (next.loginId) timer = setTimeout(poll, 1500);
      } catch (e) { if (live) { setError(e.message); setData(old => ({ ...old, loginId: null })); } }
    };
    timer = setTimeout(poll, 1500);
    return () => { live = false; clearTimeout(timer); };
  }, [data?.loginId, state.agentId]);
  return <section className="personal-settings google-settings">
    <h1>{t('Gemini 로그인 연결')}</h1>
    <p>{t('Google Cloud API · 프로젝트 사용량 과금')}</p>
    {error && <p role="alert">{errorText(error)}</p>}
    <label>{t('연결 계정')}<select aria-label={t('연결 계정')} value={id} disabled={locked || !data} onChange={e => { setId(e.target.value); setNotice(''); }}>
      <option value="">{t('계정 선택')}</option>
      {data?.accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.project} · {t(a.connected ? '연결됨' : '로그인 필요')}</option>)}
    </select></label>
    {account && <>
      <p role="status">{t(data.loginId === id ? '브라우저 로그인 대기 중' : account.connected ? '연결됨' : '로그인 필요')}</p>
      <p>{t('연결된 에이전트')}: {account.agents.map(a => a.name).join(', ') || t('없음')}</p>
      <div className="personal-actions">
        <button type="button" className="outline-button" disabled={locked} onClick={() => run(async () => { setError(''); setData(await api.login(state.agentId, id)); })}><LogIn size={16} />{t('Google로 로그인')}</button>
        <button type="button" className="icon-button" title={t('연결 계정 삭제')} aria-label={t('연결 계정 삭제')} disabled={locked} onClick={() => run(async () => {
          const next = await api.remove(state.agentId, id); setData(next); onSaved(await window.btk.personal.state());
          if (!next.accounts.some(a => a.id === id)) setId('');
        })}><Trash2 size={16} /></button>
      </div>
    </>}
    {data?.loginId && <button type="button" className="outline-button" disabled={busy} onClick={() => run(async () => setData(await api.cancelLogin(state.agentId)))}><Square size={16} />{t('로그인 취소')}</button>}
    <form onSubmit={event => { event.preventDefault(); run(async () => {
      const next = await api.import(state.agentId, name); setData(next);
      const added = next.accounts.find(a => !data?.accounts.some(old => old.id === a.id)); if (added) setId(added.id);
    }); }}>
      <fieldset disabled={locked || !data}>
        <label>{t('새 연결 이름')}<input required maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
        <button type="submit" className="outline-button" disabled={!name.trim()}><FileKey size={16} />{t('OAuth 클라이언트 가져오기')}</button>
      </fieldset>
    </form>
    <form onSubmit={event => { event.preventDefault(); run(async () => { onSaved(await api.model(state.agentId, { accountId: id, model, maxTokens })); setData(await api.state(state.agentId)); setNotice('설정 저장됨 · 연결 미검증'); }); }}>
      <fieldset disabled={locked || !account?.connected}>
        <label>{t('Gemini 모델 ID')}<input required maxLength={190} pattern="gemini-[A-Za-z0-9._\-]+" value={model} onChange={e => { setModel(e.target.value); setNotice(''); }} /></label>
        <label>{t('최대 출력 토큰')}<input type="number" required min={64} max={16384} value={maxTokens} onChange={e => { setMaxTokens(Number(e.target.value)); setNotice(''); }} /></label>
        <div className="personal-actions">
          <button className="outline-button"><Save size={16} />{t('모델 저장')}</button>
          <button type="button" className="outline-button" disabled={!state.model || model !== state.model || id !== state.accountId || maxTokens !== state.maxTokens} onClick={() => run(async () => { await window.btk.personal.test(); setNotice('대화 연결 확인'); })}><Check size={16} />{t('연결 시험')}</button>
        </div>
      </fieldset>
    </form>
    {notice && <p role="status">{t(notice)}</p>}
  </section>;
}
