# Personal conversation workspace

## Scope

The Personal workspace now separates sources, output selection and result review.
Enterprise dashboards and new control-policy features are out of scope. Existing
transmission policy, IPC trust checks, renderer isolation and request cancellation
remain enabled.

## Available

- Composer: Chat, Markdown document, plain-text document or image output.
- Explicit file selection: UTF-8 text, source code, PDF, DOCX and ZIP up to
  512 MiB each; CSV up to 50 MiB; up to five attachments per conversation.
  Selected native files are read in a background worker by path rather than
  copied through renderer IPC. Browser-created Files retain a 2 MiB IPC fallback.
- ZIP text/code and PDF/DOCX entries are read without extraction to disk or
  execution. Encrypted archives, unsafe paths, symlinks and excessive expansion
  are rejected. At most 2,000 entries and 1 GiB declared expansion; large entries
  with a compression ratio over 1,000 are rejected. Nested ZIPs and binary files
  are skipped, not recursively expanded. PDF/DOCX entries inside ZIPs are capped
  at 16 MiB. Skipped entries and excerpting are explicitly marked as partial.
- Up to 12,000 extracted characters are retained per attachment; a shared
  12,000-character excerpt budget is sent to the model. The full original file
  is NOT stored or sent, and this is NOT full-file indexing or ChatGPT feature
  parity. Partial status is visible and included in the model context.
- PDF extraction reads at most 100 pages, stopping at the excerpt budget.
  Encrypted documents, scanned PDFs and OCR are not supported. Parsing runs in
  a disposable worker with a 60-second timeout and 192 MiB V8 old-generation
  limit (not a total process-memory ceiling). PDF uses ranged file reads; DOCX
  retains at most 16 MiB of XML and ignores embedded media. No Office is required.
- PNG, JPEG and WebP can be sent to vision-capable models after native confirmation
  (20 MiB input, 16 million pixels). Inputs over 2 MiB are resized/compressed to
  bounded WebP before transmission; the UI marks this optimization. The existing
  2 MiB model-image and encrypted storage budgets remain intact.
  Image generation and explicit saving are available
  on supported connections; see [image workspace](personal-images.md).
- File-picker and drag-and-drop input share the same validation and limits.
- Attachment details scroll independently so long file notices cannot push the
  output selector, text input or send button outside a short desktop window.
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
- Up to 20 agents, 20 sessions per agent, 500 messages per session and 32 MiB total
  serialized workspace data. Reaching a storage limit reports an error; it never
  silently discards history. Remove unused conversations to recover space.

## Deferred

Image-to-image editing, dedicated OCR, native Word editing/export, XLSX/PPTX processing,
HTML publishing and new governance workflows are not implemented by this change.
TXT/MD and generated raster images can be exported. PDF/Word import extracts text, not page layout or
embedded images. Cross-device synchronization is not provided. This change does
not sign an installer or automatically update an installed copy. Release details
and upgrade instructions are recorded in [0.5.19](release-0.5.19.md).

## Verification

- `npm test`
- `npm run build`
- `npm run test:desktop`
- `node tests/workspace-tools-smoke.cjs`
- `node tests/workspace-archive-smoke.cjs`
- `npm run test:workspace-controls` (five long attachments, all output modes,
  390-1440 pixel widths, 500-900 pixel heights, settings return and language switch)

The archive smoke additionally exercises native ZIP selection, drag-and-drop,
512 MiB text input, CSV over-limit rejection, partial model context, 20 MiB image
optimization, encrypted metadata recovery and desktop/mobile Korean/English UI.
Unit tests exercise an exactly 512 MiB padded ZIP and unsafe ZIP rejection.
Fixtures do not establish general real-world parsing throughput or peak memory.

Size baseline: [OpenAI File Uploads FAQ](https://help.openai.com/en/articles/8555545-file-uploads-faq)
(checked September 27, 2026). This app uses binary MiB limits and retains its own
parser, excerpt, image-resolution and storage constraints. Limits of the chosen
model provider are separate; no ChatGPT quota or subscription is inherited.

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
