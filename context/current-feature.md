# 현재 기능: 가능 시간 제출 API (TIME-API-01)

## 상태

완료

## 스펙

`context/features/007-availability-submit-api.md`

## 목표

active 참여자(방장 포함)가 자기 미래 가능 시간 슬롯을 전체 교체 제출한다. 지난 슬롯은 보존·무시하고, 범위 밖 슬롯은 빼고 저장하며, 참여자별 `availability_version`으로 다른 기기의 제출을 덮어쓰지 않고 응답 유실 재시도는 200으로 처리한다.

## 수용 기준

- [x] AC-1 Origin 403, 전 응답 `Cache-Control: no-store`
- [x] AC-2 Content-Length·실제 크기 256KB 초과 413
- [x] AC-3 `session-auth.ts` 순서, 인증 후 모든 응답 쿠키 갱신
- [x] AC-4 본문 400 `INVALID_REQUEST`
- [x] AC-5 5,001개 422 `SLOT_LIMIT_EXCEEDED`
- [x] AC-6 형식 422 `INVALID_SLOT_FORMAT`, 중복 합침
- [x] AC-7 `promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, 상태 판정 순서, 마감 경과 closed 커밋 + 409
- [x] AC-8 잠금 후 세션·참여자 재확인 401
- [x] AC-9 지난 슬롯 무시·미집계, 범위 밖 droppedSlotCount
- [x] AC-10 버전 충돌 409(details) / 재시도 200
- [x] AC-11 미래 슬롯만 교체, 제출 시각·버전 +1, 빈 배열 제출
- [x] AC-12 200 본문 명세 형식
- [x] AC-13 토큰·쿠키 로그 없음

## 작업 기준점

- 브랜치: `ahn/feat-가능시간제출-api` (`main` c546c8e에서 생성, MEMBER-API-03 PR #11 병합 포함)
- 시작 시 작업 트리: 깨끗함. 원격이 사라진(`gone`) 로컬 `ahn/` 브랜치 없음 → 삭제 없음. 원격이 남은 로컬 브랜치: `ahn/feat-로그인-api`, `ahn/feat-링크조회-api`, `ahn/feat-방장등록-api`, `ahn/feat-참여자등록-api`
- 선행 확인: `lib/member/session-auth.ts`, `lib/origin.ts`, `lib/api-error.ts`(`PROMISE_NOT_OPEN`·`DRAFT_EXPIRED`), `lib/time/seoul.ts` 있음. 스키마에 `participants.availability_version`·`availability_submitted_at`, `participant_available_slots` 있음 → 스키마 변경 없음

## 검증 결과

2026-11-04, Node.js v24

| 명령 | 결과 |
| --- | --- |
| `npm run test` | 통과 — 22 파일, 433 테스트 (이번 78건: slots 25, submit-availability 19, availability route 33, seoul 1) |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 — `/api/v1/promises/[promiseId]/me/availability` 동적(ƒ) |
| dev 서버 + 개발 DB: 링크 발급 → 방장 등록 → 설정 완료 → 참여자 등록 → 제출 | 200 `{version:1, submitted:true, submittedAt:"…19:08:03.587+09:00", slots:[11-10 09:00, 09:30, 11-12 23:30], droppedSlotCount:1}` — `.000` 중복 합침, 24:00 범위 23:30 통과, 다음 날 00:00 제외(1건), 지난 슬롯(11-04 09:00) 무시·미집계. no-store, Set-Cookie Max-Age = 마감 + 7일까지 남은 초 |
| 두 기기 같은 baseVersion | 기기 2(로그인 세션, base 0, 다른 내용) → 409 `AVAILABILITY_VERSION_CONFLICT`, details `{currentVersion:1, submitted:true, slots(.000+09:00)}` |
| 같은 요청 재전송 | 기기 1 base 0 재전송 → 200, version 1·submittedAt 그대로 |
| 재제출 | base 1 빈 배열 → 200 version 2, slots []. DB에 지난 슬롯(11-04 09:00)을 직접 넣은 뒤 base 2 재제출 → 지난 슬롯 보존 + 미래 슬롯 교체, DB version 3 |
| 마감 경과 | `voting_deadline_at`을 과거로 바꾼 뒤 제출 → 409 `VOTING_CLOSED`, DB status `closed` 커밋 확인, 버전 3 그대로. 재요청 409 `VOTING_CLOSED` |
| 실패 응답 | 422 `INVALID_SLOT_FORMAT`(분 15), 400(baseVersion 문자열) — 둘 다 쿠키 갱신. Origin 없음 403, 300,000바이트 본문 413, 쿠키 없음 401 — 쿠키 없음 |
| 로그 | dev 로그에 오류·토큰·쿠키 값 없음 |
| 정리 | 확인용 링크 1·약속 1·참여자 2·세션 3·슬롯 2 삭제, 5개 테이블 스냅샷(행 수·md5)이 시작 상태와 동일 |

DB 스키마 변경 없음 → `db:status` 해당 없음. UI 변경 없음 → 브라우저 확인 해당 없음. draft·만료 draft·confirmed·cancelled·탈퇴 참여자·다른 약속 세션은 단위 테스트로만 확인했다(dev 서버 미확인).

## 메모

- 문서 수정: time.md TIME-API-01(허용 상태·상태 전환·상한, Origin 헤더, 에러 표, 처리 순서 1~5, 보안 정보, 코드 예제 안내), 「두 기기 충돌」 `SUBMISSION_CONFLICT` → `AVAILABILITY_VERSION_CONFLICT`, 상태별 허용 표 TIME-API-01 draft 칸, 결정·미결 목록 체크. DECISION_CONFLICTS R-14 신설, C-08 보강, A-05 해결, A-09 TIME-API-01 ✅.
- 판단·미결은 스펙의 「미정 사항」에 정리했다.
- 검토 후(2026-11-05, 판단 1·2·5 승인): ① 재시도 200의 `slots`는 이미 서버 저장값 전체(지난 슬롯 포함)였음을 확인하고, 요청에 없는 지난 슬롯도 응답에 담기는 테스트를 추가. ② 409 details `slots`를 200과 같은 초 단위로 통일(밀리초 3자리는 `submittedAt`만), TIME 명세 예시·TIME-API-02 `availableSlots`·`me.slots` 형식·시간 표기 규약 갱신, R-14에 근거 추가. ③ API_CONVENTIONS 3절 공통 에러 코드에 413 `PAYLOAD_TOO_LARGE` 추가. 재검증: test 433건·lint·typecheck·build 통과. dev 서버 재확인은 하지 않았다(표기 변경은 route 단위 테스트로 확인).

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
