# Personal 추가 공급자

상위 로컬 작업: `DEV-AGENT-OPS-SEPARATION-20260921-LOCAL`

모델 연결 -> 연결 방식 `API 키 / 로컬 모델`에서 DeepSeek, Kimi (Moonshot),
Google Gemini를 선택할 수 있다. ChatGPT 로그인과 다른 API 키 연결이다.
각 공급자의 키와 계정별 모델 접근 권한이 필요하다. 웹 구독이나 Coding 전용 키를
일반 API 키와 동일하게 취급하지 않는다. Kimi 기본 연결은 국제 Open Platform이다.

## 설정

`apps/desktop/electron/providers.json`이 UI와 메인 프로세스의 공통 공급자 카탈로그다.
공식 프리셋의 주소는 고정이며 모델 ID는 직접 수정할 수 있다.
다른 서비스/게이트웨이/지역 주소는 `OpenAI 호환 API`에서 HTTPS 주소를 지정한다.
이는 호환 Chat Completions 프로토콜 지원이며 모든 공급자의 고유 API 지원을 뜻하지 않는다.

| 공급자 | 기본 주소 | 문서 확인 기반 기본 모델 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` |
| Kimi | `https://api.moonshot.ai/v1` | `kimi-k2.6` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.8-flash` |

공식 문서를 2026-09-22 KST 확인했다. 이 목록은 계정에서 조회한 모델 목록이 아니다.
사용 가능 여부/잔액은 실제 계정으로 확인해야 한다.

- [DeepSeek 공식 문서](https://api-docs.deepseek.com/): 웹 도구에서 timeout이 발생해
  PowerShell Invoke-WebRequest로 같은 공식 페이지를 읽어 주소/모델을 확인했다.
- [Kimi 공식 Quickstart](https://platform.kimi.ai/docs/overview).
- [Gemini OpenAI 호환 API](https://ai.google.dev/gemini-api/docs/openai).

## 동작 경계

- 저장은 OS 암호화만 수행하며 자동으로 외부 API를 호출하지 않는다.
- 연결 시험은 기존 확인 창 승인 후에만 수행한다.
- 세 공급자의 기본 출력/시험 상한은 8192다. 추론 모델의 64토큰 시험에서 텍스트가
  잘리는 문제를 줄이기 위한 상한이며 실제 소비량이나 성공 보장은 아니다.
  사용자가 설정한 상한보다 시험 요청이 커지지 않는다.
- 키는 공급자와 정확한 주소에 묶인다. 공급자 변경 후 다른 키를 입력하지 않으면
  저장을 거부한다. 다른 공급자를 선택한 상태에서 기존 키가 등록된 것처럼 표시하지 않는다.
- 현재 API 설정은 하나만 저장한다. 여러 공급자 자격증명을 동시에 보관하는 프로파일 기능은 아니다.
- 저장된 키를 renderer/로그로 보내지 않으며 HTTP redirect를 허용하지 않는다.
- ChatGPT 로그인과 API 설정 전환 동작은 유지했다.

## 검증

- 단위 63개 통과. 세 공급자 각각 주소 고정, 키 분리, 암호화 설정 복원,
  요청 주소/인증 헤더/토큰 필드/시험 한도를 대역 fetch로 검증했다.
- 실제 Electron 공급자 UI 8항목 통과. 390/780/1440 너비 스크린샷 확인.
- 기존 Personal 네이티브 16항목, Codex UI 7항목 회귀 통과.
- Vite 빌드 통과. 실제 공급자 키를 사용한 추론 요청은 하지 않았다.
- 근거: `apps/desktop/artifacts/providers-unit-tests.xml`, `providers-ui-smoke.json`.
- 소스 미리보기 변경이며 새 설치본이나 중앙 배포는 하지 않았다.
