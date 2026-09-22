# Personal Google 로그인 연결

## 범위

Google Gemini API OAuth를 공유 계정으로 연결한다. 마스터와 하위 에이전트가 같은
계정을 선택해도 모델 ID, 대화, 역할 프롬프트와 비공유 메모리는 각각 유지한다.
기존 API 키와 Codex 인증 파일은 이동하거나 복사하지 않는다.

Gemini 웹 구독이나 Gemini CLI의 내부 OAuth 자격 증명을 가져오는 기능이 아니다.
Google Cloud 프로젝트의 API 권한, 사용 한도와 결제 조건이 적용된다.

## 설정

1. Google Cloud 프로젝트에서 Generative Language API를 활성화한다.
2. Google Auth Platform에서 동의 화면과 테스트 사용자를 설정한다.
3. OAuth 클라이언트를 `Desktop app` 유형으로 생성하고 JSON을 내려받는다.
4. 에이전트 모델 탭에서 `Google 로그인 · Gemini API`를 선택한다.
5. 연결 이름을 입력하고 `OAuth 클라이언트 가져오기`로 JSON을 선택한다.
6. `Google로 로그인`을 누르고 기본 브라우저에서 직접 인증한다.
7. 연결 계정, 접근 가능한 Gemini 모델 ID, 출력 토큰 한도를 저장한다.
8. 다른 에이전트에서는 같은 계정을 선택하거나 별도 계정을 등록한다.

JSON과 토큰을 채팅, Git 또는 보고서에 첨부하지 않는다. 가져온 원본 JSON 파일은
앱이 삭제하지 않는다. 원본 파일 역시 사용자가 안전하게 보관해야 한다.
외부 사용자에게 배포할 공용 OAuth 앱은 별도 등록과 필요한 Google 검증이 남아 있다.

## 공급자 경계

- Google: 이번 변경에서 정식 Gemini API OAuth 경로 추가. 구독 우회 아님.
- DeepSeek: 기존 공식 API 키 연결 유지. 웹 로그인 연결은 구현하지 않음.
- Kimi: 기존 Moonshot API 키 연결 유지. Kimi Code 로그인은 별도 서비스이며
  이 제품의 로그인 어댑터는 구현하지 않음. 미지원이 기술적으로 불가능하다는 뜻은 아님.
- Claude: 이 제품에 구독 로그인 연결을 제공하지 않음. Anthropic은 제3자 제품에
  Claude.ai 구독 로그인 제공을 허용하지 않는다고 명시한다. 기존 제품에도 Claude
  네이티브 API 어댑터는 없으며 이번 변경에 포함하지 않음.
- ChatGPT: 기존 에이전트별 Codex 연결 유지. Google 계정 공유와 무관함.

## 저장 권위와 안전 경계

- `<userData>/agent-ops-personal/google-accounts.enc`가 계정 설정/인증의 유일한 권위.
  전체 파일을 OS safeStorage로 암호화하고 임시 파일 교체로 저장한다.
- 각 에이전트의 기존 `personal.json`에는 계정 ID 참조와 모델/토큰 한도만 추가한다.
  UI의 계정 목록과 연결된 에이전트 목록은 이 두 권위에서 요청 시 파생한다.
- 기본 브라우저, 임의 loopback 포트, PKCE S256, 무작위 state를 사용한다.
  가져온 JSON의 인증/토큰 URL은 사용하지 않는다.
- 취소/3분 만료 후 늦게 도착한 토큰은 저장하지 않는다. 인증 HTTP 요청은 30초 제한.
- 인증 토큰과 client secret은 renderer로 반환하지 않는다. 원시 공급자 오류도 숨긴다.
- 계정 연결 변경/삭제는 실행 중 차단한다. 삭제는 영향받는 에이전트 이름을 표시하고
  네이티브 확인을 받는다. 로컬 삭제는 Google 서버의 앱 권한 철회가 아니다.
- 공유 인증 클라이언트는 토큰 갱신에만 사용한다. 모델 요청 메시지는 합치지 않는다.
- 모델 호출에는 텍스트만 전달하며 파일/도구 실행 권한을 추가하지 않는다.
- 저장된 토큰 유무는 실시간 계정 유효성/잔액 검증이 아니다. 연결 시험은 명시적 실행만 한다.

## 검증

단위 테스트는 브라우저 state/PKCE, 취소/만료, 늦은 토큰 차단, 암호화 저장,
갱신 후 복원, 공유 계정의 모델/대화 분리, 원시 오류 비노출을 검사한다.
Electron 테스트는 네이티브 파일 가져오기, 모의 로그인 callback, 두 에이전트 연결,
팀 실행 라우팅, 재시작, 삭제, 한국어/영어와 1440/390 너비를 검사한다.
실제 Google 계정 동의/프로젝트 권한/유료 추론은 별도 검증이며 자동 테스트에서 호출하지 않는다.

## 공식 근거

2026-09-22 확인:
- https://ai.google.dev/gemini-api/docs/oauth
- https://github.com/googleapis/google-auth-library-nodejs
- https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md
- https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account
- https://api-docs.deepseek.com/api/deepseek-api/
- https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/providers.md
