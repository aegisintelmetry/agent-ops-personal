# Personal Transmission Redline (0.5.11 Preview)

Introduced in 0.5.11-preview. The older 0.5.10 installer does not include this safeguard.

## Implemented

The API, Google OAuth model, and Codex conversation adapters inspect their final
message text before sending it. This includes role prompts and memory already
assembled by the application. Known credential-shaped strings are rejected with
a fixed, non-sensitive error. API requests also reject the configured API key in
message content; Google requests reject the access token used for that request.
Credentials required in authentication headers are not blocked.

The same adapters serve individual conversations, team planning, workers,
synthesis, retries, and connection probes. There is no probe bypass. Direct calls
to the adapters are also checked. Inputs are copied into frozen message snapshots
before asynchronous authentication, preventing caller mutations after inspection.

The rule set is versioned as `personal-transmission-v1`. Redline failures cannot
be approved through the existing team confirmation dialog. Remove the suspected
credential from the request; false positives are possible.

## Limits

This is a deterministic pattern-based safeguard, not a DLP certification or a
complete detector of credentials, personal data, or prompt injection. Encoded,
obfuscated, split, and unknown secret formats may not be detected. It does not
inspect every credential stored on the PC or control a Codex subprocess's internal
network traffic. OAuth login, token refresh, and Slack traffic are separate from
this model-message boundary. Google token comparison occurs after authentication
refresh, before model inference.

In 0.5.12, failed user messages remain visible but are excluded from
subsequent requests. They can be deleted or moved back to the composer for editing;
editing does not send automatically or overwrite an existing draft. Timeout and
cancellation failures do not prove the provider received nothing. In 0.5.11,
start a new conversation to exclude blocked history. Do not include private conversations or screenshots containing
secrets in public bug reports. This safeguard does not revoke exposed credentials.

There is no configurable destination policy, approval inbox, approval expiry,
persisted audit ledger, or organization-policy distribution in this change.
Those are separate follow-up work, not implicitly enabled by the redline.

## Verification

Node tests exercise pattern rejection, exact key comparison, malformed input,
snapshot immutability, all three adapter paths, team phases, and retry behavior.
The native Electron smoke test uses an isolated profile and loopback fixture;
Korean/English UI checks assert zero model requests for blocked input, and verify
clean follow-up, edit and delete recovery against a local fixture.
No paid provider calls or real account authentication are used.

## 한국어 요약

0.5.11-preview에 추가한 1차 모델 전송 차단 기능입니다. 기존 0.5.10 설치 파일에는 없습니다.
메모리·역할 프롬프트를 포함한 최종 메시지에서 알려진 인증 정보 형식과 현재 API 키를
검사하며, 개인·팀·재시도에 동일한 어댑터 검사를 적용합니다. 승인 버튼으로 넘길 수 없습니다.
0.5.12에서는 실패한 메시지를 후속 전송에서 제외하고 수정·삭제할 수 있습니다.
수정은 자동 재전송하지 않으며 작성 중인 초안을 덮어쓰지 않습니다. 시간 초과·취소는
공급자 미수신을 보장하지 않습니다. 0.5.11 설치본에서는 새 대화를 시작해야 합니다.

패턴 검사는 완전한 민감정보 탐지가 아닙니다. 인코딩·난독화·분할된 비밀값과 알 수 없는
형식은 놓칠 수 있습니다. 로그인·토큰 갱신·Slack 및 외부 프로세스 내부 네트워크 전체를
통제한다고 주장하지 않습니다. 승인함·일회성 승인·감사 기록·조직 정책 연동은 후속 단계입니다.
