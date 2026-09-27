# AEGIS Agent Ops 0.5.19

## What's Changed

- Add per-agent reasoning effort selection below the Codex model selector.
  Display only the options advertised by the signed-in runtime, such as Low,
  Medium, High and Extra high. Preserve separate coordinator/worker settings
  and apply them to chat, connection tests and team requests.
- Support ZIP attachments from the file picker and drag-and-drop. Read supported
  text, source code, PDF and DOCX entries without extracting an archive to disk.
- Raise selected-file limits to 512 MiB for documents/text/ZIP, 50 MiB for CSV,
  and 20 MiB for images. Read large documents through the native import worker
  instead of copying the full file through renderer IPC.
- Optimize image inputs above 2 MiB before transmission, with a visible notice.
- Keep output selection, message input and send controls reachable in short or
  narrow windows, including when several long attachment notices are present.
- Preserve Korean/English labels, encrypted workspace storage and existing
  transmission controls.

## Upgrade

On **0.5.15 or newer**, open **App updates**, check for updates, download
**0.5.19**, then confirm **Restart and install**. Save or export important work
first. Older versions need the Windows x64 installer.

The installer, blockmap and latest.yml are generated together. **The Windows
installer is unsigned.** Checksums verify integrity, not publisher identity.
Do not disable Windows security controls.

## Local Validation

- 172 Node tests and 113 Python tests passed; npm audit reported no vulnerabilities.
- Packaged checks passed for fresh-profile startup without development runtimes,
  edition boundaries, agents, language, teams, layout transitions, memory, Google
  and Gemini CLI flows, transmission controls, workspace imports, ZIP/large-file
  handling, images, composer controls, reasoning effort and the update UI.
- The unpacked 0.5.18-to-0.5.19 upgrade test preserved agents, models, encrypted
  test credentials, teams, role prompts, memory, language and conversations.
- Installer size and SHA-512 matched latest.yml. All three uploaded release
  asset SHA-256 digests matched the local build. Authenticode status: NotSigned.
- Secret scanning found no leaks in the release changes. No live model calls
  were made. The reasoning-effort smoke initially waited on a native approval
  dialog; its fixture response was added and the packaged test then passed.

## Scope and Limits

- A 512 MiB import limit does not mean full-file analysis. At most 12,000 extracted
  characters are retained per attachment; all attachments share a 12,000-character
  model-context budget. The UI marks partial sources. Original files are not
  uploaded or retained by this import path. At most five attachments are selected.
- Archives reject traversal paths, symlinks, encryption and excessive expansion.
  Nested ZIPs and unsupported binary entries are skipped; PDF/DOCX entries inside
  ZIPs are limited to 16 MiB. See [workspace limits](https://github.com/aegisintelmetry/agent-ops-personal/blob/v0.5.19/docs/personal-workspace-first.md).
- Images retain the 16-million-pixel limit; model input is at most 2 MiB per
  image after optimization. Provider support and usage charges still apply.
- Reasoning effort selection applies to ChatGPT/Codex login only. Availability
  depends on the model/runtime. An unspecified effort uses the model default;
  unsupported saved overrides are rejected before inference.
- Automated inference and completed OAuth flows use fixtures, not live user
  accounts. Real provider inference and fresh-PC installation require user
  validation. Packaged executable upgrade tests do not prove an NSIS upgrade.

## 한국어

- **모델 연결 → Codex 모델 → 추론 강도**에서 지원되는 High 등의 강도를 선택하고
  저장합니다. 마스터와 서브 에이전트에 각각 적용됩니다.
- ZIP 첨부를 지원하고 문서·텍스트·ZIP은 512 MiB, CSV는 50 MiB, 이미지는 20 MiB까지
  선택할 수 있습니다. 전체 파일 분석이 아니라 제한된 발췌문을 전달합니다.
- 첨부 안내가 길어도 출력 선택과 전송 버튼을 가리지 않도록 수정했습니다.
- **앱 업데이트 → 업데이트 확인 → 다운로드 → 재시작 및 설치**로 업데이트합니다.
  미서명 Windows 설치본이며 실제 계정 호출은 자동 테스트에서 수행하지 않습니다.
