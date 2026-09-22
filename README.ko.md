# AEGIS Agent Ops Personal

[English](README.md) | [Windows 다운로드](https://github.com/aegisintelmetry/agent-ops-public-preview/releases/tag/v0.5.10-preview) | [보안 신고](SECURITY.md)

여러 언어 모델과 대화하고, 텍스트 작업을 에이전트 팀으로 나누고, 필요한 기억을 직접 관리하는 **AEGIS의 오픈소스 데스크톱 프로젝트**입니다.

**AEGIS의 중심은 Security FDE입니다.** Personal은 우리가 공개적으로 개발하는 프로젝트이며, 기업용 보안 제품이나 Security FDE 서비스의 대체재가 아닙니다. 개인 사용과 피드백을 환영합니다. 기업 연동은 실제 사용자에게서 적용 수요가 확인될 때 검토하며, Personal 사용에 기업 계약이나 조직 계정은 필요하지 않습니다.

## 현재 가능한 작업

- 에이전트마다 모델 연결을 선택하고 별도 대화 유지
- 마스터와 작업자 1~4명을 트리로 구성하고 텍스트 작업 분담·응답 취합
- 최대 2개 작업자 병렬 실행, 후속 팀 대화, 진행 확인과 명시적 재시도
- 역할 프롬프트와 공통·팀·에이전트 전용 메모리의 수동 저장·활성화
- 한국어·영어 인터페이스 전환
- Slack 인증 확인과 공개 채널 목록 조회용 읽기 전용 샘플 커넥터

예를 들어 한 작업자가 제안서를 분석하고 다른 작업자가 가정을 비판한 뒤, 마스터가 응답을 정리할 수 있습니다. 이는 모델의 텍스트 지원이며 결과의 사실성을 독립적으로 검증하는 기능은 아닙니다.

## 설치와 시작

1. [릴리스 페이지](https://github.com/aegisintelmetry/agent-ops-public-preview/releases/tag/v0.5.10-preview)에서 `AEGIS-Agent-Ops-Setup-0.5.10-preview.exe`를 내려받습니다.
2. Windows x64에 설치하고 **Personal**을 선택합니다.
3. 에이전트의 모델 연결을 설정한 뒤 대화하거나 팀을 구성합니다.

설치본은 로컬 코어를 포함하므로 실행을 위해 Python·Node를 별도로 설치할 필요는 없습니다. Codex 연결에는 별도의 Codex CLI 또는 VS Code Codex 확장이 필요합니다.

**미서명 프리뷰입니다.** 중요한 업무나 민감한 정보에 사용하기 전에 아래 제한을 확인해 주세요.

## 모델 연결

| 연결 | 현재 지원 |
| --- | --- |
| OpenAI·DeepSeek·Kimi·Gemini | 사용자가 입력한 API 키 |
| OpenAI 호환·로컬 모델 | 직접 지정한 주소와 모델 |
| ChatGPT / Codex | 기존 에이전트별 Codex 로그인 연결 |
| Gemini API OAuth | 공유 Google 계정 연결, 사용자 소유 Desktop OAuth 클라이언트 필요 |

공급자별 API 요금과 사용 한도가 적용됩니다. 채팅 구독과 API는 같은 권한이 아닙니다. Gemini OAuth는 웹 구독이 아니라 Google Cloud 프로젝트의 API 권한과 사용량을 사용합니다. [Google 연결 안내](docs/personal-google-accounts.md)를 참고하세요.

## 데이터와 권한

인증 정보와 저장된 프롬프트·메모리는 OS 암호화 저장소를 사용합니다. 대화 기록은 실행 중 메모리에만 유지되며 앱 종료 후 복원되지 않습니다.

선택한 공급자에는 대화와 적용되는 활성 메모리·역할 프롬프트가 전달됩니다. 팀의 목표와 작업자 결과는 마스터와 공유됩니다. 에이전트 전용 메모리를 다른 에이전트에 원문으로 복사하지는 않지만 생성된 결과에 내용이 반영될 수 있습니다.

로컬 저장이 곧 오프라인 추론을 뜻하지는 않습니다. 민감한 정보를 보내기 전에 선택한 공급자와 사용 조건을 확인하세요.

## 현재 제한

- 일반 파일 접근, 셸 명령 실행, 자율적인 도구 실행은 지원하지 않습니다.
- 메모리는 수동·키워드 기반이며 자동 학습, 임베딩, 클라우드 동기화는 없습니다.
- Slack 샘플은 메시지 전송이나 Slack을 통한 업무 배정을 하지 않습니다.
- 실제 Google OAuth 로그인·추론과 새 PC 설치는 자동화된 모의 시험 외에 추가 검증이 필요합니다.
- 기업 보안 보장, 규정 준수 인증, 응답 시간 SLA, 장기 지원을 약속하지 않습니다.
- 조직 연결 어댑터는 있지만 비공개 중앙 서버와 운영 러너 전체는 포함하지 않습니다. Personal에는 이들이 필요하지 않습니다.

자동 테스트는 로컬 동작·격리·UI·패키징을 검증합니다. 모델 정확도나 모든 공급자·계정 조합의 작동을 증명하지는 않습니다.

## 개발과 기여

Windows, Node.js 22.12 이상, 코어 개발·검증용 Python 3.12를 준비합니다.

```powershell
python -m pip install -r apps/desktop/build-requirements.txt
python -m unittest discover -s tests/desktop
cd apps/desktop
npm ci
npm test
npm run build
npm run test:desktop
npm start
```

설치본 빌드는 저장소 루트에서 실행합니다.

```powershell
powershell -NoProfile -File apps/desktop/build-windows.ps1
```

버그 재현, 작은 범위의 개선 PR, 실제로 유용했던 작업 사례를 환영합니다. [기여 안내](CONTRIBUTING.md)와 [Windows CI](https://github.com/aegisintelmetry/agent-ops-public-preview/actions/workflows/desktop-checks.yml)를 참고하세요.

## 이력과 공개 범위

이 저장소는 라이선스를 적용한 0.5.4 제품 스냅샷을 시작점으로 **공개 가능한 제품 개발 이력을 선별**했습니다. 초기 비공개 운영 코드와 그 Git 이력은 포함하지 않습니다. 이후 제품 개선의 원래 작성자와 변경 설명은 유지했습니다. [이력 방침](docs/public-history.md)을 공개합니다.

`apps/desktop`, `agent_ops` 클라이언트·코어, 테스트가 공개 대상입니다. 비공개 Security FDE 서비스 구현, 중앙 서버, 운영 하네스는 공개하지 않습니다. `BTK_*` 식별자는 기존 설정 호환용이며 내부 시스템 접근 권한을 제공하지 않습니다.

## 보안과 라이선스

취약점은 공개 이슈 대신 **contact@aegistelemetry.com**으로 비공개 신고해 주세요. 키·토큰·개인 대화를 첨부하지 마세요. [보안 정책](SECURITY.md)을 확인하세요.

[Apache-2.0](LICENSE), Copyright (c) 2026 aegisintelmetry. 제3자 구성요소는 각자의 라이선스를 따르며 [NOTICE](NOTICE)와 설치본 고지에 포함합니다. 이 저장소 밖 비공개 서비스에는 이 라이선스가 적용되지 않습니다.
