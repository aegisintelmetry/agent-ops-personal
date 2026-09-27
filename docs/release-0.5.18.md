# AEGIS Agent Ops 0.5.18

## What's Changed

- Google sign-in through bundled official Gemini CLI, without a client JSON,
  API key, or separately installed Node runtime. Select **Google sign-in · Gemini
  CLI**, then **Sign in with Google**. The initial model is `auto`.
- One shared Gemini CLI account for coordinator and worker agents, with separate
  model selections and conversation sessions. Shared CLI requests are serialized.
- Preserve the existing Google Cloud API OAuth connection as a separate option;
  improve its first sign-in and shared-account selection flow.
- Send PNG/JPEG/WebP attachments to supported vision models for analysis.
- Generate images through supported OpenAI/Gemini/compatible API connections,
  using a separate image model. Review, save and restore generated images.
- Keep explicit image-transmission confirmation, input size/pixel limits,
  per-agent conversation isolation and existing transmission checks.

## Upgrade

On **0.5.15 or newer**, open **App updates**, check, download **0.5.18**, then
confirm **Restart and install**. Export important work first. Version 0.5.15 does
not persist chat history; this release cannot recover conversations lost when
that older app closes. Earlier versions require the Windows x64 installer.

Installer, blockmap and latest.yml belong to the same build. **The Windows
installer is unsigned.** Checksums verify integrity, not publisher identity.
Do not disable Windows security controls. Downgrading can lose compatibility
with new connection types and image conversations; export before downgrading.

## Limits and Validation

- Google account eligibility and CLI quotas apply. Company/school or licensed
  accounts may need a Cloud project; a CLI project configuration form is not
  included in this version.
- Gemini CLI credentials use the CLI's own isolated encrypted-file storage,
  not Windows DPAPI. The CLI can also retain local session/cache files separately
  from the app's encrypted conversations. Do not share the app's data directory.
- CLI tools, hooks, skills, telemetry and MCP configuration are disabled in this
  integration. ACP permission/file/terminal requests are denied. This does not
  claim interception of all third-party runtime network traffic.
- ChatGPT/Codex and Gemini CLI login connections support analysis, not image
  generation. Image editing/masks and automatic OCR are not included.
- Input images: at most five, 2 MiB each, 16 million pixels. Generation returns
  one base64 image, at most 4 MiB and 16 million pixels. Provider/model support
  and charges remain account-dependent; no implicit API-key fallback is used.
- Local checks: 163 Node tests, 113 Python tests, 12 packaged UI smoke scripts,
  bundled CLI ACP initialization, fresh isolated profile and 0.5.17-to-0.5.18
  settings preservation. Model responses and OAuth completion use fixtures.
- Real Google consent, live model inference, fresh-PC installation and a real
  NSIS/automatic upgrade still require user validation. No live model calls were
  made for these checks. The upgrade test used unpacked executables.

## 한국어

**모델 연결 → Google 로그인 · Gemini CLI → Google로 로그인**에서 JSON·API 키
입력 없이 로그인할 수 있습니다. 기본 모델은 `auto`이고 서브 에이전트도 같은
계정을 공유하면서 모델과 대화는 각각 유지합니다. 기존 Cloud API OAuth 설정은
별도로 보존했습니다.

이미지 분석 입력과 지원 API를 통한 이미지 생성·저장·대화 복원을 추가했습니다.
로그인 연결만으로 이미지 생성이 제공되는 것은 아닙니다.

0.5.15 이상은 **앱 업데이트 → 업데이트 확인 → 다운로드 → 재시작 및 설치**로
업데이트합니다. 미서명 Windows 설치본이며 실제 계정 인증·추론은 사용자 검증이
필요합니다. 회사·학교 계정에는 추가 Google 프로젝트 설정이 필요할 수 있습니다.
Gemini CLI의 인증 저장·캐시는 앱의 OS 암호화 대화 저장과 다릅니다.
