# 보안과 통제 중심의 에이전트: 초기 참여자를 찾습니다

## 모델은 자유롭게, 실행은 통제 가능하게

AEGIS Agent Ops Personal은 여러 모델을 연결하면서 에이전트의 권한과 데이터 흐름을
사용자가 이해하고 통제하는 환경을 목표로 개발 중인 오픈소스 데스크톱 프로젝트입니다.
AEGIS의 중심은 Security FDE이며, Personal은 함께 검증하고 발전시키는 공개 프로젝트입니다.
기업 계약이나 조직 계정 없이 Personal에 참여할 수 있습니다.

**아직 초기 프리뷰입니다. 완성된 보안 제품이나 기업용 통제 체계로 소개하지 않습니다.**
작동하지 않는 조합과 미검증 흐름이 있으며 중요한 업무·민감한 자료 대신 합성 데이터로 시험해 주세요.

## 현재 제공하는 기반

- 에이전트별 모델 연결과 마스터·작업자 텍스트 팀 구성
- 역할 프롬프트, 공통·팀·에이전트 범위의 수동 메모리
- 인증 정보와 저장 메모리의 로컬 암호화
- 한국어·영어 UI와 제한된 실행 경로
- 읽기 전용 Slack 샘플: 인증 확인과 공개 채널 목록

## 함께 설계할 것

- 최소 권한: 에이전트별 파일·도구·네트워크 접근 범위
- 명시적 승인: 외부 전송·파일 변경·명령 실행의 승인 경계
- 데이터 보호: 비밀값 노출 예방과 전송 대상 확인
- 감사 가능성: 실행 주체·승인·결과를 추적하는 기록
- 모델 선택권: 공급자가 달라도 이해할 수 있는 통제 경험

위 항목은 **설계·검증 방향**이며, 현재 제공되는 세밀한 정책 엔진이나 감사 기능이라는 뜻이 아닙니다.
개인용 자율 도구 실행과 일반 파일·셸 실행도 현재 지원하지 않습니다.
특정 경쟁 제품이 모두 종속적이거나 안전하지 않다고 주장하지 않습니다.

## 처음에는 작은 규모로

Windows 사용자, 개발자, 보안 실무자 5~10명부터 피드백을 받고 싶습니다.
이는 모집 목표이며 실제 참여자 수가 아닙니다. 다음 중 하나만 도와주셔도 좋습니다.

1. Windows x64 설치 → 모델 연결 → 첫 응답 흐름을 시험해 주세요.
2. 실패한 단계와 재현 방법을 비밀값 없이 Issues에 남겨 주세요.
3. 한국어·영어 화면의 어색한 표현이나 사용성 문제를 알려 주세요.
4. Ideas에서 권한·승인·데이터 흐름의 위협 모델을 함께 검토해 주세요.
5. 작은 문서·시험 개선부터 PR로 기여해 주세요.

## 시작하기

- [설치·현재 지원 범위](https://github.com/aegisintelmetry/agent-ops-public-preview#readme)
- [다운로드](https://github.com/aegisintelmetry/agent-ops-public-preview/releases/tag/v0.5.10-preview)
- [질문과 제안](https://github.com/aegisintelmetry/agent-ops-public-preview/discussions)
- [버그 신고](https://github.com/aegisintelmetry/agent-ops-public-preview/issues/new/choose)

설치 파일은 미서명 프리뷰입니다. 새 PC 설치와 실제 Google OAuth 연결은 추가 검증 대상입니다.
채팅은 앱 종료 후 복원되지 않으며, 모델 사용료·계정 권한은 공급자에 따릅니다.
선택한 클라우드 모델에는 요청 내용과 적용된 메모리가 전송됩니다.

비밀값·개인 대화·고객 자료를 공개 이슈나 댓글에 올리지 마세요.
취약점은 **contact@aegistelemetry.com** 또는 저장소의 비공개 취약점 신고로 전달해 주세요.
지원은 커뮤니티 기반이며 응답 시간, 보상, 채용 또는 출시 일정을 약속하지 않습니다.

## English: Early Testers and Contributors Welcome

AEGIS Agent Ops Personal is an early open-source desktop project exploring model
choice, understandable permissions, and controllable agent workflows. Security FDE
is AEGIS's primary focus; Personal is a public project, not a certified enterprise
security product. No organization contract is required to participate.

Today it supports per-agent connections, text-based coordinator/worker teams,
manual scoped memory, and Korean/English UI. Fine-grained tool permissions,
approval policies, and auditability are design goals, not shipped guarantees.

We are seeking an initial group of 5–10 Windows testers, developers, and security
practitioners. Help reproduce onboarding failures, improve documentation, test
isolation, or discuss threat models. Use synthetic data, not confidential material.
The installer is unsigned; fresh-PC and real Google OAuth flows need validation.
Provider fees apply, and ordinary chats are not restored after quitting.

Use Discussions for questions/design, Issues for reproducible bugs, and private
reporting for vulnerabilities. Community support has no response-time guarantee.
