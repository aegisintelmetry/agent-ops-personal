# Personal ChatGPT 로그인 연결

상위 로컬 작업: `DEV-AGENT-OPS-SEPARATION-20260921-LOCAL`

## 사용 경로

개인용 앱 -> 모델 연결 -> 연결 방식 `ChatGPT 로그인` -> `ChatGPT로 로그인`.
브라우저에서 로그인 완료 후 앱의 모델 목록에서 모델을 선택하고 저장한다.
`연결 시험`은 확인 창을 승인한 경우에만 모델 요청을 보낸다. 구독의 Codex 사용 한도를 소비한다.
`사용 한도`는 공식 런타임이 반환한 사용 비율과 초기화 시각만 표시한다.
기존 API 키/로컬 모델 설정은 연결 방식을 바꿔도 유지된다.

## 인증과 실행 경계

- `electron/codex.cjs`가 공식 `codex app-server`를 stdio로 실행한다. shell 실행 없이 창을 숨긴다.
- Codex 설치 파일은 현재 PATH의 native 실행 파일 또는 VS Code 확장 설치에서 탐색한다.
  이번 설치본에 Codex를 번들하지 않았다. 해당 파일이 없는 PC에서는 설치 필요 오류를 표시한다.
- 전용 CODEX_HOME은 저장소 밖 userData의 `agent-ops-personal/codex-home`이다.
  인증의 권위는 해당 home에 연결된 Codex OS keyring이다. `keyring` 실패 시 평문 fallback하지 않는다.
- 기존 IDE 인증을 읽거나 복사하지 않는다. API/MCP 비밀 환경변수도 자식 프로세스에 상속하지 않는다.
- 브라우저 로그인 URL은 공식 HTTPS 호스트만 허용한다. 원시 프로토콜/오류/stderr를 로그나 renderer에 전달하지 않는다.
- 개인 설정 파일에는 연결 방식과 선택한 Codex 모델만 추가한다. 토큰은 앱 설정에 저장하지 않는다.
- 계정 상태는 Codex `account/read`의 메타데이터를 다시 조회한다. UI의 연결 상태는 영속 인증 권위가 아니다.
- 각 요청은 작업 폴더가 아닌 전용 빈 작업 디렉터리의 ephemeral thread로 실행한다.
  현재 대화 이력은 기존 UI 메모리에서 텍스트 컨텍스트로 전달한다. 영속 작업 복구는 미구현이다.
- read-only sandbox와 승인 금지, shell/browser/apps/plugins 등의 기능 비활성화를 적용한다.
  지원하지 않는 도구/권한 요청은 오류로 거부한다. 도구 실행을 허용하는 제품 단계는 아니다.
- 취소/타임아웃은 앱이 소유한 Codex 프로세스를 종료한다. 다른 IDE/러너 프로세스는 종료하지 않는다.
  서버 측 계산/과금까지 반드시 즉시 취소된다는 보장은 없다.
- 상태 조회만 한 유휴 런타임은 60초 뒤 종료한다. 로그인 대기는 최대 10분, 대화 응답은 최대 120초다.
- 응답 완료 이벤트와 텍스트가 모두 있어야 완료로 반환한다. 실패를 성공이나 임의 사용 토큰 수로 표시하지 않는다.

공식 근거: [App Server](https://learn.chatgpt.com/docs/app-server),
[인증과 keyring](https://learn.chatgpt.com/docs/auth),
[설정](https://learn.chatgpt.com/docs/config-file/config-reference).

## 검증

- Node 단위 테스트 60개 통과: 기존 48개 + Codex 12개.
- 실제 설치된 Codex로 초기화, 앱 전용 저장소의 로그아웃 상태, 로그인 시작/취소 확인.
- 실제 Electron 7항목: 선택 화면, IPC, 로그인 시작/취소, 공식 URL 검사,
  390/780/1440 너비, API 방식 복귀, renderer 오류 없음.
- 기존 Personal 네이티브 16항목 및 Slack/요약 브라우저 11항목 회귀 통과.
- Vite 빌드 통과. 스크린샷을 직접 확인했다.
- `artifacts/codex-unit-tests.xml`, `codex-runtime-smoke.json`, `codex-ui-smoke.json` 참조.
- Playwright의 Node DEP0190 경고가 출력됐다. 앱 Codex 실행은 `shell:false`다.
- 첫 수동 진단은 PowerShell의 인라인 Node 따옴표 처리로 SyntaxError가 났다.
  파일 기반 진단으로 변경해 통과했다. 인증값을 사용한 실패가 아니다.

실제 사용자 로그인 완료, OS keyring 저장 후 인증 복원, 계정별 모델 목록/한도,
구독 모델의 실제 응답은 아직 미검증이다. 로그인 대기 화면 시험을 실제 로그인 성공으로 간주하지 않는다.
현재 소스 미리보기만 업데이트했으며 새 설치본/새 PC/중앙 배포는 하지 않았다.
