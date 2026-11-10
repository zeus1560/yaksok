# 현재 기능: 방장 관리 화면 (화면 PR 5a)

## 상태

검토 중

## 스펙

`context/features/027-host-manage-ui.md`

## 목표

방장 전용 메뉴(화면 위쪽, `/me` 기준)에서 모집 중 설정 변경(STATE-API-03)·재조율(STATE-API-06)·약속 취소(STATE-API-07)를 하고, 모든 참여자가 명단(MEMBER-API-06)과 정원 현황을 보며, 방장은 모집 중에 참여자를 내보낸다(MEMBER-API-08). API·DB 변경 없음. 탈퇴·로그아웃·시간 입력 화면 버그는 다음 PR(5b).

## 수용 기준

스펙 `context/features/027-host-manage-ui.md` AC-1~8 참고.

## 작업 기준점

- 브랜치: `ahn/feat-방장관리-화면` (`main` 9ed4e75에서 생성, 026 PR #31 병합 포함)
- 시작 시 작업 트리: 깨끗함(`ahn/fix-공통가드-정리`에서 `main`으로 전환 후 `git fetch --prune`·`git pull`). 원격이 사라진 로컬 `ahn/` 브랜치 없음(원격이 남은 로컬 `ahn/` 브랜치는 그대로 둠)
- 첫 커밋은 026 완료 기록(스펙 026 상태, 완료 이력, feature-list) — 스테이징해 둠

## 검증 결과

2026-11-10, Node.js 24

| 단계 | 명령 | 결과 |
| --- | --- | --- |
| RED | `npx vitest run lib/manage` (빈 구현: `buildSettingsBody`가 `{}`, `classifyCancelFailure`가 retry) | 2건 실패. 「설정 변경은 바꾼 필드만 보내고 날짜 범위를 안 바꿨으면 dateRange를 보내지 않는다」 `AssertionError: expected {} to deeply equal { participantLimit: 6, …(1) }`, 「취소 요청 뒤 409 PROMISE_CANCELLED는 성공으로 처리한다」 `AssertionError: expected { kind: 'retry', message: '' } to deeply equal { kind: 'done' }` |
| GREEN | 같은 명령 | 2건 통과(바꾼 필드만 모으는 `changedFields` + 마감 분 단위 비교, 취소 409 `PROMISE_CANCELLED` → done) |
| REFACTOR | 실패 분기·폼 검증·미리 보기·안내 문구 테스트 추가(`lib/manage` 69건), prettier / `npm run test` | 73 파일, 1594 테스트 통과(1525 + 69, 기존 기대값 수정 없음). `$env:TZ` `UTC`(오프셋 0)·`America/Los_Angeles`(오프셋 480)에서도 1594건 통과 |
| | `npm run lint` / `npm run typecheck` | 통과 |
| | `npm run build` | 통과(dev 서버 종료·3000 포트 비어 있음 확인 후) |

| 브라우저 (dev 서버, Playwright + 로컬 Chromium, 방장 1280px·참여자 390px) | 결과 |
| --- | --- |
| `scripts/verify/027-host-manage.mjs` 74개 항목 3회 통과 → 메뉴로 옮긴 응답 마감하기 10개 항목 추가 후 84개 항목 2회 전부 통과(추가 직후 첫 회는 dev 서버를 막 띄워 첫 화면 컴파일이 늦어 2건 시간 초과, 코드 변경 없이 다시 돌려 통과) | **방장 메뉴:** 방장만 "약속 관리"가 보이고 시간 입력 화면보다 위, 참여자에게는 없음. **명단:** 참여자 390px에서 3 / 6명·등록순·방장·나, 제출 여부·내보내기 버튼 없음, 방장은 본인 행 제외 2개 행에만 내보내기. **설정 변경:** 정원 − 비활성·마감 `min` = 현재 마감·바꾼 내용 없으면 저장 비활성, 마감 때문에 막히는 축소 안내·저장 비활성, 마감 단축은 안내만·PATCH 없음·DB 그대로, 정원 증가·마감 연장은 `participantLimit`·`votingDeadlineAt`만 전송·DB 반영·참여자 화면 정원·마감 머리글 반영 1.9~3.0초, 범위 축소 미리 보기(삭제만) → `dateRange`만 전송 → "범위 밖 입력 1칸을 지웠어요"·DB 슬롯 0·참여자 화면 날짜 칸 4 → 3, 범위 확대 미리 보기(재제출만) → "모든 참여자의 제출이 해제되어…"·참여자 날짜 칸 5. **내보내기:** 확인 창 → 명단 2명·2 / 7명, 내보내진 사람 화면은 다음 폴링 401로 링크 재조회 → 참여 화면, 대상 DB cancelled, DB로 마감 경과시키면 후보 화면·내보내기 버튼 없음·메뉴는 다시 열기·취소. **재조율:** closed(마감 경과 collecting)에서 새 마감 없으면 안내, 새 마감만 전송 → 방장·참여자 시간 입력 화면(5초 안)·DB collecting. confirmed에서 확정 해제 안내, 설정도 바꾸기 → 정원 하한 = 현재 인원 2, 범위 이동 미리 보기(삭제·재제출 둘 다), 정원·`dateRange`·새 마감만 전송 → "확정된 일정을 해제했어요"·DB 확정 NULL·참여자 화면 시간 입력. **취소:** 확인 창(되돌릴 수 없음), 요청 중 "취소하는 중…" 비활성, 요청 1회 → 취소 안내·DB cancelled·참여자 화면 취소 안내(5초 안). 응답 유실(closed 약속, Playwright route로 서버 200 뒤 응답 끊음) → "취소하지 못했어요" 화면 유지 → 다시 누름 409 `PROMISE_CANCELLED` → 취소 안내. **응답 마감하기(메뉴로 옮김):** 모집 중 방장 메뉴에만 보이고 일반 참여자에게 없음, 확인 창(요청 전 0회) → 마감 요청 1회·DB closed → 방장 화면 바로·참여자 화면 5초 안 후보 화면(018과 같은 흐름), 마감 후 메뉴에서 응답 마감하기가 사라지고 다시 열기·약속 취소만(설정 변경 없음), 참여자 390px 가로 스크롤 없음. **공통:** 390px 가로 스크롤 없음(명단·설정 변경 뒤·결과·취소 안내), 1280px도 없음, 콘솔 오류 없음(의도한 401·409·끊은 요청의 리소스 로드 메시지만) |
| 정리 | 회차마다 확인 링크 4·약속 4·참여자 9·세션 9·슬롯 4 삭제(84개 항목 판은 링크 5·약속 5·참여자 11·세션 11·슬롯 4), 6개 테이블(`_prisma_migrations` 포함) 행 수·md5가 시작 상태와 동일. dev 서버 종료, 3000 포트·`next` 프로세스 없음 |

## 메모

- 사용자 지시로 정한 것: 범위(방장 메뉴·설정 변경·재조율·취소·명단·내보내기), 바꾼 필드만·범위는 바꿨을 때만, 취소 409 성공 처리, `/me` 기준 방장 판단(`deadlinePassed` 미사용), 탈퇴·로그아웃·시간 입력 버그는 5b
- `lib/state/range-change.ts`는 서버 전용 의존성이 없어 화면에서 그대로 import(보고 대상 아님). 화면 검증도 서버 `settings-patch.ts`·`start-settings.ts` 함수 재사용
- 이번 구현 판단(R-33): 018 "응답 마감하기"를 방장 메뉴로 옮김, 명단 기본 접힘·5초 폴링, 미리 보기 "삭제" 안내는 칸 기준, 설정 변경·재조율 400 `INVALID_REQUEST`는 입력 확인 안내(018은 링크 재조회), 내보내기 404는 `PARTICIPANT_NOT_FOUND`만 재조회
- 문서: DECISION_CONFLICTS R-33 신설, 스펙 027 신설
- 검증 스크립트: `scripts/verify/027-host-manage.mjs`(Git 제외). dev 서버를 띄운 뒤 `PLAYWRIGHT_DIR=… CHROMIUM_PATH=… node scripts/verify/027-host-manage.mjs`, `SCREENSHOT_DIR`를 주면 주요 화면 4장 저장

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
