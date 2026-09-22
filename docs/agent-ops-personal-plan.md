# Agent Ops Personal 구현 계획

상위 로컬 작업: `DEV-AGENT-OPS-SEPARATION-20260921-LOCAL`

이 문서는 개발 계획이다. 중앙 발주/lease나 배포 완료 증거가 아니다.
Personal은 로컬 제품, Enterprise는 조직 연결 클라우드 제품, Aegis는 Enterprise 전용이다.
추론은 같은 Agent Ops 러너의 역할이며 별도 추론 러너 제품을 만들지 않는다.

## 기능 참고

당시 별도 내부 벤치마킹 기록에 공개 소스의 Codex 구독 인증,
Personal과의 차이, 적용 순서와 검증 조건을 정리했다. 해당 내부 기록은 공개 범위에 포함하지 않는다.
후속 [ChatGPT 연결 구현/검증](agent-ops-personal-codex.md)은 소스 미리보기에 반영했다.
실제 계정 로그인과 구독 응답 확인은 남아 있다.
DeepSeek/Kimi/Gemini API 프리셋은 [추가 공급자 구현 기록](agent-ops-personal-providers.md)을 따른다.

Eigent 공식 문서를 2026-09-22 KST에 확인했다. 직접 설치 검증은 하지 않았다.

- [BYOK](https://www.eigent.ai/docs/byok): 공급자, 주소, 모델, 키 검증.
- [로컬 모델](https://www.eigent.ai/docs/local-model): 호환 모델 서버 연결.
- [단일 실행](https://www.eigent.ai/docs/single-agent): 작업 공간, 세션, 파일, 실행 상태.
- [Workforce](https://www.eigent.ai/docs/workforce): 작업 분할, 협업, 제한된 재시도.
- [MCP](https://www.eigent.ai/docs/mcp)와 [Skills](https://www.eigent.ai/docs/skills): 선택적 도구와 지침.
- [자동화](https://www.eigent.ai/docs/scheduled): 일정, 이벤트, 이력, 실행 한도.

업스트림 코드/자산을 복사하지 않았다. 기존 Electron/React 앱과 세션 reducer를 재사용한다.
프로토콜/저장소 참고: [Chat Completions](https://developers.openai.com/api/reference/resources/chat),
[Ollama 호환 API](https://docs.ollama.com/api/openai-compatibility),
[Electron 44 safeStorage](https://github.com/electron/electron/blob/v44.4.1/docs/api/safe-storage.md).

## 진행 순서

| 단계 | 범위 | 현재 상태 | 완료 조건 |
| --- | --- | --- | --- |
| 1 | 개인용 진입, BYOK, 모델 대화 | 로컬 소스 구현/대역 검증 완료, 실제 공급자 미검증 | 새 PC에서 중앙 등록 없이 키 설정, 실제 모델 응답, 재시작 확인 |
| 2 | 작업 폴더와 파일/브라우저/터미널 도구 | 미구현 | 범위 제한, 실행 전 승인, 취소, 실제 결과 파일 검증 |
| 3 | 작업 이력, 복구, 산출물, 사용량 | 부분 기반만 있음 | 디스크 이력 권위 정의, 중단 후 재개, 산출물 확인, 비용/횟수 제한 |
| 4 | 개인 MCP와 Skills | Slack 읽기 전용 Web API 샘플 구현/대역 검증, MCP/Skills 미구현 | 신뢰 확인, 도구별 권한, 연결 해제, 안전한 실패 처리 |
| 5 | 예약 실행과 협업 | 미구현 | 승인 유지, 중복 실행 방지, 재시도/동시성 한도, 최종 결과 검증 |
| 6 | 배포 검증 | 미실행 | 업데이트 설치본, 새 PC 실제 검증, 기존 조직용 회귀, 유휴/부하 자원 측정 |

## 1단계 경계

- 개인용 진입은 중앙 프로파일/로그인/등록 코드가 필요하지 않는다.
- 공급자는 OpenAI, OpenAI 호환 API, 이 PC의 로컬 호환 모델이다.
  Anthropic/Gemini 고유 프로토콜은 아직 구현하지 않았다.
- 메인 프로세스의 모델 어댑터가 승인된 주소로 요청한다. 별도 러너나 데몬을 추가하지 않는다.
  이후 도구 실행은 기존 런타임과 연결하며, 이 대화 어댑터를 완성된 작업 실행기로 표시하지 않는다.
- 원격 HTTPS, loopback HTTP만 허용한다. 중앙 MCP 주소 검증 정책을 완화하지 않는다.
- OS 암호화 키 저장을 지원하며 평문 fallback은 없다. 저장 키를 renderer/로그에 돌려주지 않는다.
- 설정의 권위는 저장소 밖 Electron userData의 `agent-ops-personal/personal.json`이다.
  UI는 이 파일을 메인 프로세스로 읽은 메타데이터만 표시한다. 중앙 ProfileDB와 복제/동기화하지 않는다.
- 출력 한도는 토큰 한도이며 금액 상한이 아니다. 실제 공급자가 준 사용량만 표시한다.
- 폴더 선택은 경로 저장뿐이다. 파일 읽기/쓰기와 도구 실행은 비활성이다.
- 대화는 현재 메모리에만 있으며 앱 종료/모드/폴더/모델 설정 변경 시 초기화된다.
- 실제 키는 채팅이나 저장소가 아닌 앱 입력란에 입력한다. 실제 유료 API는 자동 시험하지 않았다.

## 검증 근거

후속 작업으로 실행 요약과 Slack 샘플을 추가했다. 현재 공개 샘플의 범위는 [지원 기능과 제한](../README.ko.md)을 따른다.
후속 검증은 Node 48개, 실제 Electron 16항목, 요약/커넥터 브라우저 11항목이다.
아래는 BYOK 첫 단계의 이전 검증 기록이다.

- Node 단위 테스트: 34개 통과(개인용 16개 포함).
- 실제 Electron + OS 암호화 + loopback 모델 대역: 15개 항목 통과.
- Personal 설정/대화: 390/768/1440px, 가로 넘침/대화 영역 겹침 검사 통과.
- 기존 조직용 화면: 390/768/1440/1920px 및 기존 세션 흐름 회귀 통과.
- `apps/desktop/artifacts/personal-smoke.json`, `personal-responsive.json`, `workspace-smoke.json` 참조.
- 첫 Electron 시험은 공급자 select 접근성 이름으로 timeout 발생. 명시적 레이블 추가 후 통과했다.
- 실제 공급자·새 PC·설치본·운영 서버 배포는 이번 단계에서 검증하지 않았다.
