# 배포 전 정리 2 — 통합 테스트

## 식별자와 상태

- 스펙 ID: `031-integration-tests`
- 상태: 완료 (PR #36 병합)
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 지금까지의 브라우저·API 확인 스크립트: `scripts/verify/`(Git 제외) — 025·026·027·028·029(모달·재현·촬영)·fix 001
- API 공통 규칙: `docs/specs/API_CONVENTIONS.md` 3절(no-store), 5절(세션 쿠키 HttpOnly·Secure·SameSite=Lax·Path), 7절(Origin)
- 링크 만료 7일: MEMBER-01-02(`lib/member/link-status.ts`), 설정 시간 1분 강조: STATE-02-02·009 AC-9
- 시간 기준 판정: 030 메모(요청 순서 판정)
- 관련 미결·충돌: 없음

## 사용자와 문제

브라우저 확인이 Git 제외 폴더에만 있어 팀원이 다시 돌릴 수 없고, 개발 서버(dev)·Chromium에서만 확인했다. 배포 환경(운영 모드)과 아이폰 엔진(WebKit)에서 확인한 적이 없다.

## 목표와 범위

- 이번에 할 일 (제품 코드는 바꾸지 않는다)
  1. 테스트 DB와 실행 환경: `.env.e2e`(Neon e2e 브랜치)만 사용, 없거나 개발 DB와 같으면 실행 거부. 실행 전 마이그레이션 적용. Playwright Test — `next build` → `next start`, 포트 3100, 프로젝트 chromium 데스크톱·webkit 데스크톱·webkit 모바일
  2. `scripts/verify/`의 의미 있는 시나리오를 `tests/e2e/`로 옮긴다(대응표는 보고서). DB 조작 준비는 도우미 함수로, 데이터는 테스트마다 만들고 지우며 중단 뒤 다음 실행 시작 때 정리
  3. 새 항목: 전체 흐름(만들기 → 3명 → 제출 → 마감 → 후보 → 확정 → 결과 → 재조율 → 다시 제출 → 취소, 단계마다 다른 사람 화면 폴링 반영), 7일 지난 링크 410 화면, 서버 422 입력란 표시, 마감 1분 이하 강조색, 재조율 응답 유실 뒤 재요청, 운영 모드 no-store·캐시 없음, 세션 쿠키 속성
- 하지 않을 일: 제품 코드 수정(제품 문제는 보고만), CI 연결(DB 비밀값 필요 — 방법만 보고), `scripts/verify/` 삭제

## 선행 작업

030(PR #35 병합). 030 완료 기록을 이 브랜치 첫 커밋에 넣는다.

## 수용 기준

- [x] AC-1: `.env.e2e`가 없거나 `DATABASE_URL`이 `.env`와 같으면(같은 DB 호스트·이름 포함) 서버·테스트를 시작하지 않는다. `.env.e2e`는 Git 제외, SETUP.md에 준비 방법
- [x] AC-2: `npm run test:e2e`가 e2e DB 마이그레이션 → 운영 빌드 → `next start`(3100) → 세 프로젝트 순서로 돈다. `test:e2e:chromium` 등 프로젝트별 스크립트, 단위 테스트와 분리
- [x] AC-3: 옮긴 시나리오·새 시나리오가 세 프로젝트 모두 2회 연속 통과
- [x] AC-4: 실행 뒤 e2e DB 모든 테이블 행 수·md5가 시작 상태와 같다. 중단 뒤 다음 실행 시작 때 남은 테스트 데이터를 지운다
- [x] AC-5: 기존 단위 테스트·lint·typecheck·build 통과, 제품 코드 변경 없음

## 구현 계획

- `playwright.config.ts`, `tests/e2e/support/`(env 가드·https 프록시 서버·DB·API·기록·픽스처·화면 도우미), `tests/e2e/api/`(API만, chromium에서만), `tests/e2e/*.spec.ts`(화면)
- devDependencies: `@playwright/test`(1.64.1), `pg`(8.23.0, 앱이 이미 쓰는 버전), `@types/pg`
- npm 스크립트: `test:e2e`, `test:e2e:chromium`·`:webkit`·`:mobile`, `test:e2e:migrate`, `test:e2e:install`
- `.gitignore`: `.env.e2e`, `test-results/`, `tests/e2e/.state/`

## 검증 계획

- `npm run test:e2e` 2회 연속(프로젝트별 실행 시간 기록), `npm run test`·`lint`·`typecheck`·`build`
- `.env.e2e` 없음·개발 DB와 같음 거부 확인
- 실행 중단 → 다음 실행 시작 때 정리 확인

## 미정 사항

- CI 연결(DB 비밀값) — 이번에는 넣지 않는다

## 결과

AC-1~5 모두 충족. 검증 근거는 `context/current-feature.md` 완료 이력(2026-11-11 — 배포 전 정리 2: 통합 테스트) 참고.
