# AEGIS Agent Ops 0.5.15

## What's Changed

- Recover Gemini account selection and pending browser sign-in after reopening settings.
- Reopen the same Google authorization session when the system browser fails to open.
- Persist revoked-session state and request sign-in again without treating temporary network failures as account revocation.
- Automatically check the public GitHub release feed in Windows Personal, with manual download and restart/install approval.
- Prevent update installation during active work, login or setup. Do not install automatically on app exit.
- Add Korean/English update controls and responsive dialogs.

## Upgrade

Versions 0.5.14 and earlier must manually install `AEGIS-Agent-Ops-Setup-0.5.15.exe`
once. This release introduces the update client for future releases. Use **App
updates** in the sidebar afterward. Keep any important unsaved conversation text
before restarting; conversation persistence is not provided by this update.

The installer, blockmap and `latest.yml` are published together. The updater
verifies the download against the release checksum, which is not a publisher
signature. **Windows builds remain unsigned.**

## Verification

- 130 Node tests and 109 Python tests passed locally.
- Nine existing native desktop smoke suites and the new update UI suite passed.
- Packaged fresh-profile, Gemini recovery and update-dialog tests passed.
- Update UI tests simulate release/download/install callbacks; they do not claim
  a live future-version automatic installation was completed.
- Live Google OAuth consent, provider access and billing remain user-dependent;
  no paid provider inference was used in these tests.

## 한국어

Gemini 로그인 복구와 Windows Personal 앱 업데이트 기능을 추가했습니다.
기존 버전은 0.5.15를 한 번 직접 설치해야 합니다. 이후에는 앱에서 새 버전을
확인하고 다운로드·재시작 설치를 승인할 수 있습니다. 작업 중 강제 종료나
앱 종료 시 무단 설치는 하지 않습니다. 설치 파일은 아직 미서명입니다.
