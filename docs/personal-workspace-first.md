# Personal conversation workspace

## Scope

The Personal workspace now separates sources, output selection and result review.
Enterprise dashboards and new control-policy features are out of scope. Existing
transmission policy, IPC trust checks, renderer isolation and request cancellation
remain enabled.

## Available

- Composer: Chat, Markdown document or plain-text document output.
- Explicit file selection: UTF-8 TXT, MD, CSV and JSON; up to five files and
  12,000 source characters total, at most 48 KB per file before decoding.
- Text extraction from PDF and DOCX, at most 2 MiB per file. PDF is limited to
  100 pages. Encrypted documents, scanned PDFs and OCR are not supported.
  Parsing runs in a disposable worker with a 15-second timeout and a 128 MiB
  V8 old-generation limit (not a total process-memory ceiling). DOCX ZIP entries
  are bounded and validated before extraction. No Office installation is required.
- PNG, JPEG and WebP can be inspected locally (2 MiB, 16 million pixels).
  Image attachments are explicitly **not** sent to text-only model connections;
  sending is blocked until they are removed. This is not image analysis/generation.
- File-picker and drag-and-drop input share the same validation and limits.
- Attached text is sent with the next request through the existing guarded model
  path. The composer displays that transmission boundary before sending.
- Each conversation owns its sources and output choice. Successful source context
  remains part of conversation history, even if removed from future attachments.
- Right panel: outputs, source review, existing run summary.
- Document responses are listed with stable per-conversation names. Partial output
  is labelled and exported with a partial filename.
- Markdown preview supports headings, lists, tables and code, with a source-view
  toggle. Raw HTML is skipped; links do not navigate and external images are not
  loaded. Rendering uses react-markdown and remark-gfm, loaded on demand.
- Copy uses an explicit native clipboard action. Revision prepares a follow-up
  draft from the selected output and never automatically sends a model request.
- Saving invokes a native Save As dialog. Only the selected TXT/MD destination is
  written; no automatic workspace writes, network uploads or publishing.
- Korean/English labels and responsive desktop/mobile panel layouts.
- Conversations, drafts, sources and document messages are stored in
  `agent-ops-personal/workspace.enc` using Electron OS encryption. No plaintext
  fallback. Writes are atomic, debounced, and flushed on normal window close.
  Storage status/errors are visible; an unreadable store is not overwritten.
- Interrupted requests restore as failed/cancelled, not as live or completed.
  Session deletion updates encrypted storage. Each agent retains separate sessions.
- Outputs derive from conversation messages, not a separate artifact cache.
  Request context retains recent successful messages within 80,000 serialized
  characters, leaving room for existing memory enrichment. Older visible history
  remains on disk but may not be included in a model call.
- Up to 20 agents, 20 sessions per agent, 500 messages per session and 12 MiB total
  serialized workspace data. Reaching a storage limit reports an error; it never
  silently discards history. Remove unused conversations to recover space.

## Deferred

Image analysis/generation, OCR, native Word editing/export, XLSX/PPTX processing,
HTML publishing and new governance workflows are not implemented by this change.
Only TXT/MD output is exported. PDF/Word import extracts text, not page layout or
embedded images. Cross-device synchronization is not provided. This change does
not sign an installer or automatically update an installed copy. Release details
and upgrade instructions are recorded in [0.5.16](releases/0.5.16.md).

## Verification

- `npm test`
- `npm run build`
- `npm run test:desktop`
- `node tests/workspace-tools-smoke.cjs`

The workspace smoke uses an isolated Electron profile and a loopback fixture model.
It checks source transmission, document output, native export/copy bytes, safe
Markdown rendering, PDF/Word extraction, local image preview, revision drafts,
encrypted restart recovery, existing secret blocking, mobile panels and English
labels. `BTK_DESKTOP_TEST_EXE` can select an unpacked packaged executable.
It does not use a paid model or verify a system-installed release.

Parser and rendering references: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/api.js.html),
[Mammoth raw text](https://github.com/mwilliamson/mammoth.js),
[react-markdown](https://github.com/remarkjs/react-markdown),
[yauzl entry validation](https://github.com/thejoshwolfe/yauzl).
