import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Download, FileText, Files, Plus, X, Copy, Pencil, Image } from 'lucide-react';
import { useI18n } from './Language';
import { readSource, SOURCE_LIMIT, SOURCE_COUNT, sessionArtifacts, artifactName, defaultImageModel, imageGenerationAvailable } from './workspace.mjs';
import RunSummary from './RunSummary';
const DocumentPreview = lazy(() => import('./DocumentPreview'));

const labels = {
  output: ['출력', 'Output'], source: ['소스', 'Sources'], chat: ['대화', 'Chat'], markdown: ['문서 · Markdown', 'Document · Markdown'], text: ['문서 · 텍스트', 'Document · Text'],
  results: ['결과물', 'Outputs'], open: ['작업 패널 표시', 'Show workspace panel'], summary: ['실행 요약', 'Run summary'], empty: ['아직 결과물이 없습니다.', 'No outputs yet.'], noSources: ['선택한 소스가 없습니다.', 'No sources selected.'],
  add: ['소스 추가', 'Add sources'], remove: ['소스 제거', 'Remove source'], close: ['작업 패널 닫기', 'Close workspace panel'], save: ['파일 저장', 'Save file'],
  source_type: ['텍스트·PDF·DOCX·ZIP 최대 512MB, CSV 50MB, 이미지 20MB입니다.', 'Text, PDF, DOCX, ZIP: 512MB. CSV: 50MB. Images: 20MB.'],
  source_size: ['파일 크기 제한을 초과했습니다. 문서·ZIP 512MB, CSV 50MB, 이미지 20MB까지 가능합니다.', 'File size limit exceeded: documents/ZIP 512MB, CSV 50MB, images 20MB.'],
  source_content: ['비어 있거나 읽을 수 없는 파일입니다. 스캔 PDF와 암호화 문서는 지원하지 않습니다.', 'Empty or unreadable file. Scanned PDFs and encrypted documents are not supported.'],
  source_archive: ['손상되었거나 안전한 압축 처리 범위를 초과한 ZIP입니다.', 'The archive is damaged or exceeds safe extraction limits.'],
  source_encrypted: ['암호가 설정된 ZIP은 지원하지 않습니다.', 'Password-protected ZIP files are not supported.'],
  source_archive_empty: ['ZIP 안에 읽을 수 있는 텍스트·PDF·DOCX가 없습니다.', 'No readable text, PDF or DOCX files in the ZIP.'],
  source_native: ['큰 파일은 데스크톱 앱의 파일 선택 창에서 추가해 주세요.', 'Add large files using the desktop file picker.'],
  excerpt: ['일부 내용만 읽음 · 전체 파일 분석 아님', 'Excerpt only · not a full-file analysis'],
  optimized: ['이미지 크기 최적화됨', 'Image resized for transmission'],
  contextExcerpt: ['첨부 내용 일부가 모델 입력 분량에 맞춰 발췌됩니다.', 'Attachment excerpts are shortened to fit the model input budget.'],
  source_timeout: ['문서 읽기 시간이 초과되었습니다.', 'Document reading timed out.'], source_busy: ['문서를 읽고 있습니다.', 'Reading a document.'],
  source_limit: ['소스는 한 대화에 최대 5개까지 추가할 수 있습니다.', 'Up to 5 sources per conversation.'],
  sent: ['첨부 자료는 전송 시 선택한 모델에 전달됩니다.', 'Attachments are sent to the selected model when you send.'],
  image: ['이미지 생성', 'Generate image'], imageModel: ['이미지 모델 ID', 'Image model ID'],
  image_invalid: ['이미지를 읽을 수 없습니다. PNG·JPEG·WebP 파일과 크기를 확인해 주세요.', 'Cannot read the image. Check the PNG, JPEG or WebP file and size.'],
  image_prompt_only: ['이미지 생성에는 텍스트 자료만 사용할 수 있습니다. 이미지 첨부는 제거해 주세요.', 'Image generation accepts text sources only. Remove image attachments.'],
  image_unsupported: ['이 연결은 이미지 생성을 지원하지 않습니다. OpenAI·Gemini 또는 이미지 API를 지원하는 연결을 선택해 주세요.', 'This connection does not support image generation. Select OpenAI, Gemini or an image-compatible API.'],
  image_missing: ['유효한 이미지가 반환되지 않았습니다. 이미지 모델·권한·응답 크기(4MB)를 확인해 주세요.', 'No valid image returned. Check the image model, access and 4MB response limit.'],
  image_notice: ['이미지 전송 확인 필요 · 민감 정보 자동 검사 없음', 'Image transmission requires confirmation · no automatic sensitive-content scan'],
  generated: ['생성 이미지', 'Generated image'], attached: ['첨부 이미지', 'Attached image'],
  render: ['미리보기', 'Preview'], raw: ['원문', 'Source'], copy: ['내용 복사', 'Copy content'], copied: ['복사됨', 'Copied'], revise: ['이 문서 수정 요청', 'Request a revision'],
  revision: ['이 문서를 다음과 같이 수정해 주세요:', 'Revise this document as follows:'],
  reading: ['자료 읽는 중', 'Reading sources'], folderAccess: ['폴더 자동 읽기 없음', 'No automatic folder access'],
  loading: ['대화 복원 중', 'Restoring conversations'], saving: ['저장 중', 'Saving'], ready: ['로컬 암호화 저장', 'Encrypted local storage'], volatile: ['임시 대화', 'Temporary conversation'],
  restoreError: ['대화를 복원하지 못했습니다. 기존 저장 파일은 보존됩니다. 현재 대화는 저장되지 않습니다.', 'Could not restore conversations. Existing storage is preserved. This conversation will not be saved.'],
  saveError: ['저장하지 못했습니다. 앱을 닫기 전에 내용을 복사해 주세요.', 'Could not save. Copy your content before closing the app.'],
  partial: ['부분 응답', 'Partial response'], preview: ['문서 원문', 'Document source'],
  saved: ['저장됨', 'Saved'], exportError: ['파일을 저장하지 못했습니다.', 'Could not save the file.'],
};
export function useWorkspaceText() {
  const { language } = useI18n();
  return key => labels[key]?.[language === 'en' ? 1 : 0] || key;
}

