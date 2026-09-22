import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, RotateCcw, PanelRight, Square, Plus, X, Settings2, Network, Bot, CircleAlert, Check } from 'lucide-react';
import { useI18n } from './Language';
import './team.css';

const api = () => window.btk.personal.team;
export default function TeamPanel({ state, run, busy, draft: objective, onDraftChange: setObjective, onStart, onCancel, onClear, onSelect, onCreate, renderEditor }) {
  const { t, errorText } = useI18n();
  const [configuration, setConfiguration] = useState(null);
  const [editing, setEditing] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState('');
  const [showTeam, setShowTeam] = useState(true);
  const transcriptRef = useRef(null);
  useEffect(() => { const element = transcriptRef.current; if (element) element.scrollTop = element.scrollHeight; }, [run?.id, run?.status]);
  const editorRef = useRef(null);
  useEffect(() => {
    if (editing && state.agentId === editing && window.innerWidth <= 1250) editorRef.current?.scrollIntoView({ block: 'start' });
  }, [editing, state.agentId]);
  useEffect(() => {
    let live = true;
    api().configuration().then(value => { if (live) setConfiguration(value); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [state]);
  const locked = busy || working;
  async function act(action) {
    if (locked) return;
    setWorking(true); setError('');
    try { await action(); } catch (e) { setError(e.message); }
    finally { setWorking(false); }
  }
  async function configure(value) { const next = await api().configure(value); setConfiguration(next); setExisting(''); }
  async function edit(id) { await onSelect(id); setEditing(id); }
  const labels = { running: t('실행 중'), completed: t('완료'), partial: t('부분 완료'), failed: t('실패'), cancelled: t('취소됨'), pending: t('대기'), planning: t('계획 수립'), working: t('작업 수행'), synthesizing: t('결과 취합') };
  if (!configuration) return <section className="team-panel"><p role={error ? 'alert' : 'status'}>{error ? errorText(error) : t('설정 확인 중')}</p></section>;
  const { masterId, workerIds, agents } = configuration;
  const master = agents.find(a => a.id === masterId);
  const workers = workerIds.map(id => agents.find(a => a.id === id));
  const available = agents.filter(a => a.id !== masterId && !workerIds.includes(a.id));
  const missing = [master, ...workers].filter(a => !a?.configured);
  const node = (agent, isMaster = false) => <div className={`team-node ${editing === agent.id ? 'selected' : ''}`}>
    <button className="team-node-select" type="button" disabled={locked} aria-label={t('{0} 설정', [agent.name])} onClick={() => act(() => edit(agent.id))}>
      {isMaster ? <Network size={20} /> : <Bot size={20} />}<span><strong>{agent.name}</strong><small>{agent.model || t('모델 미설정')}</small></span>
      <span className={`team-node-state ${agent.configured ? '' : 'missing'}`}>{agent.configured ? <Check size={15} /> : <CircleAlert size={15} />}{agent.configured ? t('모델 설정됨') : t('연결 필요')}</span><Settings2 size={16} />
    </button>
    {!isMaster && <button type="button" className="icon-button" disabled={locked} title={t('팀에서 제외')} aria-label={t('{0} 팀에서 제외', [agent.name])} onClick={() => act(async () => { await configure({ masterId, workerIds: workerIds.filter(id => id !== agent.id) }); if (editing === agent.id) setEditing(null); })}><X size={16} /></button>}
  </div>;
  return <section className="team-panel team-chat-panel">
    <header className="team-chat-heading"><h1>{t('팀 작업')}</h1><div><button type="button" className="icon-button" title={t('새 팀 대화')} aria-label={t('새 팀 대화')} disabled={locked} onClick={() => { if (!run || window.confirm(t('팀 대화 기록을 비울까요?'))) { onClear(); setObjective(''); } }}><Plus size={18} /></button><button type="button" className="icon-button" title={t('팀 구성 표시')} aria-label={t('팀 구성 표시')} aria-expanded={showTeam} onClick={() => setShowTeam(value => !value)}><PanelRight size={18} /></button></div></header>
    {error && <p role="alert" className="personal-error">{errorText(error)}</p>}
    <div className={`team-conversation-layout ${showTeam ? 'show-team' : ''}`}>
      <section className="team-chat">
        <div className="team-transcript" ref={transcriptRef} role="log" aria-label={t('팀 대화')}>
          {!run && <div className="personal-empty"><Network size={30} /><h2>{master.name}</h2><span>{master.model || t('모델 미설정')}</span></div>}
          {(run?.turns || (run ? [run] : [])).map(turn => <React.Fragment key={turn.id}>
            <article className="personal-message user"><strong>{t('나')}</strong><p>{turn.objective}</p></article>
            <article className="personal-message assistant"><strong>{turn.masterName}</strong><small>{labels[turn.status]}{turn.status === 'running' ? ` · ${labels[turn.phase]}` : ''}</small>
              {turn.text && <p>{turn.text}</p>}{turn.error && <p role="alert">{errorText(turn.error)}</p>}
              {turn.workers.some(w => w.error || w.status === 'partial') && <ul className="team-failures">{turn.workers.filter(w => w.error || w.status === 'partial').map(w => <li key={w.agentId}><strong>{w.name}</strong> · {w.error ? errorText(w.error) : t('응답 불완전')}</li>)}</ul>}
              {turn.id === run.id && ['partial', 'failed'].includes(turn.status) && <button type="button" className="outline-button" disabled={locked} onClick={() => onStart({ masterId: turn.masterId, workerIds: turn.workers.map(w => w.agentId), objective: turn.objective, retryOf: turn.id })}><RotateCcw size={15} />{t('미완료 작업 재시도')}</button>}
            </article>
          </React.Fragment>)}
        </div>
        {missing.length > 0 && <div className="team-incomplete" role="status"><CircleAlert size={16} /><span>{t('모델 연결 필요')}: {missing.map(a => a.name).join(', ')}</span></div>}
        <form className="composer team-composer" onSubmit={async event => { event.preventDefault(); if (locked || missing.length || !workerIds.length || !objective.trim()) return; const result = await onStart({ masterId, workerIds, objective }); if (result && result.id !== run?.id) setObjective(''); }}>
          <textarea aria-label={t('작업 목표')} required maxLength={16000} disabled={locked} value={objective} onChange={event => setObjective(event.target.value)} />
          <div className="composer-bottom"><span>{master.name} · {workers.length}</span>{run?.status === 'running' ? <button type="button" className="icon-button" title={t('팀 작업 중단')} aria-label={t('팀 작업 중단')} onClick={onCancel}><Square size={16} /></button> : <button className="send" title={t('팀 작업 실행')} aria-label={t('팀 작업 실행')} disabled={locked || !objective.trim() || !workerIds.length || missing.length > 0 || run?.turns?.length >= 20}><ArrowUp size={18} /></button>}</div>
        </form>
      </section>
      {showTeam && <><button className="team-sidebar-scrim" aria-label={t('팀 구성 닫기')} onClick={() => setShowTeam(false)} /><aside className="team-sidebar">
    <div className={`team-builder ${editing ? 'editing' : ''}`}>
      <section className="team-structure" hidden={Boolean(editing)} aria-label={t('에이전트 구성')}>
        <div className="team-root-heading"><h2>{t('마스터')}</h2><select aria-label={t('마스터 선택')} disabled={locked} value={masterId} onChange={event => { const id = event.target.value; act(async () => { await configure({ masterId: id, workerIds: workerIds.filter(worker => worker !== id) }); await edit(id); }); }}>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        {node(master, true)}
        <ul className="team-tree" aria-label={t('작업 에이전트')}>{workers.map(agent => <li key={agent.id}>{node(agent)}</li>)}</ul>
        <div className="team-add-actions">
          <button type="button" className="outline-button" disabled={locked || workerIds.length >= 4 || agents.length >= 20} onClick={() => act(async () => {
            let index = 1;
            while (agents.some(a => a.name === t('작업 에이전트 {0}', [index]))) index++;
            const created = await onCreate(t('작업 에이전트 {0}', [index]));
            await configure({ masterId, workerIds: [...workerIds, created.agentId] });
            setEditing(created.agentId);
          })}><Plus size={16} />{t('하위 에이전트 추가')}</button>
          {available.length > 0 && <div className="team-attach"><select aria-label={t('기존 에이전트 연결')} disabled={locked || workerIds.length >= 4} value={existing} onChange={event => setExisting(event.target.value)}><option value="">{t('기존 에이전트 선택')}</option>{available.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><button type="button" className="icon-button" title={t('기존 에이전트 연결')} aria-label={t('기존 에이전트 연결')} disabled={locked || !existing || workerIds.length >= 4} onClick={() => act(() => configure({ masterId, workerIds: [...workerIds, existing] }))}><Plus size={16} /></button></div>}
        </div>
      </section>
      {editing && state.agentId === editing && <section ref={editorRef} className="team-editor" aria-label={t('에이전트 설정')}><header><h2>{state.agentName}</h2><button type="button" className="icon-button" disabled={locked} title={t('설정 닫기')} aria-label={t('설정 닫기')} onClick={() => { editorRef.current?.closest('.team-panel')?.scrollTo(0, 0); setEditing(null); }}><X size={16} /></button></header>{renderEditor(locked)}</section>}
    </div>
    {run && <section className="team-result" aria-label={t('팀 실행 결과')}>
      <div className="team-status"><strong role="status">{labels[run.status]}{run.status === 'running' ? ` · ${labels[run.phase]}` : ''}</strong><span>{t('모델 호출')} {run.calls} / {run.workers.length + 2}</span>{run.status === 'running' && <button className="icon-button" title={t('팀 작업 중단')} aria-label={t('팀 작업 중단')} onClick={onCancel}><Square size={16} /></button>}</div>
      <p>{run.objective}</p>
      {run.workers.map(worker => <article className="team-worker" key={worker.sessionId}><header><strong>{worker.name}</strong><span>{worker.model}</span><span>{labels[worker.status]}</span></header><p>{worker.task}</p>{worker.text && <details><summary>{t('작업 결과')}</summary><p>{worker.text}</p></details>}</article>)}
    </section>}
      </aside></>}
    </div>
  </section>;
}
