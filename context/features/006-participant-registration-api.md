# 참여자 등록 API (MEMBER-API-03)

## 식별자와 상태

- 스펙 ID: `006-participant-registration-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-03-02(draft 대기), MEMBER-05-01·05-05·05-06(닉네임·중복·탈퇴자 포함), MEMBER-06-01·06-03(PIN·세션), MEMBER-07-02(정원 집계), MEMBER-11-01·11-02(재참여 불가), STATE-02-02(draft 10분), STATE-06-01(마감 후 참여 불가)
- 결정: R-10(닉네임 정규화·scrypt), R-11(`linkExpiryBase`·에러 코드 통일), R-12(만료 draft 410·promiseId 형식 400), C-07(cancelled 참여자 세션은 무효)
- ERD: DATABASE.md 4절(`UNIQUE(promise_id, normalized_nickname)`), 8.2절(신규 참여 한 트랜잭션)
- API: MEMBER-API-03 (`docs/specs/api/member.md`), API_CONVENTIONS 3·4.1-3·4.2·5·5.2·6·7절
- 관련 미결·충돌: EXCEPTION-02-01·03-01·10-02(본문 미작성 — 이번 요청서 확정 사항으로 결정, DECISION_CONFLICTS R-13), A-09(Origin — 03 반영), MEMBER-06-04(시도 제한 미결, 이 API는 PIN 검증을 하지 않음)

## 사용자와 문제

링크를 받은 사람이 모집 중인 약속에 닉네임·PIN으로 참여하고 세션을 받아야 가능 시간을 입력할 수 있다. 마지막 자리·같은 닉네임 경쟁, 응답 유실 후 재시도, 이미 참여한 브라우저의 중복 등록을 일관되게 처리해야 한다.

## 목표와 범위

- 구현: `POST /api/v1/promises/[promiseId]/participants`, 등록 트랜잭션, 세션 인증 모듈의 선택적 확인 모드, 테스트, 문서 갱신
- 제외: 화면, 레이트 리밋([제안]), 탈퇴·내보내기 API, DB 스키마 변경

## 선행 작업

005(STATE-API-02) — `session-auth.ts`, 004 — `linkExpiryBase`·`sessionMaxAgeSeconds`, 003 — `normalizeNickname`·`hashPin`·세션 모듈

## 사용자 흐름

참여 화면에서 닉네임·PIN 제출 → Origin 403 → 본문 400 / 닉네임·PIN 422 → promiseId 형식 400 → 약속 없음 404 → 취소 409 → 유효 세션(active 참여자) 쿠키가 있으면 409 `ALREADY_PARTICIPANT`(없거나 무효면 진행) → PIN 해시 → 트랜잭션: `promises` `FOR UPDATE`, 잠금 후 `clock_timestamp()` → 취소 409 → draft(만료 410 / 진행 중 409 `PROMISE_NOT_OPEN`) → closed·confirmed 409 → 마감 409 → 닉네임 409 → 정원 409 → 참여자·세션 생성 → 201 + 쿠키.

`NICKNAME_TAKEN`을 받으면 같은 닉네임·PIN으로 로그인(MEMBER-API-04)해 본인 여부를 가린다.

## 수용 기준

- [x] AC-1 (A-09): Origin 없음·불일치 403 `INVALID_ORIGIN`, 모든 응답 `Cache-Control: no-store`
- [x] AC-2: 본문 파싱·필드 400, 닉네임(`validateNickname`)·PIN 형식 422, promiseId 형식 400(R-12), 없는 약속 404, 취소 409 `PROMISE_CANCELLED`
- [x] AC-3 (EXCEPTION-10-02, R-13): 쿠키 세션이 유효하고 active 참여자의 것이면 409 `ALREADY_PARTICIPANT`. 쿠키 없음·위조·만료·cancelled 참여자 세션이면 401 없이 진행. `session-auth.ts`의 선택적 확인 모드 사용
- [x] AC-4 (4.1-3·4.2): PIN 해시는 잠금 전. `promises` 행만 `FOR UPDATE`, 판정 시각은 잠금 후 `clock_timestamp()`
- [x] AC-5 (STATE-02-02, MEMBER-03-02, STATE-06-01): 잠금 후 cancelled 409 → draft 10분 경과 410 `DRAFT_EXPIRED`(삭제 없음) / 이내 409 `PROMISE_NOT_OPEN` → closed·confirmed 409 `INVALID_PROMISE_STATE` → 판정 시각 ≥ 마감 409 `DEADLINE_PASSED`(상태 변경 없음)
- [x] AC-6 (MEMBER-05-05·05-06, R-13): 같은 `normalized_nickname`이 상태와 무관하게(cancelled 포함) 있으면 409 `NICKNAME_TAKEN` — 정원 검사보다 먼저. P2002도 409 `NICKNAME_TAKEN`. 기존 닉네임 PIN 검증·로그인 없음
- [x] AC-7 (MEMBER-07-02): active 수 ≥ 정원이면 409 `PROMISE_FULL`
- [x] AC-8 (5.2): 새 세션 `expires_at = linkExpiryBase + 7일`, 쿠키는 `sessionCookie`, Max-Age = 남은 초(내림)
- [x] AC-9: 201 본문 명세 표 그대로(설정 값 없음), `currentParticipantCount` = 등록 후 active 수
- [x] AC-10: PIN·세션 토큰 원문을 로그·응답에 남기지 않음
- [x] AC-11 (EXCEPTION-02-01·03-01): 병렬 등록 — 마지막 자리 1건만 201, 같은 닉네임 1건만 201

## 데이터와 인터페이스

스키마 변경 없음. 쓰기: `participants` 1행(role=member, status=active), `participant_sessions` 1행. 응답·에러는 MEMBER-API-03 명세.

## 구현 계획

1. `lib/member/session-auth.ts`: 쿠키 세션 조회를 내부 함수로 분리, 선택적 확인 `findActivePromiseSession` 추가 (기존 `authenticatePromiseSession` 동작 유지)
2. `lib/member/participant-registration.ts`: 순수 판정 `resolveJoinAccess`, `registerParticipant`(사전 확인 → 해시 → 트랜잭션)
3. `lib/api-error.ts`: `PROMISE_NOT_OPEN`·`DEADLINE_PASSED`·`PROMISE_FULL`·`NICKNAME_TAKEN`·`ALREADY_PARTICIPANT` 헬퍼
4. `app/api/v1/promises/[promiseId]/participants/route.ts`
5. 문서: member.md MEMBER-API-03, API_CONVENTIONS 3절 코드 표, DECISION_CONFLICTS(R-13 신설, A-09)

## 검증 계획

- Vitest: 판정 단위(상태별·10분 경계·마감 경계·정원 경계·cancelled 닉네임·정원 찬 상태 닉네임 우선), 선택적 확인(유효·만료·위조·cancelled 참여자), 라우트(403·400·422·형식 400·404·Set-Cookie)
- dev 서버 + 개발 DB: 링크 발급 → 방장 등록 → 설정 완료 → 참여자 등록, 병렬 정원 경쟁, 병렬 닉네임 경쟁, 응답 유실 복구(NICKNAME_TAKEN → 로그인 200). 확인용 데이터 삭제 후 스냅샷 비교
- `npm run lint` / `typecheck` / `build` / `test`

## 미정 사항

- 합의(요청서 2026-11-04): 처리 순서·에러 코드·닉네임 우선 순서·세션 만료 기준은 위 수용 기준대로 확정.
- 아래 판단 1~5(쿠키 미재전송, 기존 참여 확인 우선, `INVALID_PROMISE_STATE` 문구, `NICKNAME_TAKEN` details, 다른 약속 세션 무시)는 2026-11-04 모두 승인됨.
- 판단: `ALREADY_PARTICIPANT` 응답에는 쿠키를 다시 보내지 않는다. 선택적 확인은 인증이 아니므로 R-12의 "세션 인증 성공 후 모든 응답 쿠키 갱신" 대상에서 뺐다.
- 판단: 이 약속 쿠키 이름에 다른 약속의 세션이 들어 있으면 무효 쿠키와 같이 보고 등록을 진행한다.
- 판단: 기존 참여 확인이 잠금 전 단계이므로, 유효 세션 보유자는 draft 만료·마감·정원보다 `ALREADY_PARTICIPANT`를 먼저 받는다(요청서 순서 그대로).
- 판단: 닉네임 우선 순서 때문에 정원이 찬 약속에서 남의 닉네임과 겹친 신규 사용자도 `NICKNAME_TAKEN`을 받는다. 어느 쪽이든 거절이라 결과는 같다.
- 판단: `INVALID_PROMISE_STATE`는 기존 공통 헬퍼(문구 "현재 약속 상태에서는 요청할 수 없습니다." + `details.promiseStatus`·`allowedStates: ["collecting"]`)를 쓴다. 명세 예시 문구("마감된 약속에는…")를 표에서 공통 문구로 바꿨다.
- 판단: `NICKNAME_TAKEN`은 API_CONVENTIONS 3절 예시처럼 `details.field = "nickname"`을 붙인다.
- 판단: collecting인데 `voting_deadline_at`·`participant_limit`이 NULL이면(CHECK로 불가능한 상태) 500.
- 판단: 요청서 문서 수정 목록 밖이지만 API_CONVENTIONS 5.2 세션 만료 표에 "참여자 등록으로 발급" 행 1개를 추가했다.
- 남은 미결: 레이트 리밋 [제안], MEMBER-06-04.
- 관찰 → 수정(같은 PR, 별도 fix 커밋): MEMBER-API-04 로그인 응답에 `Cache-Control: no-store`가 없었다. 전 라우트를 점검해 links 발급·host·auth/session에 추가하고 공통 `lib/no-store.ts`로 모았다. 라우트별 no-store 테스트 추가.

## 결과

- 수용 기준 AC-1~11 충족 (2026-11-04). Vitest 330건(이번 57건), lint·typecheck·build 통과. no-store 수정 후 355건 재검증 통과.
- 개발 DB: 링크 발급 → 방장 등록 → 설정 완료 → 참여자 등록 201, Max-Age = 마감 + 7일까지 남은 초, 병렬 정원·닉네임 경쟁 각 201 1건·409 1건, 응답 유실 → `NICKNAME_TAKEN` → 로그인 200. 확인용 데이터 삭제, 스냅샷 동일. 상세는 `context/current-feature.md`.
- 상태별 거절(cancelled·draft·closed·confirmed·마감)과 만료·cancelled 참여자 세션은 단위 테스트로만 확인했다.
