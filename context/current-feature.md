# 현재 기능: 배포 전 정리 3 — 미리보기 배포 (032) 2부

## 상태

완료 (PR #1 병합 a393e87, 2026-11-15. 병합 뒤 `main`으로 새 Production 배포가 생기지 않음 — 사용자 확인, AC-10. 남은 일: 아이폰 Safari 확인은 공개 배포 전 팀원 아이폰으로(안드로이드는 2026-11-15 정상), 취소와 겹친 조회의 401은 이번 수정 PR `context/fixes/002`에서 처리)

## 스펙

`context/features/032-preview-deploy.md`

## 목표

브랜치를 Vercel 미리보기로 띄울 준비. 저장소를 개인 저장소로 옮기고(Vercel Hobby), Origin 검사·초대 링크를 배포 환경별로 결정(미리보기는 그 배포 주소), 미리보기 DB 수동 마이그레이션, 배포된 주소에 통합 테스트 확인 묶음(`@smoke`)을 돌릴 수 있게 하고, 따라 할 배포 안내(`DEPLOY.md`)를 쓴다.

## 수용 기준

스펙 `context/features/032-preview-deploy.md` AC-0~12 참고(AC-7~12는 2부, 모두 충족).

## 작업 기준점

- 원격: `team` = `yeonseong0224/yaksok`(옛 `origin`), `origin` = `zeus1560/yaksok`(새 개인 저장소). `main`만 push — 새 `origin/main` 94e9568 = 로컬 `main`(`git ls-remote`로 확인). 열린 `ahn/` 브랜치는 옮기지 않음(로컬 브랜치는 그대로 `team/…`을 추적)
- 브랜치: `ahn/feat-미리보기-배포` (`origin/main` 94e9568에서 생성, upstream 없음 — 첫 push 때 `-u origin`). PR #1 병합(a393e87)
- 준비 단계: 작업 트리 깨끗, `main` 22c648b → 94e9568 fast-forward, 원격이 사라진 로컬 `ahn/` 브랜치 없음(원격이 남은 로컬 `ahn/` 26개는 그대로)
- 커밋(사용자 확인 뒤): 90fe993 `docs: 031 완료 기록`(요청의 「fix 002」는 아직 하지 않은 작업으로 확인), 이어서 미리보기 배포 준비. `git push -u origin ahn/feat-미리보기-배포`

## 구성

- 순수 함수 `lib/public-url.ts`: `allowedOrigins(env)`(로컬·운영 `NEXT_PUBLIC_BASE_URL`, 운영 `VERCEL_PROJECT_PRODUCTION_URL`, 미리보기 `VERCEL_URL`·`VERCEL_BRANCH_URL` → https), `inviteBaseUrl(env, currentOrigin)`(미리보기는 요청이 온 배포 주소 → 브랜치 → 배포, 그 밖은 `NEXT_PUBLIC_BASE_URL` → 운영 도메인 → 현재 주소). 화면에서도 import
- 사용처: `lib/origin.ts`(허용 목록 대조), `lib/member/invite-link.ts`(`issueInviteLink(source, requestOrigin)`), `app/api/v1/links/route.ts`(검사 통과한 Origin 전달), `components/create-promise/done-card.tsx`(`NEXT_PUBLIC_VERCEL_ENV` + `window.location.origin`)
- `/api/health`: no-store, DB 실패 503 `{ ok: false }`
- 통합 테스트 대상: `tests/e2e/support/e2e-env.ts`(`E2E_TARGET` local·preview, `.env.preview` 가드 — 개발·e2e DB와 같으면 거부, `E2E_BASE_URL` https·경로 없음, 보호 우회 헤더), `api.ts`·`fixtures.ts`(헤더·쿠키 도메인 = 대상 호스트, 미리보기는 인증서 확인), `db.ts`·`global-setup.ts`(대상 DB, 미리보기는 시작 때 `/api/health` 확인), 실행 기록 `tests/e2e/.state/preview/` 분리, `playwright.config.ts`(미리보기: webServer 없음·`grep @smoke`·결과 `test-results/preview/`), `run-preview.ts`
- 묶음 `@smoke`: `api/smoke.spec.ts`(새: health·초대 링크 주소·다른 Origin 거부 5종 + 방장 등록), `api/production.spec.ts` 3개, `full-flow.spec.ts` — chromium 7개 + webkit 데스크톱·모바일 전체 흐름 각 1개
- npm: `test:e2e:preview`, `db:deploy:preview`, `db:status:preview`(`migrate.ts --preview [--status]`). `.gitignore` `.env.preview`
- 문서: `docs/architecture/DEPLOY.md`(신규), TECH_STACK 배포 절, SETUP(원격 두 곳·4-5 안내·배포 행), PRD 사본 6장, API_CONVENTIONS 3·7절, member.md `inviteUrl`, time.md Origin 행, DECISION_CONFLICTS R-36·7절, docs/README, `.env.example` 주석, CLAUDE.md(구조·배포·원격), `/feature` start·complete(원격 이름)

## 검증 결과

2026-11-12, Node.js 24, Playwright 1.64.1

| 단계                | 명령·방법                                                                                | 결과                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 저장소 이전         | `git push -u origin main`, `git ls-remote origin refs/heads/main`                        | 94e9568 = 로컬 `main`                                                                                                                                                                                            |
| TDD RED             | 빈 구현(`[]`·`null`)으로 `npx vitest run lib/public-url.test.ts`                         | 13개 중 11개 실패(기대값 불일치, 예: `expected [] to deeply equal [ 'http://localhost:3000' ]`, `expected null to be 'https://yaksok-abc123-team.vercel.app'`). 빈 값 2개는 통과                                 |
| GREEN·정리          | 구현 → `originOf`를 `lib/origin.ts`가 같이 쓰게 정리                                     | 13/13, 연결 테스트(route·invite-link) 포함 70/70                                                                                                                                                                 |
| 단위·정적           | `npm run test`(PowerShell), `TZ=UTC`·`TZ=America/Los_Angeles`, lint, typecheck, prettier | 1667 통과(이번 20건) ×3, 통과, 통과, 통과                                                                                                                                                                        |
| 빌드                | `npm run build` / `DATABASE_URL`·`DIRECT_URL` 빈 값으로 `next build`                     | 통과 / `Failed to collect page data for /api/health`로 실패(운영 첫 배포 예상 확인, DEPLOY.md 반영)                                                                                                              |
| `.env.preview` 가드 | 임시 폴더로 `loadPreviewEnv`·`loadPreviewDb`, `npm run db:status:preview`(파일 없음)     | 없음·개발 DB 같음·풀러 차이·DIRECT_URL만 개발 DB·e2e DB 같음·주소 없음·http 거부, 정상·명령 환경변수 우선 허용. 마이그레이션 명령도 prisma 실행 전에 멈춤                                                        |
| 목록                | `playwright test --list` / `--grep @smoke` / `E2E_TARGET=preview`(파일 없음)             | 102개 / 9개(chromium 7·webkit 전체 흐름 2) / 설정 단계에서 거부                                                                                                                                                  |
| 로컬 통합           | `npm run test:e2e`(빌드 포함, 세 프로젝트 1회)                                           | 99 통과, 2 건너뜀, 1 「예상과 다름」 — 알려진 실패(WebKit 드래그 0ms, `test.fail`)가 이번엔 재현되지 않고 통과. 13.9분, 스냅샷 동일. 같은 테스트 `--repeat-each=5` → 5/5 예상대로 실패(흔들림, 이번 변경과 무관) |
| 정리                | 포트 3000·3100·3101, `next`·playwright 프로세스                                          | 없음. `.next`는 `npm run build`로 일반 빌드                                                                                                                                                                      |

## 2부 구성 (커밋 전)

- `vercel.json`(신규): `"regions": ["sin1"]` — 함수 지역 고정(저장소가 기준, 대시보드 설정은 참고. DEPLOY.md 3절 ⑤), `git.deploymentEnabled.main: false` — `main` 자동 배포 끔. 다시 켜는 방법은 DEPLOY.md 9절
- `docs/architecture/DEPLOY.md`: 한눈에 보기(운영 배포·휴대폰 확인 행), 2절 스키마 PR은 push 전 `db:deploy:preview`(미리보기 DB는 모든 Preview가 공유), 3절 ⑤ 함수 지역 필수·`sin1`·확인 방법(`x-vercel-id`), 6절 배포 고유 주소 사용·Preview 표시 확인, 7절 Production으로 잡힌 배포와 해결(빈 커밋 push)·대시보드 직접 배포 주의, 8절 한글 브랜치 이름과 브랜치 주소, 9절 `main` 배포 끄기·다시 켜기, 문제 해결 4행
- `docs/architecture/MOBILE_CHECKLIST.md`(신규): 여는 방법 2가지(Vercel 로그인·Share 링크), 0~9절 78개 항목(기대 결과 + 아이폰·안드로이드 결과 칸), 확인하지 않는 것
- 브랜치 이름 `<이름>/<타입>-<영어 설명>`: CLAUDE.md, `/feature` start(이름 규칙·스키마 push 전 안내)·complete, `context/ai-interaction.md`, SETUP.md 4-1. docs/README 목차
- `tests/e2e/support/global-setup.ts`: 미리보기 시작 때 `/api/health` 응답 시간과 함수 지역(`x-vercel-id`) 출력, 300ms 초과면 경고. 안내 문구의 절 번호 4 → 5
- `tests/e2e/support/fixtures.ts`: `expectPollReflects` 판정 ② 수정 — 변경 중에 나가 있던 폴링이 새 값을 받아 오면 기준 시각(`mark()`)보다 먼저 도착했어도 받는다(전에는 버려서, 취소처럼 폴링이 멈추는 화면에서 다음 응답을 기다리다 시간 초과). 응답이 빠른 배포(`sin1`)에서 드러난 테스트 문제

## 2부 검증 결과

2026-11-12, 배포 522784f(Preview, Ready), 배포 고유 주소, 미리보기 DB 마이그레이션 최신(`db:status:preview`)

| 단계              | 명령·방법                                                                          | 결과                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| smoke 1회         | `npm run test:e2e:preview`                                                         | **8/9**, 6.4분. 실패: webkit 데스크톱 전체 흐름 — 제출 버튼이 「제출 중…」에서 10초 넘게 멈춤(PUT 응답 없음). 스냅샷 동일                                                                                                                            |
| smoke 2회         | 같은 명령                                                                          | **8/9**, 5.3분. 실패: webkit 데스크톱 전체 흐름 — 취소 뒤 참여자 한 명의 폴링이 409가 아니라 401을 받고 멈춰 20초 대기 초과. 스냅샷 동일                                                                                                             |
| webkit 데스크톱만 | `npm run test:e2e:preview -- --project=webkit-desktop`                             | 1/1, 3.9분 — 단독으로는 통과(WebKit 고유 문제 아님). 새 출력 `[e2e] 배포 응답: /api/health 453ms, 함수 지역 iad1` + 경고 확인                                                                                                                        |
| 원인              | 응답 헤더·trace                                                                    | `x-vercel-id: icn1::iad1::…` — 함수는 미국 동부, DB는 `ap-southeast-1`. DB 없는 요청 0.24초, `/api/health`(쿼리 1번) 0.45초, 화면 폴링 조회 2.4~5.5초. webkit 데스크톱·모바일 흐름이 동시에 돌 때(8개 화면 폴링) 실패. **배포 설정 문제**            |
| 실제 HTTPS 확인   | 통과한 API 확인 6개(2회 모두) + 직접 요청                                          | 세션 쿠키 `HttpOnly`·`Secure`·`SameSite=Lax`·`Path=/api/v1/promises/<id>`·Max-Age·Domain 없음, 다른 Origin 5종 403 `INVALID_ORIGIN`, 초대 링크 = 배포 주소이고 그 주소가 열림, GET API 성공·실패 모두 `no-store`(`x-vercel-cache: MISS`), health 200 |
| 미리보기 DB       | 실행마다 끝 비교 + 직접 조회                                                       | 3회 모두 「시작 상태와 동일」. 직접 조회도 마지막 시작 스냅샷과 같고 실행 기록 파일 없음. 남은 행(링크 4·약속 1·참여자 1·세션 1)은 테스트 전부터 있던 것(개발 DB에서 복사된 3개 + 15:11 손 확인 1개)                                                 |
| 단위·정적·빌드    | `npm run test`(PowerShell), lint, typecheck, `prettier --check .`, `npm run build` | 1667 통과(80파일), 통과, 통과, 통과, 통과. 포트 3000·3100·3101과 남은 `next`·playwright 프로세스 없음                                                                                                                                                |

### 함수 지역 `sin1` 배포에서 다시 확인

2026-11-12, 배포 5c90481(Preview, `vercel.json` `regions: ["sin1"]`), 배포 고유 주소

| 단계                                     | 명령·방법                                                                                                   | 결과                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| smoke 1회(수정 전)                       | `npm run test:e2e:preview`                                                                                  | **8/9**, 3.3분. 시작 줄 `/api/health 116ms, 함수 지역 sin1`. 실패: webkit 데스크톱 전체 흐름 「방장 취소 → 모두 취소 안내」 20초 대기 초과. 스냅샷 동일                                                                                                                                                                                                                                         |
| smoke 2회(수정 전)                       | 같은 명령                                                                                                   | **8/9**, 3.1분. `/api/health 119ms, 함수 지역 sin1`. 같은 단계 실패. 스냅샷 동일                                                                                                                                                                                                                                                                                                                |
| 원인(테스트 문제)                        | trace                                                                                                       | 취소 POST 응답(157ms)과 거의 동시에, 취소 커밋 직후 시작한 참여자의 폴링이 409 `PROMISE_CANCELLED`를 받아 옴(취소 응답보다 7~43ms 뒤). 테스트는 클릭이 끝난 뒤 `mark()`하므로 그 응답이 기준 시각 전에 도착 → `expectPollReflects`가 버림 → 화면은 취소 안내로 바뀌어 폴링이 멈춤 → 다음 응답 없음. 앱 동작은 정상(409 → 링크 재조회 → 취소 안내). `iad1`에서는 조회가 2~5초 걸려 가려져 있었음 |
| 수정                                     | `tests/e2e/support/fixtures.ts`                                                                             | 변경 전에 시작한 폴링도 새 값이면 받는다(새 값 = 서버가 이미 커밋). 변경 뒤에 시작한 폴링이 반드시 새 값이어야 한다는 판정 ①은 그대로                                                                                                                                                                                                                                                           |
| smoke 3회(수정 뒤)                       | 같은 명령                                                                                                   | **9/9**, 2.2분. `/api/health 112ms, 함수 지역 sin1`. 스냅샷 동일                                                                                                                                                                                                                                                                                                                                |
| smoke 4회(수정 뒤)                       | 같은 명령                                                                                                   | **9/9**, 2.4분. `/api/health 198ms, 함수 지역 sin1`. 스냅샷 동일 — **2회 연속 통과**                                                                                                                                                                                                                                                                                                            |
| 속도 비교                                | trace·시작 줄                                                                                               | `/api/health` 453ms → 112~198ms, 화면 조회 API 2.4~5.5초 → 0.11~0.38초, 묶음 5.3~6.4분 → 2.2~2.4분                                                                                                                                                                                                                                                                                              |
| 로컬 회귀(수정한 도우미를 쓰는 4개 파일) | `npx playwright test full-flow host-manage participant-finish availability-sync --project=chromium-desktop` | 18개 모두 통과(전체 흐름·시간 동기화 5개 + 방장 관리·참여자 마무리 13개, 2.0분), 스냅샷 동일. 앞선 두 번은 PC 절전으로 네트워크가 끊겨(`ERR_NETWORK_IO_SUSPENDED`, DB 주소 DNS 실패) 무효 — 끊긴 구간의 테스트만 다시 실행.                                                                                                                                                                     |
| 로컬 회귀(webkit 데스크톱)               | 같은 4개 파일 `--project=webkit-desktop`                                                                    | 18개 모두 예상대로(17 통과 + 알려진 실패 1 — 드래그 0ms 놓기 `test.fail`, 031), 5.2분, 끊김 없음, 스냅샷 동일. 끝난 뒤 `npm run build`로 일반 빌드                                                                                                                                                                                                                                              |
| 단위·정적·빌드                           | `npm run test`(PowerShell), lint, typecheck, `prettier --check .`, `npm run build`                          | 1667 통과(80파일), 통과, 통과, 통과, 통과. 포트 3000·3100·3101 사용 없음                                                                                                                                                                                                                                                                                                                        |

## 메모

- 2부에서 발견(032에서는 고치지 않음 — 이번 수정 PR `context/fixes/002`에서 공통 인증 모듈 수정, R-37): 취소 커밋과 겹친 조회의 401 — `session-auth.ts`가 약속 상태와 세션을 따로 읽어, 그 사이에 취소가 커밋되면 409 `PROMISE_CANCELLED` 대신 401. 화면 결과는 같음(401 뒤 링크 재조회 → 취소 안내). 스펙 미정 사항 참고
- Vercel 확인(공식 문서, 2026-11-12, 2부): `git.deploymentEnabled`(브랜치별 `false`, 적지 않은 브랜치 기본 `true`, minimatch), `regions`는 대시보드 Function Region보다 우선·Hobby는 한 지역·기본 `iad1`·싱가포르 `sin1`, 공유 링크는 모든 플랜(Hobby는 계정 전체 1개, 배포 화면 Share → Anyone with the link), Ignored Build Step은 건너뛴 빌드가 Canceled로 남음. 문서에 없는 것: `vercel.json`을 어느 커밋에서 읽는지, 브랜치 주소에서 한글이 지워지는 규칙(관찰로만 확인), 대시보드 Create Deployment의 대상 환경
- Vercel 확인(공식 문서, 2026-11-12): 시스템 변수 `VERCEL_ENV`·`VERCEL_URL`·`VERCEL_BRANCH_URL`·`VERCEL_PROJECT_PRODUCTION_URL`은 빌드·실행 모두, 스킴 없는 호스트. Next.js에 `NEXT_PUBLIC_VERCEL_ENV` 제공. 우회 헤더 `x-vercel-protection-bypass`, 비밀값은 Settings → Deployment Protection → Protection Bypass for Automation(모든 플랜), Vercel이 `VERCEL_AUTOMATION_BYPASS_SECRET` 자동 추가. Standard Protection은 운영 도메인을 막지 않음. Node 26.x 기본·24.x 선택 가능, `engines.node`가 설정보다 우선. Build Command는 `build` 스크립트 사용. Hobby는 조직의 비공개 저장소 배포 불가·커밋 작성자가 계정 주인이어야 함

## 완료 이력

이후 기록은 오래된 것부터 최신 순서로 맨 아래에 추가한다. 기존 기록을 삭제하지 않는다.

### 2026-11-04 — 웹 초대 링크 발급 API (MEMBER-API-09)

- 스펙: `context/features/001-link-issue-api.md`
- 브랜치: `ahn/feat-링크발급-api`
- 변경: `POST /api/v1/links` Route Handler, 내부 발급 함수 `lib/member/invite-link.ts`(source 인자, 웹은 `'web'` 고정, P2002 1회 재시도), 공통 헬퍼 `lib/api-error.ts`·`lib/origin.ts`, 공통 에러 코드 403 `INVALID_ORIGIN` 신설(API_CONVENTIONS·member.md), DECISION_CONFLICTS A-09 기록
- 검증: Vitest 15건 통과(2026-11-04 재실행), lint·typecheck·build 통과, 본인 개발 DB dev 서버 curl 201·403 확인, 실제 중복 삽입 P2002 확인
- 남은 제한: MEMBER-API-02·03·04·07의 Origin 실패 코드 통일(A-09), 미리보기 배포 Origin 허용 미정, IP 레이트 리밋 [제안] 미구현

### 2026-11-04 — 초대 링크 조회 API (MEMBER-API-01)

- 스펙: `context/features/002-link-lookup-api.md`
- 브랜치: `ahn/feat-링크조회-api`
- 변경: `GET /api/v1/links/[inviteToken]` Route Handler, 순수 판정 함수 `lib/member/link-status.ts`(기준 시각 3종 + 7일, draft 10분 만료 계산), 조회 서비스 `lib/member/link-lookup.ts`(형식 검사, DB 시각 `clock_timestamp()`), `isInviteTokenFormat`, `LINK_NOT_FOUND`·`LINK_EXPIRED` 헬퍼, 전 응답 `Cache-Control: no-store`, member.md 404 조건·no-store 명시
- 검증: Vitest 50건 통과, lint·typecheck·build 통과, 개발 DB 확인용 데이터로 curl 7건(200 3종·410·404 3종) 확인, GET 전후 4개 테이블 행 수·md5 동일, 확인용 데이터 삭제
- 남은 제한: IP 레이트 리밋 [제안] 미구현, 만료 draft 실제 삭제는 MEMBER-API-02 담당

### 2026-11-04 — 방장 등록 API (MEMBER-API-02)

- 스펙: `context/features/003-host-registration-api.md`
- 브랜치: `ahn/feat-방장등록-api`
- 변경: `POST /api/v1/links/[inviteToken]/host`, `registerHost` 트랜잭션(링크 → 약속 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, `resolveLinkStatus` 재사용, 만료 draft 세션 → 방장 → promise 삭제, P2002 → 409), 닉네임 trim → NFC → grapheme 2~12자·이모지 거절(`normalizeNickname` 공개), PIN scrypt N=2^15·r=8·p=1·maxmem 64MiB(`verifyPin` 공개), 세션 32바이트·SHA-256·24시간·쿠키, `+09:00` 시각 표기, 400·409·422 헬퍼. 문서: member.md(400·403 행, 닉네임 규칙, scrypt), API_CONVENTIONS 5.2 확정, DECISION_CONFLICTS R-10 신설·A-09 진행
- 검증: Vitest 112건, lint·typecheck·build 통과. 개발 DB에서 병렬 등록 2건 중 1건만 201, 만료 draft 재등록, 410·404·403, 실제 롤백, 저장값 `scrypt$32768$8$1$…`, 조합형 닉네임 완성형 응답 확인. 확인용 데이터 삭제
- 남은 제한: PIN 시도 제한(MEMBER-06-04 ❗미결), 잘못된 UTF-8 본문 거절 여부·`©`·`®`·`™` 거절(MEMBER-05-02 ❗미결), 레이트 리밋 [제안], A-09의 03·04·07

### 2026-11-04 — 참여자 재인증 API (MEMBER-API-04)

- 스펙: `context/features/004-participant-login-api.md`
- 브랜치: `ahn/feat-로그인-api`
- 변경: `POST /api/v1/promises/[promiseId]/auth/session`, `lib/member/login.ts`(순수 판정 `resolveLoginAccess` — PIN 전 상태 판정, cancelled 409·10분 지난 draft 404·`linkExpiryBase + 7일` 410 / `loginParticipant` — DB `clock_timestamp()`, 더미 해시 비교, 실패 반환 한 곳, 새 세션 행, P2003 → 404), `sessionMaxAgeSeconds`, 401·403·404·409·410 헬퍼. 문서: API_CONVENTIONS 3절 에러 코드(`PROMISE_CANCELLED`·`INVALID_PROMISE_STATE`)·5.2, member.md MEMBER-API-04, DECISION_CONFLICTS R-11 신설·C-07 안·C-10·C-11 신규·A-04 해결·A-09 04 완료
- 검증: Vitest 157건(이번 45건), lint·typecheck·build 통과. 개발 DB에서 조합형 닉네임 방장 등록 → 쿠키 없이 로그인 200·세션 2행, 저장 닉네임 NFC(U+D61C U+C2B9) 확인, 401 동일 본문, 403·404·400·422, 10분 지난 draft 404(삭제 없음), cancelled 409. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: PIN 시도 제한 미구현(공개 배포 전 필수 재검토), C-07 팀 확인 대기, C-10(확정 시 세션 갱신)·C-11(조기 마감 기준) 미결, member.md MEMBER-API-06 cancelled 코드 미정리

### 2026-11-04 — 설정 완료와 모집 시작 API (STATE-API-02)

- 스펙: `context/features/005-start-collecting-api.md`
- 브랜치: `ahn/feat-설정완료-api`
- 변경: `POST /api/v1/promises/[promiseId]/start`, 세션 인증 공통 모듈 `lib/member/session-auth.ts`(형식 400 → 404 → 취소 409 → 401 → 다른 약속 403, 인증 성공 후 모든 응답 쿠키 갱신 `withSessionCookie`), 설정 검증 `lib/state/start-settings.ts`(400 형식 / 422 규칙, R-07 3개월·시작일 ≥ 오늘), `lib/state/start-collecting.ts`(링크 → 약속 `FOR UPDATE`, 잠금 후 재확인, 만료 draft 삭제 커밋 + 410, 설정·collecting 저장, active 유효 세션만 마감 + 7일), 서울 날짜 헬퍼, 401·403·409(details)·410 `DRAFT_EXPIRED` 헬퍼. MEMBER-API-04: 만료 draft 404 → 410 `DRAFT_EXPIRED`(삭제 없음), promiseId 형식 오류 404 → 400. 문서: state.md STATE-API-02, member.md MEMBER-API-04, API_CONVENTIONS 3·5·5.2절, DECISION_CONFLICTS R-11 갱신·R-12 신설·A-09
- 검증: Vitest 273건(이번 116건), lint·typecheck·build 통과. 개발 DB에서 링크 발급 → 방장 등록 → 같은 쿠키로 설정 완료 200, Max-Age = 마감 + 7일까지 남은 초(차이 0초), 1440 저장, 만료 세션·cancelled 참여자 세션 유지, 401·403·400·422·409, 10분 지난 draft 로그인 410(행 유지)·설정 완료 410(삭제 커밋, 링크 unclaimed). 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 시작 날짜 하한 등 R-12 항목 STATE 담당자 구현과 비교 필요, 마감 입력 규칙(TIME-13-xx) 미결, API_CONVENTIONS 5.2 마감 연장 행은 STATE-API-03에서 정리, PIN 시도 제한 미구현

### 2026-11-04 — 참여자 등록 API (MEMBER-API-03)

- 스펙: `context/features/006-participant-registration-api.md`
- 브랜치: `ahn/feat-참여자등록-api`
- 변경: `POST /api/v1/promises/[promiseId]/participants`, `lib/member/participant-registration.ts`(순수 판정 `resolveJoinAccess`, `registerParticipant` — 잠금 전 존재·취소·기존 참여 확인, 해시 잠금 전, `promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, 닉네임 → 정원 순서, P2002 → 409, 세션 `linkExpiryBase + 7일`), `session-auth.ts` 선택적 확인 `findActivePromiseSession`, 409 5종 헬퍼. 모든 API 응답 `Cache-Control: no-store`(공통 `lib/no-store.ts`, links 발급·host·auth/session 누락 수정). `/feature` 시작 단계에 main 동기화 준비 절차 추가. 문서: member.md MEMBER-API-03, DECISION_CONFLICTS R-13 신설·A-09, API_CONVENTIONS 3절 no-store·5.2 참여자 등록 행
- 검증: Vitest 355건(이번 82건), lint·typecheck·build 통과. 개발 DB에서 링크 발급 → 방장 등록 → 설정 완료 → 참여자 등록 201, 병렬 정원·닉네임 경쟁 각 201 1건·409 1건, 응답 유실 → `NICKNAME_TAKEN` → 로그인 200, `ALREADY_PARTICIPANT`·위조 쿠키 진행, 403·400·422·404. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 상태별 거절·만료/cancelled 참여자 세션은 단위 테스트로만 확인, 레이트 리밋 [제안], PIN 시도 제한(MEMBER-06-04) 미구현

### 2026-11-05 — 가능 시간 제출 API (TIME-API-01)

- 스펙: `context/features/007-availability-submit-api.md`
- 브랜치: `ahn/feat-가능시간제출-api`
- 변경: `PUT /api/v1/promises/[promiseId]/me/availability`(Origin 403 → 256KB 413(Content-Length·실제 크기) → `session-auth.ts` 인증 → 본문 400 → 5,000개 422 → 형식 422, 인증 후 모든 응답 쿠키 갱신), `lib/time/slots.ts`(`parseSlotStrings` 상한·형식·중복 합침, `filterSlots` 지난 슬롯 무시·한국 날짜·하루 경계·24:00), `lib/time/submit-availability.ts`(`promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, cancelled → draft 410/409 → closed·confirmed → 마감 경과 closed 전환 커밋 + 409, 세션·참여자 재확인 401, 버전 충돌 409/재시도 200, 미래 슬롯만 교체·버전 +1), `toSeoulIsoMillisString`, 413·409 2종·422 2종 헬퍼. 슬롯 응답 표기는 초 단위로 통일(밀리초는 `submittedAt`만). 문서: time.md TIME-API-01 정렬·슬롯 표기·TIME-API-02 slots 형식, DECISION_CONFLICTS R-14 신설·C-08·A-05 해결·A-09, API_CONVENTIONS 3절 413 공통화
- 검증: Vitest 433건(이번 78건), lint·typecheck·build 통과. 개발 DB에서 링크 발급 → 방장 등록 → 설정 완료 → 참여자 등록 → 제출 200, 두 기기 같은 baseVersion 409, 재전송 200(버전 그대로), 지난 슬롯 보존·미래 교체, 마감 경과 closed 커밋 + 409, 403·413·400·422·401. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: draft·만료 draft·confirmed·cancelled·탈퇴 참여자·다른 약속 세션은 단위 테스트로만 확인, 슬롯 표기 통일 후 dev 서버 미재확인, 레이트 리밋 [제안] 미구현, TIME-API-02 draft 코드 정렬 남음

### 2026-11-05 — 가능 시간 현황 조회 API (TIME-API-02)

- 스펙: `context/features/008-availability-status-api.md`
- 브랜치: `ahn/feat-가능시간조회-api`
- 변경: `GET /api/v1/promises/[promiseId]/availability`(Origin 검사 없음, 모든 응답 no-store, `session-auth.ts` 순서 인증, 인증 후 모든 응답 쿠키 갱신), `lib/time/availability-status.ts`(REPEATABLE READ 읽기 트랜잭션 하나·잠금 없음·판정 시각 `now()`, cancelled 409 → draft 410/409 `PROMISE_NOT_OPEN`(삭제 없음) → 세션·참여자 재확인 401 → 마감 경과 collecting은 closed로 계산만, active 참여자 등록순, 제출자만 `availableSlots`, `me`는 제출 해제여도 저장 슬롯). 응답 표기: `serverTime` 밀리초 3자리, 마감·슬롯 초 단위, 1440 → `"24:00"`. 문서: time.md TIME-API-02 정렬·serverTime·REPEATABLE READ 확정·상태별 허용 표·시간 표기 규약, DECISION_CONFLICTS R-14 추가·A-06 해결. `/feature` 테스트 단계에 dev 서버 정리 규칙 추가(별도 커밋)
- 검증: Vitest 468건(이번 35건), lint·typecheck·build 통과. 개발 DB에서 링크 발급 → 방장 등록 → 설정 완료 → 참여자 3명 등록 → 일부 제출 → 조회 200(등록순, 빈 제출·미제출 모두 [], 24:00, 초 단위 슬롯, no-store, Max-Age 일치), 다른 기기 제출 후 `me.version` 1 → 2, 제출 해제·탈퇴·마감 경과(DB collecting 유지)·closed·confirmed·cancelled·draft·400·401·404 확인. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 10분 경계 draft·다른 약속 세션 403·트랜잭션 안 재확인 401은 단위 테스트로만 확인, 레이트 리밋 [제안]·ETag 304(P1) 미구현, time.md 코드 예제는 정렬 전 코드 그대로

### 2026-11-06 — 약속 만들기 화면 (홈 → 방장 등록 → 설정 → 완료)

- 스펙: `context/features/009-create-promise-ui.md`
- 브랜치: `ahn/feat-약속만들기-화면` (PR #14 병합)
- 변경: 홈(`app/page.tsx`), `/p/[inviteToken]` 클라이언트 분기(등록·대기 폴링·설정·완료·404/410·임시 참여), `components/create-promise/*`·`components/common/ui.tsx`, 화면용 순수 로직 `lib/create-promise/{countdown,date-range,deadline,format,start-failure,time-options}.ts`. 설정 완료 실패는 에러 코드로 분기. 문서: DECISION_CONFLICTS R-15·R-16 신설·C-04 해결, TIME.md TIME-13-02 확정, 미결 80 → 79. 같은 PR에 `CLAUDE.md` 작업 규칙 정리(docs 커밋)
- 검증: Vitest 521건(이번 53건), lint·typecheck·build 통과(2026-11-05). 브라우저(Playwright + 로컬 Chromium)에서 전체 흐름·화면 검증·새로고침 복원·다른 브라우저 대기 폴링·마감 기본값·소요 시간 자동 감소·정원 보정·10분 초과 410·390px 한 열·잘못된 링크 확인. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 만료 링크 410 화면·서버 422 입력란 표시·1분 이하 강조 색·실제 휴대폰 미확인. 다른 기기·저장소 삭제 시 방장 복원 불가 → 010에서 해결

### 2026-11-06 — 내 참여 정보 조회 API (MEMBER-API-05)와 방장 복원 전환

- 스펙: `context/features/010-me-api.md`
- 브랜치: `ahn/feat-내정보조회-api` (PR #15 병합)
- 변경: `GET /api/v1/promises/[promiseId]/me`(Origin 검사 없음, no-store, 인증 후 모든 응답 쿠키 갱신), `lib/member/me.ts`(세션·참여자·약속·`clock_timestamp()`를 SQL 한 문장으로 재조회, 소속 대조), `lib/member/me-permissions.ts`(`isDeadlinePassed` 경계 = 마감 시각 포함, `computeMePermissions`), `session-auth.ts` `allowCancelled` 옵션(취소된 약속 200용, 기본 동작 그대로). 화면: `/p/[inviteToken]`이 링크 조회 후 `/me`로 draft 방장을 설정 화면으로 보내고, 그 외·`/me` 실패는 `nextAction`대로(`lib/create-promise/invite-view.ts`). 저장소는 같은 promiseId일 때만 카운트다운 기준값으로 쓰고, 없으면 "등록 후 10분 안에 설정을 마쳐야 합니다". 문서: DECISION_CONFLICTS R-17 신설, 009 완료 처리
- 검증: Vitest 577건(이번 56건), lint·typecheck·build 통과. 브라우저에서 다른 브라우저 대기(`/me` 401), 저장소 삭제 후 설정 화면 복원·카운트다운 숨김·완료까지 진행, 완료 후 `/me` role=host, 다른 약속 쿠키 403·401, `/me` 500 동안 대기 → 해제 후 다음 폴링에서 설정 화면 복귀·카운트다운 이어짐, 만료 draft 뒤 새 방장 등록 시 처음 브라우저 대기 유지. 개발 DB로 마감 경과 `deadlinePassed` true·취소 약속 200·세션 만료 401. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 실제 휴대폰, 10분 지난 draft에 `/me` 직접 호출(200 draft, 명세에 410 없음), cancelled 참여자 응답은 C-07 팀 확인 대기

### 2026-11-06 — 참여 경로 화면 (참여자 등록·로그인·도착)

- 스펙: `context/features/011-participate-ui.md`
- 브랜치: `ahn/feat-참여화면` (PR #16 병합)
- 변경: `components/participate/participant-auth-card.tsx`(등록·로그인 카드, `NICKNAME_TAKEN` → 같은 값 로그인 1회 판별), `components/participate/arrived-card.tsx`(`/me` 기준 닉네임·방장 표시, 시간 입력 자리), `invite-flow.tsx`(등록·마감·취소 안내, draft 대기 화면 방장 로그인), 실패 분기 순수 함수 `lib/participate/failure.ts`, `invite-view.ts` 화면 종류 `join`·`arrived`·`closed`·`cancelled`. 문서: DECISION_CONFLICTS R-18 신설
- 검증: Vitest 613건(이번 36건), lint·typecheck·build 통과. 브라우저(390px)에서 등록 → 도착, 닉네임 중복 → 로그인 전환, 응답 유실 두 경우(`NICKNAME_TAKEN` → 자동 로그인 / `ALREADY_PARTICIPANT` → 재조회), 다른 기기 로그인, 정원 초과·마감 경과·closed·cancelled 안내, 방장 새로고침 → 도착, draft 대기 화면 방장 로그인 → 설정, PIN 노출 없음. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 실제 휴대폰(숫자 키패드), `ACCESS_PERIOD_EXPIRED`·`PARTICIPANT_CANCELLED`·`DRAFT_EXPIRED` 로그인 화면은 단위 테스트로만 확인, PIN 분실·시도 제한 미결

### 2026-11-06 — 가능 시간 입력 화면 (내 시간 입력·모두의 시간·폴링 동기화)

- 스펙: `context/features/012-availability-input-ui.md`
- 브랜치: `ahn/feat-시간입력` (PR #17 병합)
- 변경: 도착 화면을 가능 시간 화면으로 교체 — `components/availability/*`(보드·내 그리드·모두의 그리드·제출 바), 화면용 순수 로직 `lib/availability/{grid,sync,heat,failure,poll}.ts`. 마우스 드래그 사각형 선택, 터치 탭 + 날짜 머리글 하루 토글, 로컬 임시 입력 `{ v: 1, baseVersion, slots }`, SWR 5초 폴링(새 의존성 `swr@2.5.1`)과 버전 비교, 409 충돌 details 반영, 마감·확정 읽기 전용, 실패 분기는 에러 코드 기준. 완료 화면 "내 가능 시간 입력하기" 연결. 문서: DECISION_CONFLICTS R-19 신설
- 검증: Vitest 708건(이번 95건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 브라우저(데스크톱 1280px·390px)에서 드래그·탭·하루 토글, 새로고침 복원, 다른 브라우저 반영, 두 기기 버전 비교·409 충돌, 응답 유실 재시도 200, 빈 선택 확인, 지난 칸, 마감 경과(`VOTING_CLOSED`·카운트다운 0), confirmed·draft·cancelled·401, 폴링 실패 유지·탭 숨김 중지 확인. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 실제 휴대폰, Figma 시간 입력 화면 대조, 범위 밖 제외 안내(`droppedSlotCount ≥ 1`)는 범위 변경 API가 없어 단위 테스트로만 확인

### 2026-11-06 — 공식 시간 후보 조회 API (STATE-API-10)

- 스펙: `context/features/013-candidates-api.md`
- 브랜치: `ahn/feat-후보조회-api` (PR #18 병합)
- 변경: `GET /api/v1/promises/[promiseId]/candidates?limit&offset`(이 약속의 active 참여자, Origin 검사 없음, no-store, 인증 후 모든 응답 쿠키 갱신), 후보 계산 순수 함수 `lib/state/candidates.ts`(active + 제출자만, 30분 경계 시작 > 계산 시각, 같은 날짜 하루 범위 안, 슬롯별 참여자 비트 집합 교집합, 2명 이상, 인원 내림차순 → 시작 오름차순), `lib/state/candidate-page.ts`(limit 1~5·offset ≥ 0 10진 정수만, total·hasMore·nextOffset), `lib/state/promise-candidates.ts`(REPEATABLE READ 읽기 트랜잭션 하나·잠금 없음·계산 시각 `now()`), `session-auth.ts` `isPromiseIdFormat` 공개. 문서: DECISION_CONFLICTS R-20 신설, state.md STATE-API-10 구현 결정
- 검증: Vitest 808건(이번 100건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과, 30명·93일·00:00~24:00 계산 테스트 231ms. 개발 DB에서 마감 전 409, 마감 경과(DB collecting 유지)·closed 200 후보 5개(교집합 1명 구간·탈퇴자·제출 해제자 슬롯 제외), 페이지 이동·offset 초과, 422·400·404·401·403·draft 409·confirmed 409·cancelled 409(세션보다 우선), 후보 없음 200 확인. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 10분 지난 draft 호출·트랜잭션 안 재확인 401·약속 행 소실 404는 단위 테스트로만 확인, 동시 쓰기 중 스냅샷 일관성은 코드(REPEATABLE READ)로만, 겹치는 후보 묶기(RESULT-07-02 ❗미결)는 결과 화면 PR 몫

### 2026-11-06 — 약속 상태와 설정 조회 API (STATE-API-01)

- 스펙: `context/features/014-promise-detail-api.md`
- 브랜치: `ahn/feat-상태조회-api` (PR #19 병합)
- 변경: `GET /api/v1/promises/[promiseId]`(이 약속의 active 참여자, draft는 현재 host만, Origin 검사 없음, no-store, 인증 후 모든 응답 쿠키 갱신), 응답 조립 순수 함수 `lib/state/promise-view.ts`(effectiveStatus, `draftExpiresAt` = created_at + 10분·`draftExpired`, settings 매핑·24:00, `currentConfirmation`·`hostActionRequired`), `lib/state/promise-detail.ts`(REPEATABLE READ 읽기 트랜잭션 하나·잠금 없음·판정 시각 `now()`, 세션·역할 재확인, 확정 구간 슬롯만 조회), `lib/state/candidates.ts` `countAvailableParticipants` 공개(`buildSlotIndex`·`countCommon`을 후보 계산과 공유). 문서: DECISION_CONFLICTS R-21 신설, state.md STATE-API-01 구현 결정
- 검증: Vitest 881건(이번 73건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 35건 — draft 방장·10분 지난 draft 200 `draftExpired`(DB 변경 없음), 마감 경과 closed 계산(DB collecting 유지), settings 매핑·24:00, confirmed 인원 3·1·소요 시간 변경·과거 확정 시각, `hostActionRequired` 방장만 true, 탈퇴 반영, draft 비방장 403, 401·403·404·400, cancelled 409(세션보다 우선). 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 트랜잭션 안 재확인 401·약속 행 소실 404·인증 뒤 역할 변경은 단위 테스트로만 확인, confirmed는 확정 API가 없어 DB 직접 설정으로만 재현, 동시 쓰기 중 스냅샷 일관성은 코드(REPEATABLE READ)로만

### 2026-11-07 — 세션·링크 만료 계산 통합 리팩터링

- 스펙: `context/features/015-access-expiry-refactor.md`
- 브랜치: `ahn/refactor-만료계산-통합` (PR #20 병합)
- 변경: 순수 함수 `accessExpiresAt`(`lib/member/link-status.ts`, `linkExpiryBase + 7일`)을 링크 410·로그인 410·로그인 세션·참여자 등록 세션이 함께 씀, 세션 일괄 갱신 헬퍼 `refreshActiveSessions`(`lib/member/session-expiry.ts`, active 참여자의 유효 세션만)를 모집 시작이 씀, `SESSION_AFTER_DEADLINE_MS` 제거, draft 세션 24시간 이유 주석. API 응답·DB 스키마·화면 변경 없음. 문서: DECISION_CONFLICTS C-10(A안)·C-11(B안) 잠정 기록
- 검증: Vitest 888건(이번 7건, 기존 기대값 수정 없음), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB에서 리팩터링 전·후 같은 스크립트 25개 항목 결과 동일(모집 시작 세션 = 마감 + 7일, 로그인·참여자 등록 세션 = 링크 만료, 만료·탈퇴 참여자 세션 미갱신, 링크 410·로그인 410 경계). 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 확정 시 세션 갱신(C-10 A안)은 확정 API가 없어 단위 테스트로만 확인, C-10·C-11 팀 확정 필요, 명세 문구(5.2 표·state.md)는 04·05에서 수정

### 2026-11-07 — 방장 마감 API (STATE-API-04)

- 스펙: `context/features/016-close-voting-api.md`
- 브랜치: `ahn/feat-조기마감-api` (PR #21 병합)
- 변경: `POST /api/v1/promises/[promiseId]/close`(현재 active host, Origin 필수, 본문 없음, no-store, 인증 후 모든 응답 쿠키 갱신), `lib/state/close-voting.ts`(`promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, 잠금 후 취소·세션·active·host 재확인, collecting은 조기·기한 경과 모두 `status='closed'`만 저장, 이미 closed면 변경 없이 200, draft·confirmed 409). C-11 잠정 B안 — 세션·`voting_deadline_at` 그대로. 문서: API_CONVENTIONS 5.2 조기 마감 행·미결 문단, state.md STATE-API-00 세션 계약·STATE-API-04 처리 순서 3, DECISION_CONFLICTS C-11 수정 위치
- 검증: Vitest 933건(이번 45건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 57개 항목 — 조기·기한 경과·중복 마감 200(세션·마감 시각 그대로), 403·409·401·404·400, 조기 마감 상태를 링크·`/me`·제출·현황·후보·상태 조회가 모두 closed로 다룸, 마감·제출 잠금 경쟁 두 방향, 같은 방장 병렬 마감 둘 다 200·변경 한 번. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: C-11 B안·EXCEPTION-06-01 팀 확정 필요, 시간 입력 화면이 조기 마감 뒤에도 설정 마감 시각(미래)을 함께 표시함(화면 PR에서 처리), 마감 버튼 화면 없음

### 2026-11-07 — 최종 일정 확정 API (STATE-API-05)

- 스펙: `context/features/017-confirm-schedule-api.md`
- 브랜치: `ahn/feat-일정확정-api` (PR #22 병합)
- 변경: `POST /api/v1/promises/[promiseId]/confirmation`(현재 active host, Origin 필수, 본문 `{ startAt }`, no-store, 인증 후 모든 응답 쿠키 갱신), 후보 한 개 판정 `evaluateStart`를 `computeCandidates`와 확정 검증 `validateCandidateStart`가 공유(`lib/state/candidates.ts`), 시작 시각 형식 검증 `lib/state/confirm-input.ts`, `lib/state/confirm-schedule.ts`(`promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`·재확인, 마감 지난 collecting은 closed 먼저 저장, closed만 허용, `confirmed_start_at`·confirmed 함께 저장), 422 `INVALID_CONFIRMATION_CANDIDATE` 신설. C-10 잠정 A안 — 같은 트랜잭션에서 active 참여자의 유효 세션만 `confirmed_start_at + 7일`. 문서: API_CONVENTIONS 5.2 확정 행, state.md STATE-API-05 처리 순서, DECISION_CONFLICTS C-10
- 검증: Vitest 1050건(이번 117건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, 전수 비교 테스트 민감도 확인, lint·typecheck·build 통과. 개발 DB 실제 호출 57개 항목 — 상위 5개 밖 후보 200, 오프셋 표기 동일 결과, 무효 후보 422 5종, 409·403·401·404·400, 마감 지난 collecting closed 커밋, 세션 = 확정 + 7일(탈퇴·만료 세션 그대로), 확정 후 상태·링크·`/me`·후보 조회 연결, 병렬 확정 200·409. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: C-10 A안 팀 확정 필요, 확정 화면 없음(018에서 구현)

### 2026-11-08 — 마감·후보·확정·결과 화면 (화면 PR 4)

- 스펙: `context/features/018-result-ui.md`
- 브랜치: `ahn/feat-결과화면` (PR #23 병합)
- 변경: 참여 뒤 화면이 상태 조회(STATE-API-01) 5초 폴링(요청 시작 간격 보정, 탭 숨김 중지)으로 시간 입력(collecting)·후보(closed)·결과(confirmed)를 고른다(`components/result/promise-room.tsx`). 방장 전용 마감 버튼(STATE-API-04), 후보 상위 5개 + 더 보기·방장 확정 버튼·방장 불참 안내(STATE-API-10·05), 결과 화면(한국 시간·공통 가능 인원·초대 링크 복사·방장에게 `hostActionRequired` 경고), closed·confirmed 모두의 시간 읽기 전용과 머리글 "응답 마감됨"(012 이월). 화면용 순수 로직 `lib/result/{view,failure,format,poll-delay}.ts`, 실패 분기는 에러 코드 기준. API·DB 변경 없음. 문서: DECISION_CONFLICTS R-24 신설
- 검증: Vitest 1123건(이번 73건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 브라우저(Playwright + 로컬 Chromium, 방장 1280px·참여자 390px) 48개 항목 2회 — 마감·후보·더 보기·확정·422 후보 재조회·응답 유실 후 409 → 결과 화면·`hostActionRequired`·초대 링크 복사·폴링 간격 5.01~5.02초·탭 숨김 중지·500 동안 마지막 값 유지·390px 가로 스크롤 없음. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 실제 휴대폰, RESULT-11-02(목록 밖 후보 확정) 팀 확인 필요(R-24), 재조율·취소·탈퇴 버튼 없음

### 2026-11-08 — 약속 취소 API (STATE-API-07)

- 스펙: `context/features/019-cancel-promise-api.md`
- 브랜치: `ahn/feat-약속취소-api` (PR #24 병합)
- 변경: `POST /api/v1/promises/[promiseId]/cancel`(현재 active host, Origin 필수, 본문 읽지 않음, no-store), `lib/state/cancel-promise.ts`(`promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`·재확인, `status='cancelled'`·`cancelled_at` 한 문장 저장, 설정·참여자·슬롯·확정 일정 보존, 10분 지난 draft 410 `DRAFT_EXPIRED`), 세션 일괄 만료 `expireAllSessions`(`lib/member/session-expiry.ts`, 참여자 상태와 관계없이 유효 세션만 `expires_at`=취소 시각), 요청자 쿠키 Max-Age=0. 문서: state.md STATE-API-07 구현 결정, API_CONVENTIONS 5.2 취소 행, DECISION_CONFLICTS R-25 신설·C-12 신규
- 검증: Vitest 1167건(이번 44건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 100개 항목 — 네 상태 취소 200, 보존 항목 전후 동일, 유효 세션만 만료(이미 만료된 세션 그대로), 취소 뒤 세션 API·로그인·참여자 등록 409 `PROMISE_CANCELLED`·링크 `cancelled`·`/me` 401(C-12), 403·401·404·400·410, 취소·확정·제출 잠금 경쟁 두 방향, 같은 방장 병렬 취소 200 1건. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 취소 뒤 `/me` 401(C-12) 팀 결정 필요, 10분 지난 draft 410(R-25)은 명세 밖 판단, 취소 버튼 화면 없음

### 2026-11-08 — 재조율 시작 API (STATE-API-06)

- 스펙: `context/features/020-reopen-promise-api.md`
- 브랜치: `ahn/feat-재조율-api` (PR #25 병합)
- 변경: `POST /api/v1/promises/[promiseId]/reopen`(현재 active host, Origin 필수, no-store, 인증 후 모든 응답 쿠키 갱신), `lib/state/reopen-promise.ts`(`promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`·재확인, closed·confirmed·마감 지난 collecting(closed 먼저 저장) 허용, 확정 해제·범위 밖 슬롯 삭제·제출 해제·버전·설정·collecting·세션 새 마감 + 7일을 한 트랜잭션으로), 범위 변경 계산 순수 함수 `lib/state/range-change.ts`(03 공용), 부분 요청 파싱·합치기 `lib/state/settings-patch.ts`, `validateStartSettings` `checkStartDateFloor` 옵션(`dateRange`를 보낸 경우만 시작 날짜 하한), 422 `CAPACITY_BELOW_ACTIVE_COUNT` 신설, `isSlotInRange`(`filterSlots`와 공유). 문서: state.md STATE-API-06 구현 결정, API_CONVENTIONS 5.2 재조율 행, DECISION_CONFLICTS R-26 신설·X-05·C-10
- 검증: Vitest 1256건(이번 89건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 66개 항목 — 상태별 200, 확대·축소·이동·하루 범위·소요 시간만·마감만의 슬롯·제출·버전, 확정 해제와 세션(C-10 짧아짐 확인), 재조율 뒤 상태·링크·`/me`·후보·제출 연결, 422·409·403·401·404·400, 재조율·확정 잠금 경쟁 두 방향, 같은 방장 병렬 재조율 200 1건. 브라우저에서 버전 오른 참여자의 "다른 곳에서 내용이 바뀌었어요"·로컬 입력 폐기 확인. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: X-05(closed 재조율)·C-10(confirmed 재조율 시 세션 단축) 팀 확인 필요, 재조율 버튼 화면 없음

### 2026-11-09 — 모집 중 설정 변경 API (STATE-API-03)

- 스펙: `context/features/021-update-settings-api.md`
- 브랜치: `ahn/feat-설정변경-api` (PR #26 병합)
- 변경: `PATCH /api/v1/promises/[promiseId]/settings`(현재 active host, Origin 필수, no-store, 인증 후 모든 응답 쿠키 갱신), `lib/state/update-settings.ts`(collecting 유지, 정원 증가만·마감 연장만 422 `CAPACITY_DECREASE_NOT_ALLOWED`·`DEADLINE_SHORTEN_NOT_ALLOWED` 신설, 마감 연장 때만 세션 새 마감 + 7일), 재조율과 잠금·재확인·마감 경과 closed 저장·설정 합치기·범위 정리·설정 저장을 공유하는 `lib/state/settings-change.ts`(같은 SQL·같은 순서), `parseSettingsUpdate`·`validateCollectingChange`, `settingsViolation`·`buildSettingsView` 공유. 문서: state.md STATE-API-03 구현 결정·에러 표, API_CONVENTIONS 5.2 마감 연장 행, DECISION_CONFLICTS R-27 신설
- 검증: Vitest 1336건(이번 80건, 기존 기대값 수정 없음), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 90개 항목 — 정원·마감·범위(축소·확대·이동·하루 범위·소요 시간만·같은 값) 끝 상태, 변경 뒤 제출 버전 충돌, 마감 경과 409·closed 저장, 409·403·401·404·400·422, 제출·축소 잠금 경쟁 세 방향·같은 방장 병렬. 재조율 확인 스크립트 66개 항목 회귀 통과. 브라우저 32개 항목(버전 오른 참여자 안내·로컬 입력 폐기, 머리글 갱신). 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 정원 증가만·마감 연장만(TIME-14-03·04 ❗미결) 팀 확인 필요, 범위가 줄어도 버전이 그대로인 참여자의 로컬 입력이 "선택 N칸"에 세어짐(화면 PR 몫), 설정 변경 화면 없음

### 2026-11-09 — 본인 탈퇴와 자동 승계 API (STATE-API-08)

- 스펙: `context/features/022-withdraw-participant-api.md`
- 브랜치: `ahn/feat-탈퇴-api` (PR #27 병합)
- 변경: `DELETE /api/v1/promises/[promiseId]/participants/me`(active 참여자 본인, Origin 필수, 본문 없음, no-store, 성공 응답 요청자 쿠키 Max-Age=0), `lib/state/withdraw-participant.ts`(모든 분기 `promise_links` → `promises` `FOR UPDATE`, 잠금 후 `clock_timestamp()`·약속 없음 404·cancelled 409·세션·active 401·최신 role 재확인, draft 방장 폐기(링크 보존)·draft 일반 참여자 403, 마감 지난 collecting closed 먼저 저장, 일반 탈퇴·본인 세션만 만료, 먼저 들어온 active 참여자에게 자동 승계(옛 방장 member·cancelled 먼저), 후임 없으면 약속 취소), 공용화: `lib/member/draft-discard.ts` `deleteDraftPromise`(방장 등록·설정 완료와 공유), `markPromiseCancelled`(취소 API와 공유), `expireParticipantSessions`(`session-expiry.ts`). 문서: state.md STATE-API-08 구현 결정, API_CONVENTIONS 5.2 탈퇴 행, DECISION_CONFLICTS R-28 신설·C-12
- 검증: Vitest 1380건(이번 44건, 기존 기대값 수정 없음), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 102개 항목 — 네 분기 끝 상태, 탈퇴자 정원·닉네임·로그인·집계 처리, 후임 방장 권한 API 전부, 후임 없는 방장 = 취소 API 끝 상태, 마감 경과 closed 저장, draft 폐기 뒤 링크 재등록, 403·401·404·400·409, 동시성(잠금 대기열)·R-22 점검 표. 브라우저 6개 항목(코드 변경 없음). 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: C-07(탈퇴자 세션 401·로그인 403)·C-12(후임 없는 방장 탈퇴 뒤 `/me` 401) 팀 확인 필요, 후임 방장이 열어 둔 화면은 새로고침해야 방장 버튼이 나타남(화면 PR 몫), 탈퇴 버튼 화면 없음

### 2026-11-09 — 참여자 명단 조회 API (MEMBER-API-06)

- 스펙: `context/features/023-participant-list-api.md`
- 브랜치: `ahn/feat-명단조회-api` (PR #28 병합)
- 변경: `GET /api/v1/promises/[promiseId]/participants`(같은 경로 POST 옆에 추가, Origin 검사 없음, no-store, 인증 후 모든 응답 쿠키 갱신), `lib/member/participant-list.ts`(REPEATABLE READ 읽기 트랜잭션 하나·잠금 없음, 약속·세션·참여자 재확인, active 명단 `created_at, id` 순서·`participantId·nickname·role·isMe`만, 제출 여부 비공개, cancelled 409 `PROMISE_CANCELLED` 세션보다 우선, draft는 방장 포함 403). 문서: member.md MEMBER-API-06 허용 상태·에러 표·구현 결정, DECISION_CONFLICTS R-29 신설
- 검증: Vitest 1412건(이번 32건, POST 기존 26건 수정 없음), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 40개 항목 — 세 상태 200, 탈퇴자 제외·등록순, 승계 후 role, isMe, 미제출자 포함, 제출 여부 없음, GET 전후 행 md5 동일, 마감 지난 collecting 200(DB 그대로), draft 403(방장 포함), 탈퇴자 세션 401, cancelled 409(세션 없이), 403·404·400, no-store. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: C-07(탈퇴자 세션 401) 팀 확인 필요, 명단 화면 없음

### 2026-11-10 — 참여자 내보내기 API (MEMBER-API-08)

- 스펙: `context/features/024-remove-participant-api.md`
- 브랜치: `ahn/feat-내보내기-api` (PR #29 병합)
- 변경: `DELETE /api/v1/promises/[promiseId]/participants/[participantId]`(현재 active host, Origin 필수, 본문 없음, no-store, 인증 후 모든 응답 쿠키 갱신), `lib/member/remove-participant.ts`(`lockPromiseAsHost` 재사용·`promises`만 잠금, collecting·마감 전만, 본인 409 `CANNOT_REMOVE_SELF`, 대상 없음·다른 약속 404 `PARTICIPANT_NOT_FOUND`, 이미 cancelled면 변경 없이 200, 마감 경과는 참여자 등록과 같이 상태 유지 409 `DEADLINE_PASSED`, cancelled 409 `PROMISE_CANCELLED` 세션보다 우선), 대상 처리 `cancelParticipant`(`lib/member/participant-cancel.ts`, 본인 탈퇴와 공유 — 대상 cancelled + 대상 세션만 만료). 문서: member.md MEMBER-API-08 요청 헤더·에러 표·구현 결정, API_CONVENTIONS 5.2 탈퇴·내보내기 행, DECISION_CONFLICTS R-30 신설·A-02 해결
- 검증: Vitest 1462건(이번 50건, 탈퇴 기대값 수정 없음), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 73개 항목 — 200 끝 상태(대상만 cancelled·대상 세션 2개만 만료·데이터 보존), 재요청 무변경, 409·403·401·404·400, 상태별 거절, 마감 경과 상태 유지, 내보낸 뒤 정원·닉네임·로그인 403·세션 401·집계 제외, 동시성(잠금 대기열) 7가지 순서. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: STATE-API-09 5번(마감 경과 closed 저장)과 MEMBER-API-03·08의 차이·C-07 팀 확인 필요, 내보내기 버튼·명단 화면 없음

### 2026-11-10 — 로그아웃 API (MEMBER-API-07)

- 스펙: `context/features/025-logout-api.md`
- 브랜치: `ahn/feat-로그아웃-api` (PR #30 병합)
- 변경: `DELETE /api/v1/promises/[promiseId]/auth/session[?allDevices=true|false]`(같은 경로 POST 옆에 추가, Origin 필수, 본문 없음, no-store), `lib/member/logout.ts`(`logoutSession` — 쿠키 세션 행 물리 삭제, allDevices=true는 유효 세션일 때만 같은 참여자 전체 삭제, 행 없음·만료·탈퇴자·취소된 약속도 204·쿠키 Max-Age=0, 다른 약속 세션 403·삭제 없음, 공통 세션 인증 미사용·잠금 없음·조회와 삭제 한 트랜잭션 / `parseAllDevices` — `true`·`false` 한 개만). 참여자·슬롯·제출 상태 보존. 문서: member.md MEMBER-API-07 에러 표·보안 정보·구현 결정, MEMBER-API-05 비고, API_CONVENTIONS 5.2 로그아웃 행, DECISION_CONFLICTS R-31 신설·R-30 끝 문구·A-09 07 완료
- 검증: Vitest 1509건(이번 47건, POST 기존 34건 수정 없음), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 139개 항목 2회 — 이 기기·전체 로그아웃 끝 상태(참여자·슬롯·다른 세션 md5 그대로), 반복·재로그인, 위조·만료·탈퇴자·내보내진 참여자 204, 다른 약속 세션 403·삭제 없음, 취소된 약속·draft 204, 400·401·403·404 쿠키 변경 없음. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 설정 완료가 로그아웃과 겹치면 지워진 토큰으로 쿠키를 다시 심을 수 있음(다음 요청 401, → 026에서 처리), 로그아웃 버튼·로컬 입력 삭제 화면 없음, C-07 팀 확인 필요

### 2026-11-10 — 공통 상태 가드 점검과 정리 (STATE-API-09)

- 스펙: `context/features/026-common-guard-cleanup.md`
- 브랜치: `ahn/fix-공통가드-정리` (PR #31 병합)
- 변경: 구현된 API 20개 점검표 `docs/development/GUARD_MATRIX.md` 신설, 설정 완료(STATE-API-02) 잠금 후 세션·참여자 재확인(로그아웃과 겹치면 401·쿠키 Max-Age=0, 비활성 참여자 403 → 401), 취소된 링크 방장 등록(MEMBER-API-02) 409 `PROMISE_CANCELLED`, 제출(TIME-API-01) 잠금 후 재확인을 상태·마감 판정보다 먼저(N-2 — 무효 세션이면 마감이 지났어도 401·closed 저장 없음). 문서: state.md·member.md·time.md 처리 순서, DECISION_CONFLICTS R-32 신설·R-22·R-31 후속
- 검증: Vitest 1525건(이번 16건 순증), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 개발 DB 실제 호출 71개 항목 2회(잠금 대기 중 로그아웃·세션 만료 재현, 대조군 포함), 025 확인 스크립트 139개 항목 회귀 통과. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: N-1(링크 조회 effectiveStatus)·N-3(현황 조회 draft 판정 순서)·N-4(잠금 후 cancelled 쿠키)·N-5(방장 등록 화면 409 분기)·R-30·C-07·C-12는 기록만, 팀 확인 필요

### 2026-11-10 — 방장 관리 화면 (화면 PR 5a)

- 스펙: `context/features/027-host-manage-ui.md`
- 브랜치: `ahn/feat-방장관리-화면` (PR #32 병합)
- 변경: 화면 위쪽 방장 메뉴 `components/manage/host-menu.tsx`(현재 방장만, 상태 조회 `promiseStatus` 기준 — collecting: 응답 마감(018 버튼 이동)·설정 변경·취소, closed·confirmed: 다시 열기·취소), 설정 변경·재조율 공용 폼 `settings-panel.tsx`(바꾼 필드만·범위는 바꿨을 때만 `dateRange`(R-26), 정원 감소·마감 단축 막음, 마감 때문에 막히는 축소 안내, 범위 미리 보기는 `range-change.ts` 재사용, 저장 뒤 `changeImpact` 안내), 취소 `cancel-panel.tsx`(확인 1회·409 `PROMISE_CANCELLED` 성공 처리, R-25), 명단·내보내기 `participant-list.tsx`(모두에게 정원 현황·등록순·방장·나, 5초 폴링, 방장·모집 중·본인 제외 내보내기). 순수 로직 `lib/manage/{settings-form,impact,failure}.ts`. 문서: DECISION_CONFLICTS R-33 신설
- 검증: Vitest 1594건(이번 69건, 기존 기대값 수정 없음), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 브라우저 `scripts/verify/027-host-manage.mjs` 84개 항목 2회 통과(방장 1280px·참여자 390px, 응답 유실 재요청 포함). 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 탈퇴·로그아웃 버튼, 시간 입력 화면 "선택 N칸" 버그, 후임 방장 화면의 방장 메뉴(새로고침 필요)는 5b(028), 명단 기본 접힘·5초 폴링·미리 보기 칸 기준 안내는 팀 확인 필요(R-33)

### 2026-11-10 — 참여자 화면 마무리 (화면 PR 5b)

- 스펙: `context/features/028-participant-finish-ui.md`
- 브랜치: `ahn/feat-참여자화면-마무리` (PR #33 병합)
- 변경: 약속 나가기·로그아웃 화면 `components/leave/leave-panel.tsx`(모든 참여자·draft 방장 나가기, 상황별 확인 문구 — 일반·승계 이름(명단 등록순)·혼자 취소·초안 삭제, 이 기기·모든 기기 로그아웃), 완료 뒤 이 약속 저장값 삭제·링크 재조회(`invite-flow.tsx`, 나가기 중 일반 재조회 무시·마지막 재조회만 반영), 나가기 재요청 401·409 `PROMISE_CANCELLED`·404 `PROMISE_NOT_FOUND`와 로그아웃 401 성공 처리, 폴링 설정 기준 제출 전 입력 범위 정리(`clipDraftToRange`, 선택 N칸 버그), 명단의 내 역할 변화로 `/me` 갱신(후임 방장 메뉴), `canClose` 제거. 순수 로직 `lib/leave/{confirm,failure,storage}.ts`. fix: SWR 같은 주소 요청 합류 화면이 응답을 못 받는 문제 — 세 화면을 SWR `data` + `createIntake`로(`context/fixes/001-availability-swr-join.md`). API·DB 변경 없음. 문서: DECISION_CONFLICTS R-34 신설
- 검증: Vitest 1630건(이번 36건, 기존 기대값 수정은 `canClose` 제거 2건), `TZ=UTC`·`TZ=America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 브라우저 `scripts/verify/028-participant-finish.mjs` 75개 항목 2회 연속 통과(1280px·390px), 027 스크립트 84개 항목 3회 연속·012 회귀 21개 항목 2회 연속 통과. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 실제 휴대폰, R-34 판단(`/me` 폴링 대신 명단 역할 변화·모든 기기 로그아웃 뒤 다른 브라우저는 등록 모드 참여 화면) 팀 확인 필요, C-07·C-12

### 2026-11-11 — Figma 대조와 화면 다듬기

- 스펙: `context/features/029-figma-polish.md`
- 브랜치: `ahn/feat-figma-대조` (PR #34 병합)
- 변경: 1단계 차이 목록 `docs/design/FIGMA_DIFF.md`(차이 63개 — 고침 29, 보류 5, 그대로 29). 2단계 토큰 정리(`app/globals.css` `@theme`, 컴포넌트 직접 값 0곳), 시각 18개·구성 11개, 공통 확인 모달 `components/common/modal.tsx`(확인 창 6곳 + 모든 기기 로그아웃, 판단 순수 함수 `lib/ui/modal.ts`), 헤더 「닉네임 · 역할」(`components/common/identity.tsx`, `/me` 기준), 설정 달력 반 폭, 선택 요약 `lib/availability/summary.ts`·`maxAvailable`. API·DB 변경 없음. 문서: DECISION_CONFLICTS R-35 신설
- 검증: Vitest 1647건(이번 17건, 기존 기대값 수정 없음), `TZ=UTC`·`America/Los_Angeles`에서도 통과, lint·typecheck·build 통과. 브라우저 모달 29개 항목, 027 회귀 84개·028 회귀 75개 항목 통과(선택자만 수정), fix 회귀 20/21(재조율 뒤 3초 기준 — `main`에서도 같은 비율로 흔들림, 030에서 테스트 개선). 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 그리드 개편(07-1·07-2·07-4·21-1·13~16)·23-1 보류, R-35 판단 팀 확인 필요, fix 회귀 3초 기준 흔들림(030)

### 2026-11-11 — 배포 전 정리 1 (030)

- 스펙: `context/features/030-predeploy-cleanup-1.md`
- 브랜치: `ahn/chore-배포전-정리` (PR #35 병합)
- 변경: `next`·`eslint-config-next` 16.3.5 → 16.4.6(critical 포함 15건 → 11건, 남은 것은 Prisma CLI·lint 전용), Prisma 3종 `^` 없이 7.10.0 고정, `.env.example`·`SETUP.md` `sslmode=verify-full` 명시(`pg` 8의 `require` = `verify-full` 경고 제거, `.env`는 그대로), Prettier 전체 재포맷 커밋 분리(79파일, AST·주석 동일)와 `.git-blame-ignore-revs`, fix 회귀 「재조율 뒤 3초 안에 채워짐」을 요청 순서 판정(정기 폴링 응답보다 먼저 채워지는가)으로 변경(Git 제외 스크립트). 기능 동작 변경 없음
- 검증: Vitest 1647건(재포맷 전후 같음), `TZ=UTC`·`America/Los_Angeles` 통과, lint·typecheck·build 통과, `prisma migrate status` 최신. 새 판정 RED(합류 응답 무시 흉내) 5/5 실패 → 이 브랜치 10/10·`main` 10/10. 027 회귀 84/84·028 회귀 75/75. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일
- 남은 제한: 남은 취약점 11건(Prisma 7.10.1은 팀 합의 필요, `typescript-eslint`는 상위 수정 대기), Next 16.4.6 업데이트 팀 공유 필요, 확인 스크립트 저장소 이동은 031

### 2026-11-11 — 배포 전 정리 2: 통합 테스트 (031)

- 스펙: `context/features/031-integration-tests.md`
- 브랜치: `ahn/test-통합테스트` (PR #36 병합)
- 변경: `scripts/verify/` 시나리오를 `tests/e2e/`(Playwright Test 1.64.1)로 옮김 — 운영 모드(`next build` → `next start` 127.0.0.1:3101 → 로컬 https 프록시 `https://localhost:3100`), 프로젝트 chromium 데스크톱·webkit 데스크톱·webkit 모바일(iPhone 13, API 테스트는 chromium만), `.env.e2e`(Neon e2e 브랜치) 전용 가드(없음·같은 주소·같은 DB 호스트·이름 거부), 테스트별 데이터 생성·삭제와 중단 뒤 다음 실행 정리·끝 스냅샷 비교, 새 항목(전체 흐름·7일 지난 링크 410·서버 422·1분 강조·재조율 응답 유실·운영 모드 no-store·쿠키 속성). npm `test:e2e`·프로젝트별·`test:e2e:migrate`·`test:e2e:install`, devDependencies `@playwright/test`·`pg`·`@types/pg`. 문서: SETUP 4-5, CLAUDE.md 3·5절. 제품 코드 변경 없음
- 검증: `npm run test:e2e` 97 예상대로(알려진 실패 1 포함)·2 건너뜀·예상 밖 0, 16.5분, 스냅샷 동일. 가드·중단 뒤 정리 확인. Vitest 1647건, lint·typecheck·prettier·build 통과
- 남은 제한: WebKit 드래그 마지막 칸 0ms 놓기 누락(`test.fail`로 표시, 다음 수정), `/api/health` `Cache-Control` 없음(→ 032에서 수정), CI 연결(DB 비밀값) 없음

### 2026-11-15 — 배포 전 정리 3: 미리보기 배포 (032)

- 스펙: `context/features/032-preview-deploy.md`
- 브랜치: `ahn/feat-미리보기-배포` (PR #1 병합, a393e87 — 개인 저장소 `zeus1560/yaksok`)
- 변경: 1부 — 저장소 이전(`origin`=개인 저장소, `team`=팀 저장소), 허용 Origin·초대 링크 주소의 배포 환경별 결정(순수 함수 `lib/public-url.ts`, 화면도 같은 기준), `/api/health` no-store·DB 실패 503, 미리보기 DB 수동 마이그레이션(`db:deploy:preview`·`db:status:preview`, 개발·e2e DB면 거부), 배포 주소 확인 묶음(`test:e2e:preview`, `@smoke` 9개, 보호 우회 헤더), `docs/architecture/DEPLOY.md`(R-36). 2부 — `vercel.json`(함수 지역 `sin1`, `main` 자동 배포 끔), DEPLOY.md 배포 경험 반영(Production으로 잡힌 첫 배포·한글 브랜치 주소·스키마 PR push 전 마이그레이션·함수 지역 확인), 브랜치 이름 영어 규칙, `MOBILE_CHECKLIST.md`(78개 항목), 시작 때 health 응답 시간·함수 지역 출력, `expectPollReflects` 판정 수정(변경 전에 시작한 폴링도 새 값이면 인정)
- 검증: 1부 — Vitest 1667건(이번 20건, TDD RED 11/13 실패 → GREEN), `TZ=UTC`·`America/Los_Angeles`, lint·typecheck·prettier·build 통과, 로컬 `test:e2e` 세 프로젝트 99 통과·2 건너뜀·예상 밖 0(알려진 흔들림 1). 2부 — 배포 5c90481(`sin1`)에서 `@smoke` 9/9 2회 연속(2.2분·2.4분, `/api/health` 112~198ms, `iad1` 때는 8/9·453ms), 실제 HTTPS 쿠키 속성·다른 Origin 403·초대 링크 주소·no-store 확인, 미리보기 DB 매 실행 스냅샷 동일, 로컬 회귀 chromium 18/18·webkit 18개 예상대로, 안드로이드 Chrome 휴대폰 확인 정상(2026-11-15). 병합 뒤 `main`으로 새 Production 배포가 생기지 않음(사용자 확인 — AC-10)
- 남은 제한: 아이폰 Safari 미확인(기기 없음 — 공개 배포 전 팀원 아이폰으로 MOBILE_CHECKLIST 확인), 취소 커밋과 겹친 조회가 409 대신 401(R-37 — 이번 수정 PR `context/fixes/002`에서 처리), 운영 공개·운영 DB·도메인은 팀 결정 대기, CI의 통합 테스트 연결 없음
