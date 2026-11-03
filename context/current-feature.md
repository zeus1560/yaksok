# 현재 기능: 참여자 재인증 API (MEMBER-API-04)

## 상태

완료

## 스펙

`context/features/004-participant-login-api.md`

## 목표

다른 기기에서 닉네임·PIN으로 기존 참여자에게 다시 로그인해 새 세션을 받는다. 약속 상태를 PIN보다 먼저 판정하고, 로그인 가능 기간은 링크 유효 기간과 같다.

## 수용 기준

- [x] AC-1 Origin 없음·불일치 → 403 `INVALID_ORIGIN`
- [x] AC-2 JSON·필드 오류 → 400 `INVALID_REQUEST`
- [x] AC-3 닉네임 등록과 같은 규칙(trim → NFC), PIN 형식 → 422
- [x] AC-4 UUID 형식 오류·없는 약속 → 404 `PROMISE_NOT_FOUND`
- [x] AC-5 PIN 전 상태 판정: cancelled 409 `PROMISE_CANCELLED`, 10분 지난 draft 404, `linkExpiryBase + 7일` 410
- [x] AC-6 없는 닉네임·틀린 PIN 같은 401, 더미 해시 비교, 실패 지점 한 곳
- [x] AC-7 cancelled 참여자 403 `PARTICIPANT_CANCELLED`
- [x] AC-8 새 세션 행만 생성, draft 24시간·그 외 `linkExpiryBase + 7일`, Max-Age = 남은 초
- [x] AC-9 세션 저장 P2003 → 404
- [x] AC-10 200 본문 6개 필드, `sessionExpiresAt` +09:00
- [x] AC-11 PIN·세션 토큰 원문 미노출, 429 없음

## 작업 기준점

- 브랜치: `ahn/feat-로그인-api` (`main` 21aa399에서 생성, MEMBER-API-02 병합 포함)
- 시작 시 작업 트리: 깨끗함
- 선행 모듈 확인: `lib/member/pin.ts`(`verifyPin`), `nickname.ts`(`normalizeNickname`), `session.ts`, `link-status.ts`(`linkExpiryBase`) 모두 있음

## 검증 결과

2026-11-04, Node.js v24.20.0

| 명령 | 결과 |
| --- | --- |
| `npm run test` | 통과 — 13 파일, 157 테스트 (이번 기능 45건 추가: login 22, route 21, session 2) |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 — `/api/v1/promises/[promiseId]/auth/session` 동적(ƒ) |
| `npx prettier --check` (변경 파일) | 코드 파일 통과. Markdown 5개는 main에서도 이미 경고 상태라 재포맷하지 않음 |
| dev 서버 + 개발 DB: 등록 → 로그인 | 링크 발급 → 조합형 " 혜승 "(U+1112 U+1168 U+1109 U+1173 U+11BC, UTF-8 파일)으로 방장 등록 201 → 쿠키 없이 완성형 "혜승"·같은 PIN으로 로그인 200(본문 6개 필드, 쿠키 속성 명세대로, draft라 Max-Age=86400) |
| 저장값 확인 | `participants.nickname`·`normalized_nickname` 모두 U+D61C U+C2B9(NFC 완성형) — API-02 때 미확인 항목 확인. 세션 행 2개(해시 64자), 두 번째 만료 = 로그인 시각 + 24시간 |
| 실패 응답 | 틀린 PIN·없는 닉네임 모두 401 같은 본문(0.34s / 0.41s, 첫 요청은 더미 해시 생성 포함), Origin 없음 403, UUID 형식 오류·없는 UUID 404, 깨진 JSON 400, PIN 2자리 422 |
| 상태 판정 실제 DB | `created_at`을 10분 전으로 옮긴 draft → 404, 약속 삭제 안 됨(세션 2행 유지). `status=cancelled` → 409 `PROMISE_CANCELLED` |
| 로그 | dev 로그에 오류·PIN 없음 |
| 정리 | 확인용 링크·약속·참여자·세션 삭제, 5개 테이블 스냅샷(행 수·md5)이 시작 상태와 동일 |

DB 스키마 변경 없음 → `db:status` 해당 없음. UI 변경 없음 → 브라우저 확인 해당 없음.

## 메모

- 문서 수정: API_CONVENTIONS 3절 `PROMISE_STATE` → `PROMISE_CANCELLED`·`INVALID_PROMISE_STATE`, 5.2 재인증 행·로그인 가능 기간 확정. member.md MEMBER-API-04 에러 표·처리 순서·세션 만료. DECISION_CONFLICTS R-11 신설, C-07 진행, C-10·C-11 신규 미결, A-04 해결, A-09에 04 완료, MEMBER-06-04 공개 배포 전 필수 재검토.
- 스펙과 다르게 판단한 부분·미결은 스펙의 미정 사항에 정리했다.
- 판단 4건(draft 발급 시각, Max-Age 기준, 쿠키 id, 응답 시간 균등화 범위) 승인. C-07은 "로그인 403 / 세션 API 401 구분" 안으로 기록, 팀 확인 대기.

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
