# 현재 기능: 참여자 등록 API (MEMBER-API-03)

## 상태

완료

## 스펙

`context/features/006-participant-registration-api.md`

## 목표

모집 중인 약속에 닉네임·PIN으로 참여자를 등록하고 세션을 발급한다. 정원·닉네임 경쟁, 응답 유실 복구, 이미 참여한 브라우저의 중복 등록을 일관되게 처리한다.

## 수용 기준

- [x] AC-1 Origin 403, 전 응답 `Cache-Control: no-store`
- [x] AC-2 본문 400 / 닉네임·PIN 422 / promiseId 형식 400 / 404 / 취소 409
- [x] AC-3 유효 세션(active 참여자) 쿠키 → 409 `ALREADY_PARTICIPANT`, 없음·위조·만료·cancelled 참여자 → 진행
- [x] AC-4 해시는 잠금 전, `promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`
- [x] AC-5 잠금 후 cancelled 409 → draft 410/409 → closed·confirmed 409 → 마감 409
- [x] AC-6 닉네임(cancelled 포함) 409 — 정원보다 먼저, P2002도 409
- [x] AC-7 정원 409
- [x] AC-8 세션 `linkExpiryBase + 7일`, `sessionCookie`, Max-Age 남은 초
- [x] AC-9 201 본문 명세 표 그대로
- [x] AC-10 PIN·토큰 원문 로그·응답 없음
- [x] AC-11 병렬 등록 정원·닉네임 각 1건만 201

## 작업 기준점

- 브랜치: `ahn/feat-참여자등록-api` (`main` d7ca1c6에서 생성, STATE-API-02 PR #10 병합 포함)
- 시작 시 작업 트리: 깨끗함. 병합된 로컬 `ahn/feat-설정완료-api` 삭제
- 선행 모듈 확인: `lib/member/session-auth.ts`, `nickname.ts`(`normalizeNickname`), `pin.ts`(`hashPin`), `session.ts`, `link-status.ts`(`linkExpiryBase`), `lib/origin.ts`, `lib/api-error.ts`(`DRAFT_EXPIRED`) 모두 있음

## 검증 결과

2026-11-04, Node.js v24

| 명령 | 결과 |
| --- | --- |
| `npm run test` | 통과 — 19 파일, 330 테스트 (이번 57건: participant-registration 25, participants route 26, session-auth 선택적 확인 6) |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 — `/api/v1/promises/[promiseId]/participants` 동적(ƒ) |
| dev 서버 + 개발 DB: 링크 발급 → 방장 등록 → 설정 완료 → 참여자 등록 | 201, 본문 명세 그대로(`currentParticipantCount` 2, `participantLimit` 3), `no-store`, Set-Cookie 속성 `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/{id}`, Max-Age=862501 = 마감(11-07 18:00) + 7일까지 남은 초. 저장: role=member·status=active·scrypt 해시, 세션 11-14 18:00(+09:00) |
| 중복 참여 | 참여자 쿠키로 다른 닉네임 409 `ALREADY_PARTICIPANT`, 방장 쿠키도 409, 위조 쿠키는 등록 진행(이미 있는 닉네임이라 409 `NICKNAME_TAKEN`) |
| 실패 응답 | Origin 없음 403, 깨진 본문 400, PIN 형식 422, UUID 형식 오류 400, 없는 약속 404 |
| 병렬 정원 경쟁 | 남은 자리 1개(정원 3)에 다른 닉네임 2건 → 201 1건, 409 `PROMISE_FULL` 1건 |
| 병렬 닉네임 경쟁 | 같은 닉네임 2건 → 201 1건, 409 `NICKNAME_TAKEN` 1건 |
| 응답 유실 복구 | 등록 201 → 쿠키 없이 같은 닉네임 재시도 409 `NICKNAME_TAKEN` → 같은 닉네임·PIN 로그인(MEMBER-API-04) 200, 같은 participantId |
| 로그 | dev 로그에 오류·PIN·토큰 없음 |
| 정리 | 확인용 링크 2·약속 2·참여자 6·세션 7 삭제, 5개 테이블 스냅샷(행 수·md5)이 시작 상태와 동일 |

DB 스키마 변경 없음 → `db:status` 해당 없음. UI 변경 없음 → 브라우저 확인 해당 없음. cancelled 약속·draft·closed·confirmed·마감 경과·cancelled 참여자 닉네임·만료/cancelled 참여자 세션은 단위 테스트로만 확인했다(dev 서버 미확인).

## 메모

- 문서 수정: member.md MEMBER-API-03(규칙 연결, 중복 참여 절, 설정 값 문장, 에러 표, 처리 순서·닉네임 우선 이유, 보안), DECISION_CONFLICTS(R-13 신설, A-09), API_CONVENTIONS 5.2(참여자 등록 세션 행).
- 판단·미결은 스펙의 「미정 사항」에 정리했다.
- 검토 후(2026-11-04, 판단 1~5 승인): 모든 API 라우트(links, links/[inviteToken], host, auth/session, start, participants)의 모든 응답에 `Cache-Control: no-store` 적용. 빠져 있던 곳은 links 발급·host·auth/session. 공통 헬퍼 `lib/no-store.ts`로 모으고 라우트별 no-store 테스트 추가. 재검증: test 355건·lint·typecheck·build 통과, dev 서버에서 links 403·host 404·auth/session 400·404에 `no-store` 확인(DB 쓰기 없는 요청만). `/api/health`는 요청 범위 밖이라 그대로 둠.

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
