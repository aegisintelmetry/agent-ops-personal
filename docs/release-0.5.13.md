# AEGIS Agent Ops 0.5.13

Open-source desktop release. The Windows installer is unsigned; updates are manual.

## Changes

- English screenshots captured from the real desktop UI, using synthetic local
  responses rather than live provider or customer data.
- App, installer and release names no longer use Preview. The installer is
  `AEGIS-Agent-Ops-Setup-0.5.13.exe` and the app is `AEGIS Agent Ops.exe`.
- The public repository is now `aegisintelmetry/agent-ops-personal`.
- Updated public documentation, download links and community messaging.
- Kept the legacy application identifier and user-data directory for upgrade
  compatibility. Historical releases retain their original names.

## Verification

- Node: 121 tests passed. Python: 108 tests passed.
- Nine native UI smoke scripts passed.
- English screenshots checked at desktop and narrow window sizes, with no
  horizontal overflow, a visible composer, and no renderer errors.
- Screenshot responses use four loopback fixture calls; no real model calls.
- Packaged and installed core startup passed without Node or Python on PATH.
- On the development PC, an actual NSIS upgrade from 0.5.12 to 0.5.13 passed.
  The isolated test profile retained agents, models, encrypted key, team, role,
  memory and language. One loopback request verified key decryption; this is
  not evidence of a live provider login or pre-existing user settings retention.
- Installed application and shortcut names no longer contain Preview. The old
  installation directory is retained when upgrading an existing installation.

## Limits

This release does not add security certification, code signing, or a complete
enterprise policy engine. The installer remains `NotSigned`. Clean-PC installation
and actual provider/account flows still require separate validation. Conversations
remain in memory and are not restored after restarting the app.

## 한국어

- 공개 이미지를 영어 UI로 새로 촬영했습니다. 실제 앱 화면이며 응답은 로컬 시험 데이터입니다.
- 앱·설치 파일·릴리스 이름에서 Preview 표시를 제거했습니다.
- 공개 저장소 이름은 `agent-ops-personal`입니다.
- 기존 앱 식별자와 데이터 경로는 업데이트 호환성을 위해 유지했습니다.
- 설치 파일은 미서명이며, 보안 인증이나 기업용 정책 엔진 완성을 의미하지 않습니다.