export function MessageImages({ row }) {
  const w = useWorkspaceText();
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  if (!row.images?.length) return null;
  return <div className="workspace-message-images">{row.images.map((image, index) => <figure key={index}>
    <img src={image} alt={w(row.role === 'assistant' ? 'generated' : 'attached')} />
    {row.role === 'assistant' && <button type="button" className="icon-button" title={w('save')} aria-label={w('save')} disabled={saving} onClick={async () => {
      setSaving(true); setNotice('');
      try { const result = await window.btk.personal.exportImage({ name: `image-${index + 1}`, image }); if (result.saved) setNotice(w('saved')); }
      catch { setNotice(w('exportError')); }
      finally { setSaving(false); }
    }}><Download size={17} /></button>}
  </figure>)}{notice && <small role="status">{notice}</small>}</div>;
}

export function WorkspaceInputs({ state, session, disabled, onChange, onReading }) {
  const w = useWorkspaceText();
  const picker = useRef(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const sources = session.sources || [];
  async function attach(files) {
    if (!files.length) return;
    setError(''); setReading(true); onReading?.(true);
    try {
      if (sources.length + files.length > SOURCE_COUNT) throw new Error('source_limit');
      const additions = [];
      for (const file of files) additions.push(await readSource(file, params => window.btk.personal.workspace.import(params), window.btk.personal.workspace.importFile));
      const next = [...sources, ...additions];
      onChange({ sources: next });
    } catch (error) { setError(w(['source_limit', 'source_type', 'source_size', 'source_content', 'source_timeout', 'source_busy', 'source_archive', 'source_archive_empty', 'source_encrypted', 'source_native'].find(code => error.message?.endsWith(code)) || 'source_content')); }
    finally { setReading(false); onReading?.(false); }
  }
  return <div className="workspace-inputs" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!disabled && !reading) attach(Array.from(event.dataTransfer.files || [])); }}>
    <div className="workspace-options">
      <label><FileText size={15} /><span>{w('output')}</span><select aria-label={w('output')} disabled={disabled || reading} value={session.output || 'chat'} onChange={event => onChange({ output: event.target.value })}>
        {['chat', 'markdown', 'text', 'image'].map(value => <option key={value} value={value}>{w(value)}</option>)}
      </select></label>
      <button type="button" className="workspace-add" disabled={disabled || reading || sources.length >= SOURCE_COUNT} title={w('source_type')} onClick={() => picker.current?.click()}><Plus size={15} />{w('source')}<small>{sources.length || ''}</small></button>
      <input ref={picker} type="file" multiple accept=".txt,.md,.csv,.json,.jsonl,.yaml,.yml,.log,.py,.js,.jsx,.ts,.tsx,.html,.css,.xml,.sql,.sh,.ps1,.ini,.toml,.pdf,.docx,.zip,.png,.jpg,.jpeg,.webp" aria-label={w('add')} hidden disabled={disabled || reading} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; attach(files); }} />
    </div>
    <div className="workspace-source-details">
    {session.output === 'image' && <label className="workspace-image-model"><Image size={15} /><span>{w('imageModel')}</span><input aria-label={w('imageModel')} maxLength={200} disabled={disabled} value={session.imageModel ?? defaultImageModel(state)} onChange={event => onChange({ imageModel: event.target.value })} /></label>}
    {session.output === 'image' && !imageGenerationAvailable(state) && <p className="workspace-source-error" role="alert">{w('image_unsupported')}</p>}
    {sources.length > 0 && <><ul className="workspace-source-chips">{sources.map(source => <li key={source.id}><FileText size={14} /><span title={source.name}>{source.name}</span><button type="button" className="icon-button" title={w('remove')} aria-label={`${w('remove')}: ${source.name}`} disabled={disabled || reading} onClick={() => onChange({ sources: sources.filter(item => item.id !== source.id) })}><X size={13} /></button></li>)}</ul><small className="workspace-source-notice">{w('sent')}</small></>}
    {error && <p className="workspace-source-error" role="alert">{error}</p>}
    {reading && <small role="status">{w('reading')}</small>}
    {sources.filter(source => source.truncated || source.optimized).map(source => <small className="workspace-source-notice" role="status" key={source.id}>{source.name}: {w(source.optimized ? 'optimized' : 'excerpt')}</small>)}
    {sources.reduce((sum, source) => sum + source.text.length, 0) > SOURCE_LIMIT && <small className="workspace-source-notice" role="status">{w('contextExcerpt')}</small>}
    {sources.some(source => source.image) && <p className="workspace-source-notice" role="status">{w('image_notice')}</p>}
    </div>
  </div>;
}

