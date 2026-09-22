# 프로젝트 출처와 배포 검증

[English](provenance.md)

## 공식 원본

AEGIS Agent Ops Personal의 유지·배포 주체는 **aegisintelmetry**입니다.
현재 저작권 고지는 `Copyright (c) 2026 aegisintelmetry`입니다.
제3자 구성요소와 커뮤니티 기여의 고지는 각각 존중하며, 의존성 전체를 직접 만들었다고 주장하지 않습니다.

- 공식 소스: https://github.com/aegisintelmetry/agent-ops-public-preview
- 공식 배포: https://github.com/aegisintelmetry/agent-ops-public-preview/releases
- 연락처: contact@aegistelemetry.com

이 배포자 식별자는 법인 실명 확인이나 등록 상표 증명이 아닙니다.
확인되지 않은 법인 등록·상표 등록·권리 귀속 인증을 주장하지 않습니다.

## 확인한 근거와 한계

공개 이력은 선별된 0.5.4 제품 스냅샷에서 시작합니다.

```text
commit: f29a2a3e67d0fd0d2860a4d737d03c8387047909
tree:   490976a1742a1c0714c353039509179e8710baa7
```

관리자가 대응하는 비공개 제품 스냅샷과 비교하여 트리 ID 일치를 확인했습니다.
내부·공개 커밋 대응표는 비공개로 보존합니다. 외부 독자가 이 저장소만으로
비공개 측 원본을 독립 검증할 수 있다는 뜻은 아닙니다.
운영 소스와 이전 비공개 이력은 공개하지 않습니다. [공개 이력](public-history.md)을 참고하세요.

`source-import.json`은 과거 추출 시점의 목록입니다. 과거 경로와 해시는 현재
릴리스의 파일 명세나 운영 코드 포함 목록 또는 전자서명이 아닙니다.
커밋 메타데이터와 해시만으로 법적 원저작자·신원·공인된 창작 시점이 증명되지는 않습니다.

## 0.5.10 설치 파일 검증

공식 릴리스에서 받은 파일을 PowerShell로 확인합니다.

```powershell
Get-FileHash -Algorithm SHA256 .\AEGIS-Agent-Ops-Setup-0.5.10-preview.exe
Get-AuthenticodeSignature .\AEGIS-Agent-Ops-Setup-0.5.10-preview.exe
```

기대 SHA-256:

```text
9e0fcbc07add5237ed015f0008e848b33aaa72f0723369da333530c5ece40399
```

크기는 **133447546바이트**입니다. 이번 확인에서 로컬 파일의 해시와 GitHub
릴리스 자산의 digest가 일치했습니다. Authenticode 상태는 **NotSigned**입니다.
해시 일치는 기준 파일과 바이트가 같다는 뜻이며, 배포자 신원·안전성·재현 빌드나
배포 계정 침해에 대한 보호를 보장하지 않습니다.

이 문서는 현재 배포본의 검증된 빌드 증명을 제공하지 않습니다.
CI 성공만으로 내려받는 설치 파일이 CI에서 만들어졌다고 판단하지 마세요.

## 후속 서명과 증거 보존

커뮤니티 문서 커밋
[`b378145`](https://github.com/aegisintelmetry/agent-ops-public-preview/commit/b378145a172f87e5a561d0b84575a363487f8eee)은
GitHub 커밋 API로 생성했고 검증 응답에서 `verified: true`, `reason: valid`를 확인했습니다.
이는 GitHub가 관리하는 커밋 서명이며, 배포자 자체 키·릴리스 태그·Windows 설치 파일 서명이 아닙니다.
과거 커밋을 소급 서명하거나 법적 원저작권을 인증하지 않습니다.

이번 문서 변경으로 로컬 키 기반 서명이 활성화되지는 않습니다. 이후 서명된 배포라고 안내하기 전에:

1. 서명 주체를 정하고 개인키를 Git 밖에서 관리합니다.
2. 인증된 관리자 채널로 공개키 지문을 공지합니다.
3. 새 릴리스 태그를 서명하고 깨끗한 체크아웃에서 검증합니다. 과거 이력을 다시 써서 당시 서명된 것처럼 만들지 않습니다.
4. 산출물 해시, 실제 빌드 소스 커밋, 워크플로 실행과 의존성 잠금 파일을 연결합니다.
5. 빌드 증명과 Windows 코드 서명은 따로 검증합니다. Git 태그 서명이 설치 파일 서명을 대신하지 않습니다.
6. 비공개 개발 기록과 백업 증거를 보존하되 고객 정보·인증 정보·운영 소스를 공개하지 않습니다.

필요한 법적 권리 증빙이나 독립적인 시점 증명은 이 기술적 배포 검증과 별도로 준비해야 합니다.
