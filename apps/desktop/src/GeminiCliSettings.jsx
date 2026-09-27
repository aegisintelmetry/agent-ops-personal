import React, { useEffect, useState } from 'react';
import { Check, LogIn, LogOut, RefreshCw, Save, Square } from 'lucide-react';
import { useI18n } from './Language';

export default function GeminiCliSettings({ state, busy, run, onSaved }) {
  const { t, errorText } = useI18n();
  const api = window.btk.personal.gemini;
  const [account, setAccount] = useState(null);
  const [model, setModel] = useState(state.model || 'auto');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function refresh() {
    const next = await api.state(state.agentId); setAccount(next); setError(next.error || '');
    onSaved(await window.btk.personal.state());
  }
  useEffect(() => {
    let live = true;
    api.state(state.agentId).then(next => { if (live) { setAccount(next); setError(next.error || ''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [state.agentId]);
  useEffect(() => {
    if (!account?.pending) return;
    let live = true, timer;
    const poll = async () => {
      try {
        const next = await api.state(state.agentId);
        if (!live) return;
        setAccount(next); setError(next.error || '');
        if (next.pending) timer = setTimeout(poll, 1500);
        else onSaved(await window.btk.personal.state());
      } catch (e) { if (live) { setError(e.message); timer = setTimeout(poll, 3000); } }
    };
    timer = setTimeout(poll, 1500);
    return () => { live = false; clearTimeout(timer); };
  }, [account?.pending, state.agentId]);
  return <section className="personal-settings google-settings">
    <h1>{t('Gemini 계정 연결')}</h1>
    <p>{t('Google 로그인 · Gemini CLI')}</p>
    <p role="status">{t(!account ? '연결 상태 확인 중' : account.pending ? '브라우저 로그인 대기 중' : account.connected ? '연결됨' : '로그인 필요')}</p>
    {error && <p role="alert">{errorText(error)}</p>}
    {account && !account.runtimeAvailable && <p role="alert">{t('Gemini CLI 런타임이 없습니다. 앱을 다시 설치해 주세요.')}</p>}
    <div className="personal-actions">
      <button className="outline-button" disabled={busy || !account?.runtimeAvailable || account.pending || account.connected} onClick={() => run(async () => { setError(''); setAccount(await api.login(state.agentId)); })}><LogIn size={16} />{t('Google로 로그인')}</button>
      {account?.pending && <button className="outline-button" disabled={busy} onClick={() => run(async () => { setAccount(await api.cancelLogin(state.agentId)); await refresh(); })}><Square size={16} />{t('로그인 취소')}</button>}
      <button className="icon-button" title={t('계정 상태 새로고침')} aria-label={t('계정 상태 새로고침')} disabled={busy} onClick={() => run(refresh)}><RefreshCw size={16} /></button>
      {account?.connected && !account.pending && <button className="outline-button" disabled={busy} onClick={() => run(async () => { setAccount(await api.logout(state.agentId)); onSaved(await window.btk.personal.state()); })}><LogOut size={16} />{t('로그아웃')}</button>}
    </div>
    <form onSubmit={event => { event.preventDefault(); run(async () => { onSaved(await api.model(state.agentId, model)); setNotice('설정 저장됨 · 연결 미검증'); }); }}>
      <fieldset disabled={busy || !account?.connected || account.pending}>
        <label>{t('Gemini 모델 ID')}<input required maxLength={190} pattern="(auto|gemini-[A-Za-z0-9._\-]+)" value={model} onChange={e => { setModel(e.target.value); setNotice(''); }} /></label>
        <div className="personal-actions">
          <button className="outline-button"><Save size={16} />{t('모델 저장')}</button>
          <button type="button" className="outline-button" disabled={model !== state.model} onClick={() => run(async () => { await window.btk.personal.test(); setNotice('대화 연결 확인'); })}><Check size={16} />{t('연결 시험')}</button>
        </div>
      </fieldset>
    </form>
    {notice && <p role="status">{t(notice)}</p>}
  </section>;
}
