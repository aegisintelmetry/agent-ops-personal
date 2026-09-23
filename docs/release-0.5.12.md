# 0.5.12 Preview

Unsigned Windows preview. Not a signed release or an automatic update.

## Changes

- Failed personal messages are excluded from later model requests, with edit and
  delete controls. Editing restores the text without submitting it or overwriting
  another draft. Existing redline checks still apply to every retry.
- A configured Google login account enables personal chat without an API key;
  removing that account disables sending again.
- Added failed-message regression tests and profile compatibility checks, with
  an explicit opt-in test mode for an actual NSIS upgrade.

## Verification

- Node: 121 tests; Python: 108 tests. Native UI: 9 smoke scripts.
- Packaged application: 10 smoke scripts, including blocked-message recovery,
  Google fixture login and personal chat, team workflows, and closed logging pipes.
- On one Windows development PC: actual 0.5.11 installation, NSIS upgrade to
  0.5.12, application startup, uninstall, and 0.5.12 reinstallation succeeded.
- Test-profile models, encrypted key, team, role, memory and language survived the
  upgrade. A marker in the default user-data directory survived uninstall and
  reinstall unchanged, then was removed. No pre-existing saved model settings
  were present in that default profile; this is fixture-based retention evidence.
- Uninstall removed the test executable, shortcuts and uninstall registration.
- Model requests used local fixtures. This is not real-provider or clean-PC evidence.

## Before Signing

See [pre-signing validation](pre-signing-validation.md). Clean-machine installation
and real provider authentication remain separate gates. Authenticode signing is
not configured; the installer remains `NotSigned`.
Existing settings and saved memory are persistent; personal and team conversations
are in-memory only and do not survive an app restart.

## 한국어

미서명 Windows 프리뷰입니다. 기존 0.5.11 파일을 교체하지 않고 새 버전으로 배포합니다.

- 차단·실패한 메시지를 다음 요청에서 제외하며 수정·삭제할 수 있습니다.
- Google 로그인 연결인데 API 키가 없어 개인 대화 전송 버튼이 비활성화되던 문제를 수정했습니다.
- 이 개발 PC에서 실제 설치·0.5.11에서 업데이트·제거·재설치를 확인했습니다.
- 시험 프로필의 설정·암호화 키·메모리 보존, 바로가기·설치 등록 제거를 확인했습니다.
- 기본 데이터 폴더의 시험 파일도 제거·재설치 후 유지됐습니다. 기본 프로필에는 기존 모델 설정이 없어 실제 사용자 설정 보존 증거로 해석하지 않습니다.
- Node 121개, Python 108개, 네이티브 UI 9종 및 패키지 10종 검사를 통과했습니다.
- 새 PC 실설치와 실제 공급자 로그인은 별도 확인이 필요합니다.
