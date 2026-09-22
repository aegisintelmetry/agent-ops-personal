import { useI18n } from "./Language";
import React from "react";
import tools from "../electron/slack-tools.json";
import { Bot, CheckCircle2, Circle, CircleAlert, FileText, FolderOpen, Hash, LoaderCircle, Plug, Sparkles } from "lucide-react";

function ProgressIcon({ status }) {
  if (status === "completed") return <CheckCircle2 size={14} className="summary-done" />;
  if (status === "running") return <LoaderCircle size={14} className="spin" />;
  if (["failed", "partial", "cancelled"].includes(status)) return <CircleAlert size={14} className="summary-warning" />;
  return <Circle size={14} />;
}
export default function RunSummary({ state, session, slack, onConnectors }) {
  const { t, locale } = useI18n();
  const run = session.latestRun;
  const labels = { running: t("응답 대기"), completed: t("완료"), partial: t("부분 응답"), failed: t("실패"), cancelled: t("취소") };
  const enabled = slack?.enabled && slack?.tokenConfigured;
  const steps = run ? [
    [t("요청 접수"), "completed"],
    [t("모델 응답"), run.status],
    [t("응답 표시"), ["completed", "partial"].includes(run.status) ? run.status : "pending"],
  ] : [];
  return <aside className="run-summary" aria-label={t("실행 요약")}>
    <header><h2>{t("실행 요약")}</h2><span>{t("최근 요청")}</span></header>
    <details open><summary>{t("에이전트")} <span>{state.model ? 1 : 0}</span></summary>
      {state.model ? <div className="summary-item"><Bot size={17} /><div><strong>{state.agentName || "Personal Agent"}</strong><small>{state.model}</small><small>{t("텍스트 대화")}</small></div></div> : <p className="summary-empty">{t("모델 미연결")}</p>}
    </details>
    <details open><summary>{t("진행")} <span>{steps.length}</span></summary>
      {steps.length ? <><ol>{steps.map(([label, status]) => <li key={label} data-state={status}><ProgressIcon status={status} /><span>{label}</span></li>)}</ol><p className="summary-run-state">{labels[run.status]} · {new Date(run.startedAt).toLocaleTimeString(locale)}</p>{run.usage?.total_tokens != null && <p className="summary-run-state">{t("토큰")} {run.usage.total_tokens}</p>}</> : <p className="summary-empty">{t("요청 없음")}</p>}
    </details>
    <h3>{t("실행 컨텍스트")}</h3>
    <details open><summary>Skills <span>0</span></summary><p className="summary-empty"><Sparkles size={14} />{t("연결된 스킬 없음")}</p></details>
    <details open><summary>{t("커넥터 · 도구")} <span>{enabled ? tools.length : 0}</span></summary>
      <button className="summary-connector" onClick={onConnectors}><Hash size={17} /><div><strong>Slack</strong><small>{enabled ? slack.authenticated ? t("인증 확인") : t("연결 확인 필요") : t("미연결")} · Web API</small></div><Plug size={14} /></button>
      {enabled && <ul className="summary-tools">{tools.map(tool => <li key={tool.id}>{t(tool.name)}<code>{tool.id}</code></li>)}</ul>}
      <p className="summary-empty">{t("모델 자동 호출 미연결")}</p>
    </details>
    <details open><summary>{t("파일")} <span>0</span></summary><p className="summary-empty"><FileText size={14} />{t("생성된 파일 없음")}</p>
      {state.workspace && <div className="summary-item"><FolderOpen size={15} /><small title={state.workspace}>{state.workspace}</small></div>}
    </details>
  </aside>;
}
