import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, RefreshCw, RotateCw, X } from 'lucide-react';
import { useI18n } from './Language';

export default function UpdateControl() {
  const { t, errorText } = useI18n();
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!window.btk?.updates) return;
    let alive = true;
    const accept = value => { if (alive) setState(value); };
    const off = window.btk.updates.subscribe(accept);
    window.btk.updates.state().then(accept).catch(() => {});
    return () => { alive = false; off(); };
  }, []);
  if (!state) return null;
  const labels = { idle: '업데이트 확인', checking: '업데이트 확인 중', current: '최신 버전입니다.', available: '새 버전 사용 가능', downloading: '업데이트 다운로드 중', ready: '업데이트 설치 준비 완료', error: '업데이트 실패. 네트워크를 확인하고 다시 시도해 주세요.', unavailable: '설치된 Windows 앱에서 업데이트할 수 있습니다.' };
  const action = state.status === 'available' ? 'download' : state.status === 'ready' ? 'install' : 'check';
  const label = action === 'download' ? '다운로드' : action === 'install' ? '재시작 및 설치' : '업데이트 확인';
  async function run() {
    setBusy(true); setError('');
    try { setState(await window.btk.updates[action]()); }
    catch (e) { setError(errorText(e.message)); }
    finally { setBusy(false); }
  }
  return <>
    <button className="outline-button" onClick={() => setOpen(true)} title={t(labels[state.status])}><RefreshCw size={16} />{t(['available', 'ready'].includes(state.status) ? '업데이트 가능' : '앱 업데이트')}</button>
    {open && createPortal(<dialog className="update-dialog" ref={node => { if (node && !node.open) node.showModal(); }} onCancel={() => setOpen(false)} aria-label={t('앱 업데이트')}>
      <header><h2>{t('앱 업데이트')}</h2><button autoFocus className="icon-button" onClick={() => setOpen(false)} title={t('닫기')} aria-label={t('닫기')}><X size={18} /></button></header>
      <p>AEGIS Agent Ops {state.currentVersion}{state.version ? ` → ${state.version}` : ''}</p>
      <p role="status">{t(labels[state.status])}</p>
      {state.status === 'downloading' && <progress max="100" value={state.percent} aria-label={t('업데이트 다운로드 중')} />}
      {error && <p role="alert">{error}</p>}
      <button className="outline-button" disabled={busy || ['checking', 'downloading', 'unavailable'].includes(state.status)} onClick={run}>{action === 'download' ? <Download size={16} /> : <RotateCw size={16} />}{t(label)}</button>
    </dialog>, document.body)}
  </>;
}
