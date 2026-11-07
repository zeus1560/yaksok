# 현재 기능: 마감·후보·확정·결과 화면 (화면 PR 4)

## 상태

검토 중

## 스펙

`context/features/018-result-ui.md`

## 목표

참여 뒤 화면이 상태 조회(STATE-API-01) 5초 폴링으로 시간 입력(collecting)·후보(closed)·결과(confirmed)를 고른다. 방장 마감(STATE-API-04)·후보 조회와 확정(STATE-API-10·05)·결과·초대 링크 복사, closed·confirmed 모두의 시간 읽기 전용, 012 이월 머리글 "응답 마감됨". API·DB 변경 없음.

## 수용 기준

스펙 `context/features/018-result-ui.md` AC-1~9 참고.

## 작업 기준점

- 브랜치: `ahn/feat-결과화면` (`main` 3d2e063에서 생성, 017 PR #22 병합 포함)
- 시작 시 작업 트리: 깨끗함. 원격이 사라진(`gone`) 로컬 `ahn/` 브랜치 없음 → 삭제 없음. 원격이 남은 로컬 `ahn/` 브랜치 15개는 그대로 둠
- 첫 커밋은 017 완료 기록(스펙 017 상태, 완료 이력, feature-list)

## 검증 결과

2026-11-09, Node.js 24

| 단계 | 명령 | 결과 |
| --- | --- | --- |
| RED | `npx vitest run lib/result/view.test.ts lib/result/failure.test.ts` (빈 구현: `decideRoomView`는 항상 `{ kind: "input", canClose: false }`, `classifyConfirmFailure`는 항상 `{ kind: "retry", message: "" }`) | 2건 실패. 「closed이고 방장이면 확정 버튼이 있는 후보 화면」 `AssertionError: expected { kind: 'input', canClose: false } to deeply equal { Object (kind, canConfirm) }`, 「확정 422 INVALID_CONFIRMATION_CANDIDATE면 안내 후 후보를 다시 조회」 `AssertionError: expected { kind: 'retry', message: '' } to deeply equal { kind: 'refetch_candidates', …(1) }` |
| GREEN | 같은 명령 | 2건 통과 |
| REFACTOR | `npm run test` | 56 파일, 1123 테스트 통과(기존 1050 + 이번 73: `view` 13, `failure` 41, `format` 14, `poll-delay` 5 — 직전 요청 5초·6초면 다음 간격 최소 1초 포함). PowerShell `$env:TZ`로 `UTC`·`America/Los_Angeles`에서도 통과(1121건 시점에 실행, 이후 추가 2건은 시간대와 무관한 간격 계산) |
| | `npm run lint` / `npm run typecheck` | 통과 |
| | `npm run build` | 통과(dev 서버 종료 후) |

| 브라우저 (Playwright + 로컬 Chromium, 방장 1280px·참여자 390px, 48개 항목 2회 실행 전부 통과) | 결과 |
| --- | --- |
| collecting | 방장에게만 "응답 마감하기", 머리글 "마감 {시각}" |
| 마감 | 확인 창 → 요청 중 "마감하는 중…" 비활성(응답 1.2초 지연으로 확인) → 방장 바로 후보 화면, 참여자 마감 응답 후 1.9초·2.4초에 후보 화면(폴링 위상에 따라 다름) |
| 후보 | 상위 5개·"3명 가능", 참여자는 확정 버튼 없이 "방장이 확정하면 여기에 표시돼요", 방장 더 보기 → 9개·더 보기 숨김 |
| 조기 마감 머리글 | 모두의 시간 보기에서 "응답 마감됨", 설정 마감 시각 없음, 제출 버튼 없음, 390px는 모두의 시간 탭 먼저 |
| 422 | 방장 불참 후보(D2 09:00, 참여자 2명) 확정 창에 방장 불참 안내 → DB에서 참여자 C의 그 구간 슬롯 2행 삭제 → 확정 → "후보가 바뀌었어요"·후보 처음부터 다시 조회(그 후보 사라짐) |
| 응답 유실 | Playwright route로 서버 200 처리 후 응답 끊기 → "확정하지 못했어요" → 다시 확정 409 → 상태 조회 → 결과 화면, DB confirmed 1회·고른 후보와 같은 일정 |
| 결과 | 참여자 화면이 결과 화면으로, "한국 시간 기준·함께 가능한 사람 3명", 초대 링크 복사(클립보드 = `http://localhost:3000/p/{token}`), 참여자 경고 없음 |
| hostActionRequired | DB에서 확정 구간 참여자 B·C 슬롯 4행 삭제 → 방장에게 "지금 참석 가능한 사람이 2명 미만이에요"·1명, 참여자는 1명·경고 없음 |
| confirmed 모두의 시간 | "응답 마감됨 · 확정된 약속이에요", 제출 버튼 없음, 확정 후 마감 버튼 없음 |
| 390px | collecting·후보·모두의 시간(closed·confirmed)·결과에서 가로 스크롤 없음 |
| 콘솔 | 예상 밖 오류 없음. 의도한 422·응답 끊기·409에 대한 브라우저 네트워크 로그 3건만 |
| 폴링 | 보정 전 요청 간격 5.78초(SWR이 응답 뒤부터 셈) → 보정 후 5.01~5.02초, 요청 소요 0.74~1.45초. 탭 숨김 12초 동안 요청 0건, 복귀 10ms 뒤 조회, 500 11초 동안 "연결이 불안정해요"·마감 버튼 유지 → 복구 뒤 안내 사라짐 |
| 정리 | 확인용 링크 5·약속 5·참여자 11·세션 11·슬롯 66행 삭제, 6개 테이블(`_prisma_migrations` 포함) 행 수·md5 시작 상태와 동일. dev 서버 종료, 3000 포트·`next` 프로세스 없음 |

## 메모

- 다른 참여자 화면 전환은 "마감 뒤 처음 시작한 상태 조회"에서 일어난다. 최악은 5초 + 응답 시간(개발 DB 기준 0.7~1.5초)
- RESULT-11-02(목록 밖 후보 확정) ❗미결은 요청과 API(AC-2)대로 더 보기 후보도 확정 가능 — 팀 확인 필요(R-24)

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
