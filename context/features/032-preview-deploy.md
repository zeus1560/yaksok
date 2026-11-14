# 배포 전 정리 3 — 미리보기 배포

## 식별자와 상태

- 스펙 ID: `032-preview-deploy`
- 상태: 진행 중 — 1부(저장소 이전·배포 준비 코드·배포 안내 문서)와 2부(배포된 주소로 확인·문서 반영·`main` 배포 끄기·함수 지역 고정·휴대폰 체크리스트) 구현·검증 완료. AC-7 충족(2026-11-12, 함수 지역 `sin1` 배포 5c90481에서 `@smoke` 9개 2회 연속 통과 — 테스트 도우미 판정 수정 뒤). 남은 것: 아이폰 Safari 확인(기기 없음 — 공개 배포 전 팀원 아이폰으로, 안드로이드는 2026-11-15 확인), `main` 병합 뒤 운영 배포가 생기지 않는지 확인, 취소와 겹친 조회의 401(다음 수정 PR)
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 배포 방식: `DECISION_CONFLICTS.md` R-05(Vercel + Neon), `docs/architecture/TECH_STACK.md`
- CSRF·Origin: `docs/specs/API_CONVENTIONS.md` 7절, 403 `INVALID_ORIGIN`(3절), 001 범위 밖 항목 「미리보기 배포 Origin 허용」
- 초대 주소: MEMBER-API-09 `inviteUrl`(`docs/specs/api/member.md`)
- no-store: API_CONVENTIONS 3절, 031 메모(`/api/health` 누락)
- 통합 테스트 구조·DB 가드: 031
- 관련 결정: R-36(이번에 신설)

## 사용자와 문제

브랜치를 Vercel 미리보기로 띄워 실제 배포 환경에서 확인하려 한다. 그런데 Origin 검사와 초대 링크가 `NEXT_PUBLIC_BASE_URL` 하나에 묶여 있어 배포마다 주소가 바뀌는 미리보기에서는 모든 상태 변경 요청이 403이 되고 링크도 다른 주소로 나간다. 팀 저장소는 Vercel Hobby로 배포할 수 없고, 배포된 주소에 통합 테스트를 돌릴 방법과 따라 할 배포 안내도 없다.

## 목표와 범위

- 1부 (이번) 0. 저장소 이전: 개인 저장소 `zeus1560/yaksok`을 `origin`, 팀 저장소를 `team`으로. `main`만 옮긴다(열린 `ahn/` 브랜치는 옮기지 않음). 스킬·CLAUDE.md의 원격 이름 정리
  1. 배포 준비 코드: 허용 Origin 목록(로컬·운영·Vercel 미리보기)과 초대 링크 기준 주소를 순수 함수로(`lib/public-url.ts`), Origin 검사·링크 발급·완료 화면이 사용. 빌드(Prisma generate 위치·Node 24) 확인. 미리보기 DB 수동 마이그레이션 명령, `.env.preview` Git 제외. 저장소 문서의 배포 대상 Vercel로
  2. 배포 주소 테스트 준비: `E2E_TARGET=preview`·`E2E_BASE_URL` — webServer 없음, DB 도우미는 `.env.preview`(개발 DB와 같으면 거부), 묶음 `@smoke`, Vercel 보호 우회 헤더
  3. 배포 안내 문서 `docs/architecture/DEPLOY.md`
- 2부: 사용자가 Vercel을 설정한 뒤
  1. 배포된 주소로 `@smoke` 실행·확인(2회 연속 통과 목표), 실패 원인 구분(배포 설정·코드·테스트), 미리보기 DB 정리 확인
  2. 겪은 일을 문서에 반영: 첫 배포가 Production으로 잡힌 일과 해결, 대시보드 직접 배포 주의, 한글 브랜치 이름과 브랜치 주소, 테스트는 배포 고유 주소, 브랜치 이름 영어 규칙(`<이름>/<타입>-<영어 설명>`), 스키마 PR은 push 전 `db:deploy:preview`
  3. `main` 병합 뒤 운영 배포 끄기(`vercel.json`)와 다시 켜는 방법
  4. 휴대폰 확인 체크리스트 `docs/architecture/MOBILE_CHECKLIST.md`
- 하지 않을 일: Vercel 설정(사용자), 운영 DB·운영 환경변수, 공개 배포, 노션 PRD 수정(사용자), 빌드에 마이그레이션 넣기

## 선행 작업