export function WorkspacePanel({ state, session, slack, onConnectors, onClose, onRevise, disabled }) {
  const w = useWorkspaceText();
  const [tab, setTab] = useState('results');
  const [chosen, setChosen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [raw, setRaw] = useState(false);
  const artifacts = sessionArtifacts(session);
  const row = artifacts.find(item => item.id === chosen) || artifacts.at(-1);
  const index = artifacts.indexOf(row);
  useEffect(() => setNotice(''), [row?.id]);
  async function download() {
    setSaving(true); setNotice('');
    try {
      const result = row.output === 'image'
        ? await window.btk.personal.exportImage({ name: `image-${index + 1}`, image: row.images[0] })
        : await window.btk.personal.exportDocument({ name: artifactName(row, index), content: row.content });
      if (result.saved) setNotice(`${w('saved')}: ${result.name}`);
    } catch { setNotice(w('exportError')); }
    finally { setSaving(false); }
  }
  return <aside className="workspace-panel" aria-label={w('results')}>
    <header><Files size={17} /><strong>{w('results')}</strong><button className="icon-button" type="button" title={w('close')} aria-label={w('close')} onClick={onClose}><X size={16} /></button></header>
    <div className="workspace-panel-tabs" role="tablist" aria-label={w('results')}>{['results', 'source', 'summary'].map(value => <button type="button" role="tab" id={`workspace-tab-${value}`} aria-controls="workspace-tab-content" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{w(value)}</button>)}</div>
    <div id="workspace-tab-content" role="tabpanel" aria-labelledby={`workspace-tab-${tab}`} className="workspace-panel-content">
      {tab === 'summary' ? <RunSummary state={state} session={session} slack={slack} onConnectors={onConnectors} /> : tab === 'source' ? <>
        {!session.sources?.length ? <p className="workspace-panel-empty">{w('noSources')}</p> : session.sources.map(source => <details className="workspace-source-detail" key={source.id}><summary>{source.name}</summary>{source.image ? <img className="workspace-source-image" src={source.image} alt={source.name} /> : <pre>{source.text}</pre>}</details>)}
      </> : row ? <>
        <div className="workspace-artifact-toolbar"><select aria-label={w('results')} value={row.id} disabled={saving} onChange={event => { setChosen(event.target.value); setNotice(''); }}>{artifacts.map((item, i) => <option key={item.id} value={item.id}>{artifactName(item, i)}</option>)}</select><button type="button" className="icon-button" title={w('save')} aria-label={w('save')} disabled={saving} onClick={download}><Download size={17} /></button></div>
        {notice && <p role="status">{notice}</p>}
        {row.state === 'partial' && <p role="status">{w('partial')}</p>}
        {row.output === 'image' ? <img className="workspace-generated-image" src={row.images?.[0]} alt={w('generated')} /> : <><div className="workspace-document-controls">
          {row.output === 'markdown' && <div className="workspace-view-switch" role="group" aria-label={w('render')}><button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>{w('render')}</button><button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>{w('raw')}</button></div>}
          <button className="icon-button" type="button" title={w('copy')} aria-label={w('copy')} onClick={async () => { try { await window.btk.personal.copyDocument(row.content); setNotice(w('copied')); } catch { setNotice(w('exportError')); } }}><Copy size={16} /></button>
          <button className="icon-button" type="button" title={w('revise')} aria-label={w('revise')} disabled={disabled || !onRevise || Boolean(session.draft) || row.content.length > 11000} onClick={() => onRevise(`${w('revision')}\n\n\n---\n${row.content}`)}><Pencil size={16} /></button>
        </div>
        {row.output === 'markdown' && !raw ? <Suspense fallback={<pre className="workspace-document">{row.content}</pre>}><DocumentPreview content={row.content} label={w('render')} /></Suspense> : <pre className="workspace-document" aria-label={w('preview')}>{row.content}</pre>}
        </>}
      </> : <div className="workspace-panel-empty"><FileText size={28} /><p>{w('empty')}</p></div>}
    </div>
  </aside>;
}
