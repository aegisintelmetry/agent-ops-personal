# 개발 및 검증

제품 라이선스는 Apache-2.0입니다. 버그 보고, 재현 가능한 테스트와 작은 범위의 개선 PR을 환영합니다.
큰 기능이나 외부 서비스 연동은 먼저 이슈에서 목적과 범위를 논의해 주세요.

기여할 권한이 있는 코드·문서만 제출하고, 제3자 코드의 출처와 라이선스를 밝혀 주세요.
기존 저작권·라이선스 고지를 유지하고 변경 내용을 설명합니다.
이 프로젝트는 기여자의 저작권을 일괄 양도받는다고 주장하지 않습니다.
공식 원본과 배포 검증은 [출처 안내](docs/provenance.ko.md)를 참고하세요.
개인용은 중앙 서버나 조직 계정 없이 개발할 수 있습니다.

Windows에서 저장소 루트 기준:

```powershell
python -m pip install -r apps/desktop/build-requirements.txt
python -m unittest discover -s tests/desktop
cd apps/desktop
npm ci
npm test
npm run build
npm run test:desktop
```

네이티브 테스트는 저장소에 고정된 Playwright와 Electron을 사용합니다.
실제 API 키나 사용자 프로필을 테스트 fixture로 사용하지 마세요.
빌드 산출물, 대화, 토큰, 로그는 커밋하지 않습니다.
제품 프로필과 운영 러너의 권한 경계를 바꾸는 수정에는 회귀 시험이 필요합니다.
실제 공급자 시험은 사용량을 소비하므로 별도 사용자 동의 아래 진행합니다.
