# 개발 및 검증

라이선스와 공개 명의 확정 전에는 외부 기여를 받지 않습니다.
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
