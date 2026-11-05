# 현재 기능: 약속 만들기 화면 (홈 → 방장 등록 → 설정 → 완료)

## 상태

검토 중

## 스펙

`context/features/009-create-promise-ui.md`

## 목표

웹에서 방장이 링크 발급 → 방장 등록 → 필수 설정(날짜 범위·하루 시간·소요 시간·정원·마감)을 10분 안에 마치고 초대 링크를 복사한다. 같은 링크를 연 다른 사람은 설정이 끝날 때까지 대기 화면에서 폴링한다. API·DB 변경 없음.

## 수용 기준

- [x] AC-1 홈 버튼: 요청 중 비활성·"만드는 중…", 성공 시 `/p/{token}`, 실패 안내
- [x] AC-2 링크 분기: 등록·대기(폴링)·404·410·임시 참여, 저장소 복원 우선
- [x] AC-3 방장 등록: 화면 검증, 422 `details.field`, 409 → 대기
- [x] AC-4 날짜: 오늘 이전·R-07 상한 초과 불가, 종료일 내일부터, 오늘만 안내
- [x] AC-5 하루 시간: 30분 드롭다운, 기본 09:00~24:00, 종료는 시작보다 늦은 시각만
- [x] AC-6 소요 시간: −/+ 30분, 기본 2시간, 범위 축소 시 자동 감소 + 안내
- [x] AC-7 정원 2~30, −/+와 직접 입력
- [x] AC-8 마감 기본값(TIME-13-02 확정), 직접 수정 후 유지, `+09:00` 전송
- [x] AC-9 경과 시간 카운트다운·1분 강조·새로고침 복원, 0이어도 화면이 막지 않음
- [x] AC-10 422 입력란 표시, 410 안내·저장소 삭제·방장 등록 화면 복귀
- [x] AC-11 완료 화면 요약·배지·복사 토스트·비활성 입력 버튼
- [x] AC-12 모바일 한 열 / 넓은 화면 두 열, PIN·세션 로그 없음, 같은 출처 fetch

## 작업 기준점

- 브랜치: `ahn/feat-약속만들기-화면` (`main` 477127c에서 생성, TIME-API-02 PR #13 병합 포함)
- 시작 시 작업 트리: 깨끗함. 원격이 사라진(`gone`) 로컬 `ahn/` 브랜치 없음 → 삭제 없음. 원격이 남은 로컬 브랜치: `ahn/feat-가능시간제출-api`, `ahn/feat-가능시간조회-api`, `ahn/feat-로그인-api`, `ahn/feat-링크조회-api`, `ahn/feat-방장등록-api`, `ahn/feat-참여자등록-api`
- 선행 확인: `app/api/v1/links`(POST), `links/[inviteToken]`(GET), `links/[inviteToken]/host`(POST), `promises/[promiseId]/start`(POST) 모두 main에 있음

## 검증 결과

2026-11-05, Node.js v24.20.0

| 명령 | 결과 |
| --- | --- |
| `npm run test` | 통과 — 30 파일, 521 테스트 (이번 53건: date-range 14, deadline 10, time-options 8, countdown 8, start-failure 11, format 2 — `lib/create-promise/`) |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 (dev 서버 종료 후) — `/` 정적(○), `/p/[inviteToken]` 동적(ƒ) |
| 브라우저 (Playwright + 로컬 Chromium, 프로젝트 의존성 추가 없이 scratchpad에 설치) | 아래 표 |

| 브라우저 확인 | 결과 |
| --- | --- |
| 홈 → 새 약속 만들기 → `/p/{token}` → 방장 등록 → 설정 → 완료 → 링크 복사 | 통과. 클립보드 값 = 초대 주소, "링크를 복사했어요" 토스트, "내 가능 시간 입력하기" 비활성 |
| 화면 검증 | 닉네임 1자·PIN 2자리 → 각 입력란 오류 |
| 설정 중 새로고침 | 설정 화면 복원, 카운트다운 9:57 → 9:57로 이어짐 |
| 다른 브라우저(390px)로 같은 링크 | 대기 화면 → 방장 완료 후 폴링으로 "참여 화면은 준비 중입니다"로 바뀜 |
| 오늘만 선택 | "오늘 하루짜리 약속은…" 안내 |
| 마감 기본값 | 오늘~12.10 → 12-09T23:59(시작일 전날 지남 → 종료일 전날), 12.10~12.20 → 12-09T23:59, 직접 18:00으로 수정 후 범위 변경 → 유지 |
| 하루 범위 18:00~19:00 | 소요 2시간 → 1시간 자동 감소 + 안내, 종료 목록 18:30~24:00(12개) |
| 정원 40 입력 | 30으로 보정 |
| 완료 화면 | 제목 "12.11–12.21 · 방장 포함 4명", 저장소 값 삭제 |
| 10분 초과(개발 DB에서 draft `created_at` −11분) 후 설정 완료 | 410 → "설정 시간이 지났어요…" + 방장 등록 화면, 저장소 삭제 |
| 390px 너비 | 한 열 배치, `scrollWidth` 390(가로 스크롤 없음) |
| `/p/notatoken` | "잘못된 링크" 안내 |
| 브라우저 콘솔 | 오류·PIN 없음 |
| 정리 | 확인용 링크 3개와 딸린 약속·참여자·세션 삭제, 5개 테이블 스냅샷(행 수·md5)이 시작 상태와 동일. dev 서버 종료, 3000 포트 비어 있음 |

미확인: 만료 링크 410 화면(7일 경과 데이터를 만들지 않음 — 404와 같은 컴포넌트), 422 서버 오류의 입력란 표시(화면 검증이 먼저 막아 서버 422를 유도하지 않음), 1분 이하 강조 색, 실제 휴대폰 기기.

## 메모

- 문서 수정: DECISION_CONFLICTS R-15(화면 결정)·R-16(TIME-13-02 확정, 종료일 오늘 빈틈) 신설, C-04 해결, 미결 수 TIME 24 → 23·합계 80 → 79(README 포함). TIME.md TIME-13-02 확정·미결 목록에서 제외.
- 화면용 순수 로직은 서버 전용이 아니라 `lib/create-promise/`에 두었다(브라우저에서도 import). `lib/state/start-settings.ts`·`lib/time/seoul.ts`·`lib/member/nickname.ts`의 순수 함수·상수를 재사용해 서버 검증과 값이 어긋나지 않게 했다.
- `/p/[inviteToken]` 분기는 클라이언트가 링크 조회 API를 호출한다. 저장소 복원과 폴링이 브라우저에서만 가능하기 때문이다.
- 글꼴: Figma는 Noto Sans KR이지만 웹 폰트를 받지 않고 CSS 글꼴 목록(Pretendard → Noto Sans KR → 시스템 한글)으로 지정. 기존 Geist 폰트·create-next-app 홈 제거.
- 새 의존성 없음.
- 검토 후(2026-11-06): 설정 완료 실패를 상태 코드가 아니라 에러 코드로 분기하도록 수정(`lib/create-promise/start-failure.ts`). 저장소 삭제 + 재조회는 `DRAFT_EXPIRED`·`UNAUTHENTICATED`·`FORBIDDEN`·`PROMISE_NOT_FOUND`·`PROMISE_CANCELLED`·`INVALID_PROMISE_STATE`만. `INVALID_ORIGIN`·422·400·5xx·네트워크 오류는 저장소를 유지하고 오류 안내. 409 복구(대기 화면의 "방장이신가요? 로그인" → host면 설정 화면)는 PR 2로 넘김(스펙 009·feature-list 기록).

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
