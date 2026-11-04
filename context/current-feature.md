# 현재 기능: 설정 완료와 모집 시작 API (STATE-API-02)

## 상태

완료

## 스펙

`context/features/005-start-collecting-api.md`

## 목표

방장이 draft에서 필수 설정을 저장하고 collecting으로 전환한다. 이후 세션 인증 API가 재사용할 공통 인증 모듈과 쿠키 갱신 규칙을 만든다.

## 수용 기준

- [x] AC-1 Origin 403 `INVALID_ORIGIN`, 전 응답 `Cache-Control: no-store`
- [x] AC-2 세션 인증 공통 모듈: 형식 400 → 404 → 취소 409(세션보다 먼저) → 401 → 다른 약속 403
- [x] AC-3 세션 인증 성공 후 모든 응답 Set-Cookie, Max-Age = 응답 시점 `expires_at`까지 남은 초(삭제 시 0)
- [x] AC-4 링크 → 약속 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, 취소 409·비방장 403·비 draft 409
- [x] AC-5 10분 지난 draft 삭제 + 410 `DRAFT_EXPIRED`, 삭제 커밋
- [x] AC-6 설정 형식 400 / 규칙 422, 실패 시 저장 없음 (날짜 상한 R-07, 시작일 ≥ 오늘)
- [x] AC-7 설정 + collecting 한 트랜잭션
- [x] AC-8 active 유효 세션만 `마감 + 7일`
- [x] AC-9 200 본문 명세 그대로, +09:00
- [x] AC-10 MEMBER-API-04 만료 draft 410(삭제 없음)
- [x] AC-11 MEMBER-API-04 promiseId 형식 오류 404 → 400 `INVALID_REQUEST`(약속 기준 API 통일)

## 작업 기준점

- 브랜치: `ahn/feat-설정완료-api` (`main` 11ed1e8에서 생성, MEMBER-API-04 병합 포함)
- 시작 시 작업 트리: 깨끗함
- 선행 모듈 확인: `lib/member/login.ts`, `session.ts`(`sessionMaxAgeSeconds`), `link-status.ts`, `lib/origin.ts`, `lib/api-error.ts` 모두 있음

## 검증 결과

2026-11-04, Node.js v24

| 명령 | 결과 |
| --- | --- |
| `npm run test` | 통과 — 17 파일, 273 테스트 (이번 116건 추가: start-settings·start-collecting·session-auth·start route·seoul 114, MEMBER-API-04 2) |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 — `/api/v1/promises/[promiseId]/start` 동적(ƒ) |
| dev 서버 + 개발 DB: 링크 발급 → 방장 등록 → 같은 쿠키로 설정 완료 | 200, 본문 명세 그대로(`endTime` "24:00", 마감 +09:00), `Cache-Control: no-store`, Set-Cookie Max-Age=1124255 = 지금 기준 마감(11-10 18:00) + 7일까지 남은 초(차이 0초) |
| 저장값 | `status=collecting`, 정원 4, 2026-11-04~11-20, 540/1440, 60분, 마감 저장. 방장 유효 세션·멤버 세션 → 11-17 18:00(+09:00). 방장의 이미 만료된 세션·cancelled 참여자의 유효 세션은 그대로 |
| 실패 응답 | Origin 없음 403, 쿠키 없음·만료 세션·cancelled 참여자 세션 401, 방장 아닌 멤버 세션 403(쿠키 갱신 포함), UUID 형식 오류 400, 오프셋 없는 마감 400, 어제 시작 422, 정원 1 422 — 이 동안 약속 draft·설정 NULL 유지. 재요청 409 + details |
| 만료 draft | `created_at` 10분 전으로 이동 → 로그인(MEMBER-API-04) 410 `DRAFT_EXPIRED`·행 유지 → 설정 완료 410 + `Max-Age=0` → 약속·참여자·세션 0행(커밋 확인), 링크 유지, 링크 조회 unclaimed |
| 로그 | dev 로그에 오류·토큰 없음 (pg SSL 모드 경고만) |
| 정리 | 확인용 링크·약속·참여자·세션 삭제, 5개 테이블 스냅샷(행 수·md5)이 시작 상태와 동일 |

DB 스키마 변경 없음 → `db:status` 해당 없음. UI 변경 없음 → 브라우저 확인 해당 없음.

## 메모

- 사용자 확인(2026-11-04): 날짜 상한은 R-07 유지. 요청서의 "시작일 + 89일"은 채택하지 않음.
- 문서 수정: state.md STATE-API-02(403 `INVALID_ORIGIN`, 시작일 ≥ 오늘, 400/422 구분, 쿠키 갱신, 410 커밋), member.md MEMBER-API-04(410 `DRAFT_EXPIRED`), API_CONVENTIONS(3절 `DRAFT_EXPIRED`, 5절 인증 순서·쿠키 갱신, 5.2 모집 시작 행), DECISION_CONFLICTS(R-11 갱신, R-12 신설, A-09).
- 판단·미결은 스펙의 「미정 사항·판단」에 정리했다.
- 검토 후 수정(2026-11-04, 판단 전부 승인): MEMBER-API-04 promiseId 형식 오류를 400으로 통일(member.md·테스트·R-12), R-12 시작 날짜 근거에서 상한 관련 문장 삭제. 재검증: test 273건·lint·typecheck·build 통과. 이 400 변경은 단위·라우트 테스트로만 확인했고 dev 서버 curl은 다시 돌리지 않았다.
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
