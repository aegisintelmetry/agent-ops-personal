# AEGIS Agent Ops 0.5.11 Preview

## 변경 사항

- 모델에 전달되는 최종 대화·메모리에서 알려진 인증 정보 형식과 현재 API 키의 노출을 검사합니다.
- API·Google·Codex 어댑터에 적용하며 개인 대화, 팀 계획·작업자·취합, 재시도와 연결 시험도 검사합니다.
- 차단 시 한글·영문으로 안내하며, 팀 실행 확인창으로 레드라인을 우회할 수 없습니다.
- 검사 후 인증 대기 중 요청 내용이 변경되지 않도록 메시지를 복사·고정합니다.

## 범위와 주의사항

Windows x64 **미서명 프리뷰**입니다. 설치 파일의 SHA-256은 릴리스 첨부 `SHA256SUMS.txt`와 대조하세요.
설치하면 기존 앱과 동일한 제품 ID·설정 경로를 사용합니다. 중요한 설정은 별도로 보관하고 앱을 종료한 뒤 업데이트하세요.

패턴 기반 보조 기능이며 완전한 DLP·비밀값 탐지·프롬프트 인젝션 방어가 아닙니다.
인코딩·난독화·분할된 비밀값은 놓칠 수 있습니다. 차단된 내용이 대화 이력에 남으면 새 대화를 시작하세요.
OAuth 인증·토큰 갱신·Slack과 외부 CLI 내부 통신 전체를 통제하지 않습니다.
승인함·일회성 승인·감사 기록·조직 정책 배포는 이번 버전에 포함하지 않습니다.
실제 공급자 로그인 및 새 PC 수동 설치 검증은 자동 모의 시험과 별도입니다.

## English

This preview adds a model-message transmission redline across API, Google OAuth
inference, and Codex adapters. Known credential-shaped text and applicable current
credentials in message content are rejected before inference. Individual chats,
team phases, retries, and probes use the same adapter checks. Message snapshots
prevent mutation during asynchronous authentication.

This is an **unsigned Windows x64 preview**, not a complete DLP or agent-security
solution. No approval inbox, single-use authorization, durable audit ledger, or
organization-policy rollout is included. Encoded/unknown secrets can evade pattern
checks; false positives are possible. Start a new chat to exclude blocked history.
Provider authentication and external CLI internals remain separate boundaries.

See [policy details](transmission-policy.md) for implementation limits and tests.
