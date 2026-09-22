import React, { useState } from 'react';
import { Play, Square } from 'lucide-react';
import { useI18n } from './Language';
import './team.css';

export default function TeamPanel({ agents, selectedId, run, busy, onStart, onCancel }) {
  const { t, errorText } = useI18n();
  const [masterId, setMaster] = useState(selectedId);
  const [workerIds, setWorkers] = useState([]);
  const [objective, setObjective] = useState('');
  const labels = { running: t('실행 중'), completed: t('완료'), partial: t('부분 완료'), failed: t('실패'), cancelled: t('취소됨'), pending: t('대기'), planning: t('계획 수립'), working: t('작업 수행'), synthesizing: t('결과 취합') };
  return <section className="team-panel">
    <h1>{t('팀 작업')}</h1>
    <form onSubmit={event => { event.preventDefault(); onStart({ masterId, workerIds, objective }); }}>
      <fieldset disabled={busy}>
        <label>{t('마스터')}<select value={masterId} onChange={event => { setMaster(event.target.value); setWorkers(ids => ids.filter(id => id !== event.target.value)); }}>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <div className="team-members" role="group" aria-label={t('작업 에이전트')}>
          {agents.filter(a => a.id !== masterId).map(a => <label key={a.id}><input type="checkbox" checked={workerIds.includes(a.id)} disabled={!workerIds.includes(a.id) && workerIds.length >= 4} onChange={event => setWorkers(ids => event.target.checked ? [...ids, a.id] : ids.filter(id => id !== a.id))} />{a.name}</label>)}
        </div>
        <label>{t('작업 목표')}<textarea required maxLength={16000} value={objective} onChange={event => setObjective(event.target.value)} /></label>
        <button className="outline-button" disabled={!objective.trim() || !workerIds.length}><Play size={16} />{t('팀 작업 실행')}</button>
      </fieldset>
    </form>
    {run && <section className="team-result" aria-label={t('팀 실행 결과')}>
      <div className="team-status"><strong role="status">{labels[run.status]}{run.status === 'running' ? ` · ${labels[run.phase]}` : ''}</strong><span>{t('모델 호출')} {run.calls} / {run.workers.length + 2}</span>{run.status === 'running' && <button className="icon-button" title={t('팀 작업 중단')} aria-label={t('팀 작업 중단')} onClick={onCancel}><Square size={16} /></button>}</div>
      <p>{run.objective}</p>
      {run.workers.map(worker => <article className="team-worker" key={worker.sessionId}><header><strong>{worker.name}</strong><span>{worker.model}</span><span>{labels[worker.status]}</span></header><p>{worker.task}</p>{worker.text && <details><summary>{t('작업 결과')}</summary><p>{worker.text}</p></details>}</article>)}
      {run.text && <article><h2>{t('마스터 결과')}</h2><p>{run.text}</p></article>}
      {run.error && <p role="alert">{errorText(run.error)}</p>}
    </section>}
  </section>;
}
