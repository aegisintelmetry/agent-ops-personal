import React, { useEffect, useState } from 'react';
import { Save, Plus, Trash2, Pencil } from 'lucide-react';
import { useI18n } from './Language';

const blank = () => ({ title: '', content: '', source: '', scope: 'agent', enabled: false });
export default function KnowledgePanel({ agentId, tab, busy }) {
  const { t, errorText, locale } = useI18n();
  const [data, setData] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [form, setForm] = useState(blank);
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const api = window.btk.personal.knowledge;
  useEffect(() => {
    let live = true;
    api.read(agentId).then(value => { if (live) { setData(value); setPrompt(value.prompt); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [agentId]);
  async function act(action) {
    if (busy || working) return;
    setWorking(true); setError(''); setNotice('');
    try { setData(await action()); setNotice('저장됨'); } catch (e) { setError(e.message); }
    finally { setWorking(false); }
  }
  const locked = busy || working || !data;
  const scopes = { global: t('공통 메모리'), team: t('팀 메모리'), agent: t('에이전트 전용') };
  return <div className="knowledge-panel">
    {error && <p role="alert" className="personal-error">{errorText(error)}</p>}
    {notice && <p role="status">{t(notice)}</p>}
    {tab === 'prompt' ? <form onSubmit={event => { event.preventDefault(); act(() => api.prompt(agentId, prompt)); }}><fieldset disabled={locked}>
      <label>{t('역할 프롬프트')}<textarea maxLength={4000} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <button className="outline-button" disabled={prompt === data?.prompt}><Save size={16} />{t('프롬프트 저장')}</button>
    </fieldset></form> : <>
      <label>{t('메모리 검색')}<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <ul className="knowledge-list">{data?.records.filter(r => `${r.title} ${r.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(record => <li key={record.id}>
        <div><strong>{record.title}</strong><small>{scopes[record.scope]} · {record.enabled ? t('사용') : t('사용 안 함')} · {new Date(record.updatedAt).toLocaleDateString(locale)}</small></div>
        <button type="button" className="icon-button" disabled={locked} title={t('메모리 수정')} aria-label={t('{0} 수정', [record.title])} onClick={() => { setForm(record); setNotice(''); }}><Pencil size={15} /></button>
        <button type="button" className="icon-button" disabled={locked} title={t('메모리 삭제')} aria-label={t('{0} 삭제', [record.title])} onClick={() => { if (window.confirm(t('이 메모리를 삭제할까요?'))) act(async () => { const value = await api.remove(agentId, record.id); if (form.id === record.id) setForm(blank()); return value; }); }}><Trash2 size={15} /></button>
      </li>)}</ul>
      <button type="button" className="outline-button" disabled={locked} onClick={() => { setForm(blank()); setNotice(''); }}><Plus size={16} />{t('새 메모리')}</button>
      <form onSubmit={event => { event.preventDefault(); act(async () => { const value = await api.save(agentId, form); setForm(blank()); return value; }); }}><fieldset disabled={locked}>
        <label>{t('메모리 제목')}<input required maxLength={100} value={form.title} onChange={e => setForm(old => ({ ...old, title: e.target.value }))} /></label>
        <label>{t('공유 범위')}<select aria-label={t('공유 범위')} value={form.scope} onChange={e => setForm(old => ({ ...old, scope: e.target.value }))}>{Object.entries(scopes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>{t('메모리 내용')}<textarea required maxLength={2000} value={form.content} onChange={e => setForm(old => ({ ...old, content: e.target.value }))} /></label>
        <label>{t('출처')}<input maxLength={300} value={form.source} onChange={e => setForm(old => ({ ...old, source: e.target.value }))} /></label>
        <label className="knowledge-enabled"><input type="checkbox" checked={form.enabled} onChange={e => setForm(old => ({ ...old, enabled: e.target.checked }))} />{t('실행에 사용 · 모델 공급자에 전달')}</label>
        <button className="outline-button"><Save size={16} />{t('메모리 저장')}</button>
      </fieldset></form>
    </>}
  </div>;
}
