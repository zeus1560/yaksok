# 현재 기능: PIN 시도 제한과 레이트 리밋 (035)

## 상태

완료 (PR #5 병합 1cb3d08. R-41 기준값은 팀 확정 필요, 아이폰 Safari는 공개 배포 전 팀원 확인으로 남김 — 아래 완료 이력)

## 스펙

`context/features/035-login-rate-limit.md`

## 목표

로그인 PIN 시도 제한(같은 참여자 + 같은 IP 1시간 5번 연속 실패 → 15분, 참여자 전체 1시간 20번 초과 → 15분, 참여자 전체 24시간 50번 → 24시간, 429 `TOO_MANY_ATTEMPTS`)과 인증 없는 쓰기 API 4개의 IP 레이트 리밋(링크 발급 1분 10회, 방장 등록·참여자 등록·로그인 1분 30회, 429 `RATE_LIMITED`). 기록은 DB 보조 테이블(추가형). 값은 MEMBER-API-04 제안값과 사용자 지시(2026-11-17 2차: 레이트 리밋 완화·하루 상한·smoke 429 대기)를 잠정 결정으로 — R-41(팀 확정 필요).

## 수용 기준

스펙 `context/features/035-login-rate-limit.md` AC-1~9 참고.

## 작업 기준점

- 브랜치: `ahn/feat-login-rate-limit` (`origin/main` 084f2de = PR #4 병합에서 `--no-track`으로 생성)
- 준비 단계: 커밋하지 않은 문서 정리 4개(.gitignore·CLAUDE.md·project-overview·SETUP)가 있어 멈추고 확인 → 사용자 결정으로 새 브랜치에 별도 docs 커밋. `main` fast-forward(1d18585 → 084f2de), 원격이 사라진 로컬 `ahn/` 브랜치 없음. 원격이 남은 브랜치(지우지 않음): `ahn/feat-mobile-drag-select`, `ahn/feat-mobile-grid-view`
- 첫 커밋: 361e87c `docs: 034 완료 기록`, 이어서 2687649 `docs: 작업 규칙 문서 정리`

## 구성

- 스키마: 마이그레이션 `20261117050841_login_rate_limit` — `login_failures`·`rate_limit_hits` 새 테이블과 인덱스 4개만(ALTER·DROP 없음, FK 없음). 개발 DB·e2e DB·미리보기 DB 적용(미리보기는 2026-11-24 사용자가 push 전 적용)
- 순수 함수 `lib/limit/`: `login-lock.ts`(`resolveLoginLock` — 밀어 가는 창 세 기준 `LOGIN_LOCK_RULES`: 참여자 + IP 1시간 5번·참여자 전체 1시간 21번째 → 15분, 하루 24시간 50번 → 24시간), `rate-limit.ts`(`RATE_LIMITS`·`resolveRateLimit`), `client-ip.ts`(`clientIpKey`·`normalizeIp` — x-forwarded-for 첫 값 → x-real-ip → `unknown`, IPv6 /64), `notice.ts`(화면 문구)
- 서버: `lib/member/login.ts` `checkPin`(`(약속 id, 정규화 닉네임)` advisory lock 트랜잭션 — 판정 → PIN 비교 → 실패 기록·49시간 넘은 행 정리 / 성공 시 그 IP 기록 삭제), `lib/limit/rate-limit-store.ts`(`consumeRateLimit`·`rateLimitResponse`, advisory lock, 10분 넘은 행 정리), `lib/api-error.ts` `rateLimited`·`tooManyAttempts`, Route 4개(links·host·participants POST·auth/session POST)
- 화면: `lib/participate/failure.ts`(`TOO_MANY_ATTEMPTS` → 잠금 안내, `RATE_LIMITED` → 요청 수 안내), `create-promise-button.tsx`, `register-host-card.tsx`
- 통합 테스트: 도우미가 요청·컨텍스트마다 시험용 IP(198.18.0.0/15) x-forwarded-for(`e2e-env.ts` `testIp`), 보조 테이블은 스냅샷 비교에서 빼고 정리(`db.ts`), 새 `tests/e2e/api/rate-limit.spec.ts`(3)·`tests/e2e/login-limit.spec.ts`(2), 미리보기 smoke의 429 대기 `tests/e2e/support/rate-limit-wait.ts`(API 도우미 `call`, 전체 흐름의 링크 발급·방장 등록 버튼 — 대기 상한 3분, 끝에 횟수·시간 출력)
- 문서: member.md(MEMBER-API-02·03·04·09), API_CONVENTIONS 3절·7절, GUARD_MATRIX 「이후 추가」, DATABASE.md 「보안 보조 테이블」, DECISION_CONFLICTS R-41 신설·R-11·3절 MEMBER 메모, MOBILE_CHECKLIST 12절, AGENTS.md 현재 상태

## 검증 결과

2026-11-17, Node.js 24, Playwright 1.64.1

| 단계                             | 명령·방법                                                                                                                                                                                                                                                                                    | 결과                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TDD RED                          | 빈 구현(`resolveLoginLock` → 늘 `{ locked: false }`, `loginParticipant`는 `ipKey`를 받기만 함)으로 `npx vitest run lib/limit/login-lock.test.ts lib/member/login.test.ts`(PowerShell)                                                                                                        | **3 failed**, 23 passed. 「같은 참여자·같은 IP로 5번 연속 실패하면 15분 동안 잠기고 다른 IP는 잠기지 않는다」 `expected { locked: false } to deeply equal { locked: true, scope: 'pair', …(1) }`. 「같은 참여자·같은 IP로 5번 연속 실패한 뒤에는 PIN이 맞아도 too_many_attempts, PIN 비교·세션 없음」 `expected { kind: 'ok', …(9) } to deeply equal { kind: 'too_many_attempts', …(1) }`. 「성공하면 이 참여자·이 IP의 실패 기록을 지워 실패 횟수를 초기화한다」 `expected "vi.fn()" to be called with arguments: [ { where: { …(3) } } ]` — 모두 값 불일치                                                                                                                                                                                                       |
| GREEN                            | `resolveLoginLock` 구현 + `checkPin` 트랜잭션                                                                                                                                                                                                                                                | 26/26. 기존 23건은 테스트 준비만 바꿈(잠금 트랜잭션의 판정 시각 응답을 하나 더 넣음), 기대값 그대로                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| REFACTOR                         | 경계 테스트 추가(잠금 끝 1ms 전·정확히 끝, 1시간 창 경계, 풀린 뒤 재잠금, 참여자 전체 20/21, 두 기준 겹침, 순서 섞임 / 요청 수 경계·넘친 수·미래 시각 / IP 형식 17개 / 서비스: 실패 기록·없는 닉네임·75분 조회·다른 IP·참여자 전체·소문자 잠금 키·기본 키 / 라우트 4개 429·순서 / 화면 문구) | `lib/limit`·`login` 68/68. 구현 변경: 잠금 키를 DB의 약속 id(소문자)로(대문자 UUID로 다른 잠금 줄을 만드는 경로를 테스트하며 고침), 미사용 변수 정리. 라우트 테스트는 레이트 리밋 모듈을 모킹하고 로그인 호출 인자에 `{ ipKey }`가 붙은 2건의 기대값을 고침                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 단위·정적                        | `npm run test`(PowerShell), `TZ=UTC`·`TZ=America/Los_Angeles`, lint, typecheck, `prettier --check .`, build                                                                                                                                                                                  | 1772 통과(86파일, 이번 64건 순증) ×3, 통과, 통과, 통과, 통과                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 개발 DB 실제 호출                | `node --env-file=.env scripts/verify/035-login-rate-limit.mjs`(dev 서버, IP는 x-forwarded-for로 흉내)                                                                                                                                                                                        | 1회차 49/51 — 「헤더 없는 요청은 `unknown`」 가정이 틀림: Next.js가 x-forwarded-for가 없으면 소켓 주소로 채움(`base-server.js`) → 키 `0:0:0:0::/64`(::1). 확인 항목·정리 범위를 고치고 남은 행 1개 삭제. **2·3회차 51/51**: 5번 실패 → 맞는 PIN 429·Retry-After 900·details 같음·쿠키 없음·no-store·잠긴 동안 미집계, 다른 IP 200, 14분 50초 뒤 429(≤10초)·15분 뒤 200·초기화, 성공 뒤 다시 4번 401·5번째 잠김, 5개 IP × 4 = 20번까지 200·21번째 뒤 새 IP 429·다른 참여자 무관·15분 뒤 해제, 없는 닉네임 같은 잠금, 2시간 넘은 실패·10분 넘은 요청 기록 정리, 링크 5회·방장 등록 10회·참여자 등록 10회·로그인 10회 뒤 429 `RATE_LIMITED`(다른 IP 201, 다른 Origin 403 먼저, 422 먼저, 거절 재시도로 Retry-After 안 늘어남, 1분 뒤 201). 정리 뒤 스냅샷 시작과 같음 |
| 예전 배포 호환                   | `origin/main` 084f2de worktree(새 마이그레이션 없음, 예전 Prisma 클라이언트)에서 `npx playwright test tests/e2e/api tests/e2e/full-flow.spec.ts --project=chromium-desktop`(새 스키마를 적용한 e2e DB)                                                                                       | **19 passed**(3.0분) — API 통합 테스트 전체(방장 등록·draft 폐기 포함 모든 API)·전체 흐름. 스냅샷(새 테이블 포함 모든 테이블) 동일. 예전 코드의 `prisma migrate status`(개발 DB)도 「up to date」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 로컬 통합 전체 1회               | `npx playwright test --output=test-results/2026-11-17-035-full-1`(빌드 포함, 세 프로젝트)                                                                                                                                                                                                    | **123 passed, 33 skipped, 6 failed**(22.7분). 기존 테스트는 모두 통과(같은 PC에서 몰아 보내도 요청별 시험용 IP로 레이트 리밋에 걸리지 않음), 스냅샷 동일. 실패 6건은 모두 이번에 새로 넣은 화면 테스트 2개 × 세 프로젝트: `getByRole('alert')`가 폼 안내와 Next.js 경로 안내 요소 2개에 걸린 strict mode 위반(테스트 선택자). 캡처에서 안내 문구는 제대로 보임                                                                                                                                                                                                                                                                                                                                                                                                     |
| 새 테스트 수정 뒤                | 선택자를 문구로 거른 `alert`로 바꾸고 `E2E_SKIP_BUILD=1 npx playwright test login-limit rate-limit --output=test-results/2026-11-17-035-limit-2`(세 프로젝트, 제품 코드는 빌드 뒤 그대로)                                                                                                    | **9 passed**(1.3분), 스냅샷 동일                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2차 지시(2026-11-17)             | 레이트 리밋 완화(링크 1분 10회, 방장 등록·참여자 등록·로그인 1분 30회), 하루 상한(참여자 전체 24시간 50번 → 24시간), 미리보기 smoke 429 대기                                                                                                                                                 | 아래 행들                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 하루 상한 TDD RED                | 대표 테스트를 먼저 쓰고 기존 구현으로 `npx vitest run lib/limit/login-lock.test.ts`(PowerShell)                                                                                                                                                                                              | **1 failed**, 8 passed. 「참여자 전체로 24시간에 50번 실패하면 50번째 실패부터 24시간 잠그고, 49번은 잠그지 않는다」 `expected { locked: false } to deeply equal { locked: true, scope: 'daily', …(1) }` — 값 불일치                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 하루 상한 GREEN                  | 세 기준을 `LOGIN_LOCK_RULES`로 일반화, 판정 기록 범위 75분 → 48시간, 정리 2시간 → 49시간                                                                                                                                                                                                     | `lib/limit`·`login` 74/74. 기대값을 바꾼 기존 테스트 1건: 「75분 안의 기록만 읽는다」 → 48시간(조회 범위가 바뀐 의도된 변경)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 하루 상한 REFACTOR               | 24시간 창 경계·정확히 24시간 뒤 해제, 서비스(새 IP·맞는 PIN도 429·약 24시간), 화면 문구(1시간 넘으면 「N시간 뒤에」 — 24시간이 「1440분」으로 나오지 않게)                                                                                                                                   | 통과. 레이트 리밋 기준 테스트는 새 값으로 다시 씀(기대값 변경: 운영 기준 표, 경계 개수)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| smoke 429 대기 흉내              | `E2E_TARGET=preview npx tsx scripts/verify/035-wait-check.ts`(함수만, DB·네트워크 없음)                                                                                                                                                                                                      | RATE_LIMITED Retry-After 1 → 1.5초 기다리고 true·기록, TOO_MANY_ATTEMPTS·401 → 기다리지 않음, 상한(3분)을 넘는 Retry-After 200 → 경고 후 false, 요약 「429 RATE_LIMITED 대기 1회, 합계 1.5초 (POST /api/v1/links 1.5초)」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2차 단위·정적                    | `npm run test`(PowerShell), `TZ=UTC`·`TZ=America/Los_Angeles`, lint, typecheck, `prettier --check .`, build                                                                                                                                                                                  | 1777 통과 ×3, 통과, 통과, 통과(Python으로 고친 파일 9개가 CRLF가 되어 1회 걸림 → `prettier --write`, CRLF 없음 확인), 통과                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2차 개발 DB 실제 호출            | 같은 스크립트(새 기준 + 하루 상한 7개 항목: 49번 미리 넣고 50번째 실패 → 새 IP 맞는 PIN 429·Retry-After ≈ 86400, 잠겨도 받은 세션으로 `/me` 200, 23시간 59분 50초 뒤 429(≤10초)·24시간 뒤 200, 정리 기준 49시간)                                                                             | **58/58 3회 연속**, 정리 뒤 스냅샷 시작과 같음                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2차 통합                         | `npx playwright test tests/e2e/api tests/e2e/login-limit.spec.ts tests/e2e/links-and-forms.spec.ts tests/e2e/full-flow.spec.ts --output=test-results/2026-11-17-035-v2-1`(빌드 포함, 세 프로젝트)                                                                                            | **54 passed**, 실패 0(7.1분). 로컬이라 「429 RATE_LIMITED 대기 0회, 합계 0.0초」 출력, 스냅샷 동일                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 정리                             | 포트 3000·3100·3101, `node` 프로세스                                                                                                                                                                                                                                                         | 남은 것 없음(2차 뒤 다시 확인). 예전 코드 확인용 worktree 삭제                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 미리보기 smoke 1회차(2026-11-24) | 배포 ee1fba8 고유 주소(미리보기 DB 마이그레이션 전에 만든 배포, 빌드가 DB를 쓰지 않아 Redeploy 없이), `npm run test:e2e:preview -- --output=test-results/preview-2026-11-24-035-1`(세 프로젝트, 로그 같은 이름 `.log`)                                                                       | **9 passed**(5.3분). 함수 지역 `sin1`, `/api/health` 123ms. 「429 RATE_LIMITED 대기 0회, 합계 0.0초」, 스냅샷 동일. webkit 전체 흐름이 데스크톱 4.9분·모바일 3.9분으로 034 때(1.0~2.6분)보다 느림 — chromium은 1.0분으로 같음, 429 대기 없음. 원인 미확인                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 미리보기 smoke 2회차             | 같은 명령, `--output=test-results/preview-2026-11-24-035-2`                                                                                                                                                                                                                                  | **9 passed**(4.9분). `sin1`, `/api/health` 145ms, 429 대기 0회·0.0초, 스냅샷 동일. webkit 전체 흐름 데스크톱 4.6분·모바일 3.6분(1회차와 같은 경향), chromium 57.4초                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Vercel IP 처리                   | 2회차 직후 미리보기 DB `rate_limit_hits`를 `ip_key`·`bucket`별로 조회(1회차 행은 10분 정리로 이미 지워짐)                                                                                                                                                                                    | 키는 **이 PC의 공인 IPv4 하나뿐**(60행: links 20·host 14·participants 24·login 2). 테스트가 보낸 시험용 x-forwarded-for(198.18.0.0/15)는 하나도 없음 → Vercel이 덮어쓴 실제 접속 IP로 모인다(`client-ip.ts` 가정과 같음). 로그인 잠금도 같은 `clientIpKey`를 쓰므로 같은 키로 모임(`login_failures`는 테스트 정리가 약속별로 지워 0행 — 직접 확인은 못 함). links는 7분여 동안 20회로 1분 10회 안이라 429 없음                                                                                                                                                                                                                                                                                                                                                     |
| 실기기                           | 안드로이드 Chrome, 미리보기 배포에서 MOBILE_CHECKLIST 12절(사용자 확인, 2026-11-24)                                                                                                                                                                                                          | 12-1~12-7 모두 정상(사용자 보고 「앞에서랑 똑같아」 — 이전 기능처럼 안드로이드 Chrome 전체 정상으로 기록). 아이폰은 미확인(공개 배포 전 팀원 확인)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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

### 2026-11-15 — 수정 002: 드래그 마지막 칸 누락(WebKit)과 취소와 겹친 조회의 401

- 수정 기록: `context/fixes/002-drag-and-cancel-race.md`
- 브랜치: `ahn/fix-drag-and-cancel-race` (`origin/main` a393e87에서 생성, PR #2 병합 ed1f4ba — 완료)
- 변경: 드래그 상태를 즉시 바뀌는 순수 객체 `lib/availability/drag.ts` `createDragTracker`로 옮기고 놓기 리스너를 pointerdown에서 바로 담(`components/availability/my-grid.tsx` — 효과가 다시 달리기 전의 놓기 리스너가 앞 칸을 읽던 문제, trace로 확인). 공통 인증 `lib/member/session-auth.ts`가 세션 무효로 401을 내기 직전에 약속 상태를 다시 읽어 cancelled면 409 `PROMISE_CANCELLED`(R-37, 401 경로에만 쿼리 1번, `/me`·로그아웃 제외). 031의 webkit `test.fail` 삭제. 문서: GUARD_MATRIX 「이후 수정」, DECISION_CONFLICTS R-37
- 검증: 드래그 RED webkit 5회 중 4회 실패(`Expected: 3, Received: 1`) → GREEN webkit·chromium 각 5회 모두 통과(50ms 테스트 포함 20/20). 401 RED(`expected { kind: 'unauthenticated' } to deeply equal { kind: 'cancelled' }`) → GREEN, `/me`·로그아웃 104개 그대로. Vitest 1676건 ×3 TZ, lint·typecheck·prettier·build 통과. 로컬 `test:e2e` 100 통과·2 건너뜀·실패 0, 스냅샷 동일
- 배포 확인: b83f322(함수 지역 `sin1`)에서 `@smoke` 9/9 연속 2회(2.1분씩, `/api/health` 128·120ms). 그 전 1회도 9/9(166ms), 사이의 1회는 PC 네트워크 끊김(약 85분 DNS 실패)으로 무효 — 남은 테스트 링크는 다음 실행이 정리, 스냅샷 동일

### 2026-11-15 — 휴대폰 드래그 선택 (033)

- 스펙: `context/features/033-mobile-drag-select.md`
- 브랜치: `ahn/feat-mobile-drag-select` (`origin/main` ed1f4ba에서 생성, PR #3 병합 1d18585 — 완료)
- 변경: 터치가 주 입력인 기기(`matchMedia('(pointer: coarse)')`)에서만 그리드 위 「드래그로 선택」 버튼(`aria-pressed`, 켜짐·꺼짐, 처음 켤 때 안내 1회). 켜면 칸 영역만 `touch-action: none`·그리드 파란 테두리, 손가락 끌기를 데스크톱과 같은 규칙(`createDragTracker`·`applyRect`)으로 — 손가락 좌표 → 칸은 순수 함수 `cellAtPoint`, 포인터 종류 판단은 `dragInput`(`lib/availability/drag.ts`). 탭 뒤 click 한 번 건너뛰기, 두 번째 손가락 무시, 선택 모드는 기기에 저장하지 않음. 통합 테스트 `tests/e2e/mobile-drag.spec.ts`(합성 터치·chromium CDP 실제 터치). 문서: DECISION_CONFLICTS R-38 신설·R-19 대체, MOBILE_CHECKLIST 10절, FIGMA_DIFF 23-1. API·DB 변경 없음
- 검증: TDD RED 2 failed → GREEN 7/7 → REFACTOR 10/10. Vitest 1681건 ×3 TZ, lint·typecheck·prettier·build 통과. 로컬 `test:e2e` 2회차 105 통과·9 건너뜀·실패 0(1회차 webkit 모바일 `host-manage` 1건 180초 초과 — 원인 미확인, 재실행 모두 통과). 배포 0d2e5d4(`sin1`) `@smoke` 9/9 2회. 안드로이드 Chrome 실기기 MOBILE_CHECKLIST 10절 정상(2026-11-15)
- 남은 제한: 아이폰 Safari 미확인(공개 배포 전 팀원), 실기기에서 나온 불편(날짜 2개만 보임·세로로 김·드래그 중 자동 스크롤 없음)은 034 「휴대폰 그리드 보기 개선」, webkit 모바일 `host-manage` 흔들림은 기록만

### 2026-11-16 — 휴대폰 그리드 보기 개선 (034)

- 스펙: `context/features/034-mobile-grid-view.md`
- 브랜치: `ahn/feat-mobile-grid-view` (`origin/main` 1d18585에서 생성, PR #4 병합 084f2de — 완료)
- 변경: 휴대폰(`lg` 미만)에서 날짜 4일씩 ◀▶ 넘기기(두 탭 공통 구간), 「내 시간」 표시 단위 30분·1시간·2시간(묶은 칸 전부·일부 n/m·없음·지난, 누름·끌기는 30분 칸으로 바꿔 `applyRect`, 단위는 기기 기억), 도구 줄 한 줄·범례는 제출 바 「?」(칸 견본)·날짜 머리글 하루 토글 되돌리기 알림, 드래그 중 화면 끝 자동 스크롤(휴대폰·데스크톱), 좁은 화면 제출 바 짧은 문구. 「모두의 시간」도 같은 표시 단위(묶은 칸 = 내내 가능 수)와 칸 상세 사람 목록(휴대폰 아래 창, R-40). 순수 함수 `lib/availability/view.ts`·`heat.ts`(`groupPeople`·`rangesText`)·`summary.ts`(`formatSelectionShort`). 통합 테스트 `tests/e2e/mobile-grid-view.spec.ts`. 문서: DECISION_CONFLICTS R-39·R-40 신설·R-38 일부 대체, MOBILE_CHECKLIST 11절. API·DB 변경 없음
- 검증: TDD RED 2 failed → GREEN → REFACTOR 17/17, R-40 RED 2 failed → GREEN → 13/13. Vitest 1708건 ×3 TZ, lint·typecheck·prettier·build 통과. 로컬 `test:e2e` 전체 120 통과·33 건너뜀·실패 0(R-40 뒤), 스냅샷 동일. 미리보기 `@smoke` 4413b9f·e18adfb·c440a6e 각 2회 9/9(`sin1`). 안드로이드 Chrome 실기기 MOBILE_CHECKLIST 11-1~11-23 모두 정상(1~3차, 2026-11-15~16)
- 남은 제한: 아이폰 Safari 미확인(공개 배포 전 팀원), webkit 모바일 `host-manage` 흔들림(033)은 기록만

### 2026-11-24 — PIN 시도 제한과 레이트 리밋 (035)

- 스펙: `context/features/035-login-rate-limit.md`
- 브랜치: `ahn/feat-login-rate-limit` (`origin/main` 084f2de에서 생성, PR #5 병합 1cb3d08 — 완료)
- 변경: 로그인 PIN 시도 제한(같은 참여자 + 같은 IP 1시간 5번 연속 실패·참여자 전체 1시간 21번째 → 15분, 참여자 전체 24시간 50번 → 24시간, 429 `TOO_MANY_ATTEMPTS`·`Retry-After`, 잠긴 동안 PIN 비교·집계 없음, 없는 닉네임도 같은 잠금, 성공 시 그 IP 기록만 초기화)과 인증 없는 쓰기 API 4개의 IP 레이트 리밋(링크 발급 1분 10회, 방장 등록·참여자 등록·로그인 1분 30회, 429 `RATE_LIMITED`). 마이그레이션 `20261117050841_login_rate_limit`(보조 테이블 `login_failures`·`rate_limit_hits`와 인덱스만, 추가형). 순수 함수 `lib/limit/`(`resolveLoginLock`·`LOGIN_LOCK_RULES`, `resolveRateLimit`·`RATE_LIMITS`, `clientIpKey`·`normalizeIp`, 화면 문구), `checkPin` advisory lock 트랜잭션, `rate-limit-store.ts`, 화면 안내 2종(에러 코드 분기). 통합 테스트 시험용 IP·`rate-limit.spec.ts`·`login-limit.spec.ts`, 미리보기 smoke 429 대기. 문서: member.md·API_CONVENTIONS·GUARD_MATRIX·DATABASE.md 「보안 보조 테이블」, DECISION_CONFLICTS R-41 신설(잠정), MOBILE_CHECKLIST 12절
- 검증: TDD RED 3 failed → GREEN 26/26 → REFACTOR 68/68, 하루 상한 RED 1 failed → GREEN → 74/74. Vitest 1777건 ×3 TZ, lint·typecheck·prettier·build 통과. 개발 DB 실제 호출 58/58 3회 연속, 스냅샷 동일. 예전 배포 코드(084f2de)가 새 스키마에서 API·전체 흐름 19 passed. 로컬 통합 54 passed·실패 0(2차), 스냅샷 동일. 미리보기 DB 마이그레이션 적용(사용자) 뒤 배포 ee1fba8(`sin1`) `@smoke` 9/9 2회(429 대기 0회), 미리보기 DB에서 IP 키가 Vercel이 덮어쓴 실제 접속 IP로 모임 확인. 안드로이드 Chrome 실기기 MOBILE_CHECKLIST 12-1~12-7 정상(2026-11-24)
- 남은 제한: R-41 전체(기준값·하루 상한으로 남이 24시간 막을 수 있는 대가 등) 팀 확정 필요, 아이폰 Safari 미확인(공개 배포 전 팀원), 미리보기 webkit 전체 흐름이 034 때보다 느림(원인 미확인, 429 대기 없음), `login_failures`의 IP 키는 테스트 정리로 직접 확인 못 함