031(PR #36 병합). 이 브랜치 첫 커밋은 031 완료 기록(90fe993). 요청의 「fix 002」는 아직 하지 않은 작업으로 확인됨.

## 수용 기준

- [x] AC-0: 새 `origin`의 `main` 해시 = 로컬 `main`(94e9568), 옛 원격은 `team`. 브랜치 `ahn/feat-미리보기-배포`는 `origin/main`에서 생성
- [x] AC-1 (API_CONVENTIONS 7절, R-36): 허용 Origin = 로컬·운영 `NEXT_PUBLIC_BASE_URL`(운영은 `VERCEL_PROJECT_PRODUCTION_URL` 포함), 미리보기 `VERCEL_URL`·`VERCEL_BRANCH_URL`(https). 그 밖은 403 `INVALID_ORIGIN`. 순수 함수 단위 테스트
- [x] AC-2 (MEMBER-API-09, R-36): 미리보기 배포에서 초대 링크는 요청이 온 그 배포 주소, 로컬·운영은 그대로 `NEXT_PUBLIC_BASE_URL`. 완료 화면도 같은 기준
- [x] AC-3: Vercel 빌드가 `npm run build`로 Prisma Client를 만들고 Node 24(`engines`)를 쓴다는 근거를 문서에. 마이그레이션은 `npm run db:deploy:preview`(`.env.preview`, 개발·e2e DB면 거부), `.env.preview` Git 제외
- [x] AC-4: `npm run test:e2e:preview`가 서버 없이 `E2E_BASE_URL`에 `@smoke` 묶음을 돌리고, DB 도우미는 `.env.preview`, 보호 우회 헤더를 보낸다. `.env.preview`가 개발 DB와 같으면 시작하지 않는다
- [x] AC-5: DEPLOY.md에 Neon 미리보기 브랜치·`.env.preview`·마이그레이션·Vercel 가입·불러오기·빌드·Node·환경변수 표·보호 우회·배포 후 확인·운영 주소 비공유
- [x] AC-6: 단위 테스트(PowerShell)·lint·typecheck·build, `TZ=UTC`·`America/Los_Angeles` 통과, 로컬 `test:e2e` 세 프로젝트 1회 회귀 없음
- [x] AC-7 (2부): 배포된 미리보기 주소에서 `@smoke` 9개 2회 연속 통과 — 2026-11-12 배포 5c90481(함수 지역 `sin1`, `/api/health` 112~198ms)에서 9/9 두 번 연속(2.2분·2.4분). 경과: ① 배포 522784f(함수 지역 `iad1`)는 2회 모두 8/9 — 함수 지역 ↔ DB 지연(배포 설정) → `vercel.json` `regions`로 해결. ② 배포 5c90481도 처음 2회는 8/9 — 테스트 문제: `expectPollReflects`가 취소 커밋 직후 도착한 새 값(409) 폴링을 기준 시각(`mark()`) 전이라고 버려, 폴링이 멈춘 화면에서 다음 응답을 20초 기다리다 실패. 새 값이면 받도록 판정을 고친 뒤 통과(`tests/e2e/support/fixtures.ts`)
- [x] AC-8 (2부): DEPLOY.md에 Production으로 잡힌 첫 배포와 해결(새 커밋 push), 대시보드 직접 배포 주의, 한글 브랜치 이름의 브랜치 주소 겹침과 배포 고유 주소 사용, 스키마 PR의 push 전 `db:deploy:preview`, 함수 지역 확인 방법
- [x] AC-9 (2부): 브랜치 이름 규칙 `<이름>/<타입>-<영어 설명>` — CLAUDE.md, `/feature` start·complete, `context/ai-interaction.md`, SETUP.md 4-1. 이미 만든 브랜치는 그대로
- [x] AC-10 (2부): `vercel.json` `git.deploymentEnabled.main: false`와 DEPLOY.md 9절 「다시 켜는 방법」. 실제로 `main` 배포가 멈추는지는 병합 뒤에만 확인 가능(남은 확인)
- [x] AC-12 (2부): 함수 지역을 `vercel.json` `"regions": ["sin1"]`로 고정, DEPLOY.md 3절 ⑤는 「저장소 `vercel.json`이 기준, 대시보드 설정은 참고」. 배포 5c90481에서 확인 — 시작 줄 `함수 지역 sin1`(4회 모두), `/api/health` 112~198ms(`iad1`일 때 453ms), 화면 조회 API 0.11~0.38초(`iad1`일 때 2.4~5.5초)
- [x] AC-11 (2부): `docs/architecture/MOBILE_CHECKLIST.md` — 휴대폰에서 여는 방법(Vercel 로그인·Share 링크), 항목마다 기대 결과와 아이폰·안드로이드 결과 칸

## 데이터와 인터페이스

- DB 스키마 변경 없음
- `POST /api/v1/links`: 미리보기에서 `inviteUrl` 기준 주소가 요청 Origin(허용된 배포 주소). 계약(필드)은 같음
- `GET /api/health`: `Cache-Control: no-store` 추가, DB 실패는 503 `{ ok: false }`
- 환경변수(Vercel 시스템): `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `NEXT_PUBLIC_VERCEL_ENV`. 로컬 `.env.preview`: `DATABASE_URL`, `DIRECT_URL`, `E2E_BASE_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`

## 구현 계획

- `lib/public-url.ts`(+ 테스트) → `lib/origin.ts`, `lib/member/invite-link.ts`, `app/api/v1/links/route.ts`, `components/create-promise/done-card.tsx`, `app/api/health/route.ts`
- `tests/e2e/support/e2e-env.ts`(대상·가드), `api.ts`·`fixtures.ts`(헤더·쿠키 도메인), `db.ts`·`global-setup.ts`(대상 DB·배포 응답 확인), `migrate.ts`(`--preview`·`--status`), `run-preview.ts`, `playwright.config.ts`, `tests/e2e/api/smoke.spec.ts`, 기존 테스트에 `@smoke`
- npm: `test:e2e:preview`, `db:deploy:preview`, `db:status:preview`
- 문서: DEPLOY.md(신규), TECH_STACK·SETUP·PRD 사본·API_CONVENTIONS·member.md·time.md·DECISION_CONFLICTS(R-36·7절)·docs/README·CLAUDE.md·`/feature` 스킬

## 검증 계획

- TDD: `lib/public-url.test.ts` RED(빈 구현 → 기대값 불일치) → GREEN → REFACTOR
- `npm run test`(PowerShell), `TZ=UTC`·`TZ=America/Los_Angeles`, `lint`, `typecheck`, `prettier --check`, `build`
- `.env.preview` 가드: 임시 폴더로 없음·개발 DB·풀러 차이·DIRECT_URL만 개발 DB·e2e DB·주소 없음·http 거부, 정상·명령 환경변수 우선 허용
- 로컬 `npm run test:e2e` 세 프로젝트 1회(새 `smoke.spec` 포함)
- 2부: `npm run test:e2e:preview`

## 미정 사항

- 운영 공개·운영 DB·운영 도메인 — 팀 결정 대기(그 전에는 Production 환경변수를 넣지 않음)
- 휴대폰 확인(2026-11-15, MOBILE_CHECKLIST 「1차 확인 결과」): **안드로이드 Chrome 확인함** — 미리보기 주소에서 정상 동작, 시간 선택은 칸 탭·날짜 하루 토글(R-19 의도대로, 드래그는 PC 전용). **아이폰 Safari 미확인(기기 없음)** — 입력란 확대 방지(16px) 등은 **공개 배포 전에 팀원 아이폰으로 확인할 항목**으로 남김
- 미리보기를 팀원에게 보여 주는 방법(Hobby는 구성원 추가 불가) — 배포 화면 Share 링크(Hobby는 계정 전체 1개, 공식 문서 확인)를 MOBILE_CHECKLIST에 적음. 실제 동작은 휴대폰 확인 때 본다
- (2부에서 발견, **032에서는 고치지 않음 — 다음 수정 PR에서 fix 002와 함께 공통 인증 모듈을 고친다**, R-37) 취소 커밋과 겹친 조회가 409 `PROMISE_CANCELLED` 대신 401을 받을 수 있음 — `lib/member/session-auth.ts`가 약속 상태와 세션을 따로 읽기 때문(취소 409가 세션 401보다 우선이라는 순서가 동시 요청에서 어긋남). 화면은 401 뒤 링크를 다시 조회해 취소 안내로 가므로 사용자 결과는 같다. 쿼리 왕복이 0.2초인 배포(함수 지역 `iad1`)에서만 재현(2회차 실패). 고칠 방향: 401을 내기 전에 약속 상태를 다시 확인(사용자 결정, 2026-11-12)

## 결과

검증 근거는 `context/current-feature.md` 참고.
