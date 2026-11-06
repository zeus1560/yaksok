# 세션·링크 만료 계산 통합 리팩터링

## 식별자와 상태

- 스펙 ID: `015-access-expiry-refactor`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-01-02(링크 7일), MEMBER-06-03(세션 갱신), STATE-02-02(draft 10분)
- ERD: DATABASE.md 6.2절(세션 만료는 `expires_at` 갱신)
- API: API_CONVENTIONS 5.2절, MEMBER-API-01·03·04, STATE-API-02 (`docs/specs/api/member.md`, `docs/specs/api/state.md`)
- 관련 결정·충돌: R-10(draft 세션 24시간), R-11(로그인 가능 기간 = 링크 유효 기간), R-13(참여자 등록 세션), C-10·C-11(이번에 잠정 결정을 기록, 팀 확정 필요)

## 사용자와 문제

사용자에게 보이는 변화는 없다. "draft를 뺀 모든 세션 만료 = 링크 만료(`linkExpiryBase + 7일`)" 계산이 `link-status.ts`(링크 410), `login.ts`(로그인 410·세션 발급), `participant-registration.ts`(세션 발급), `start-collecting.ts`(`SESSION_AFTER_DEADLINE_MS`로 따로 정의한 마감 + 7일)에 흩어져 있다. 조기 마감(STATE-API-04)·확정(STATE-API-05)이 같은 규칙으로 세션을 다뤄야 하므로 그 전에 한 곳으로 모은다.

## 목표와 범위

- 이번에 할 일:
  - 순수 함수 `accessExpiresAt(link)` = `linkExpiryBase(link) + 7일`을 `lib/member/link-status.ts`에 두고 링크 410 판정, 로그인 410·세션 발급, 참여자 등록 세션 발급이 같이 쓴다
  - 세션 일괄 갱신 헬퍼 `refreshActiveSessions(tx, { promiseId, link, now })`(`lib/member/session-expiry.ts`) — 새 상태로 계산한 `accessExpiresAt`으로 이 약속의 active 참여자의 아직 유효한 세션만 갱신, 만료됐거나 cancelled 참여자의 세션은 되살리지 않음. STATE-API-02가 쓰고 05가 그대로 쓴다
  - `SESSION_AFTER_DEADLINE_MS` 제거(값은 `LINK_EXPIRY_MS`와 같음)
  - draft 세션(발급 + 24시간)을 따로 두는 이유를 `lib/member/session.ts` 주석과 이 스펙에 남김
  - DECISION_CONFLICTS C-10·C-11에 잠정 결정과 만료 계산 위치를 기록
- 이번에 하지 않을 일: API 응답·DB 스키마·화면 변경, 확정·조기 마감 API, 명세 문구 수정(API_CONVENTIONS 5.2 표·state.md는 04·05에서)

## 선행 작업

002(`linkExpiryBase`), 004(로그인), 005(모집 시작 세션 갱신), 006(참여자 등록 세션). 모두 main에 있다.

## 사용자 흐름

변화 없음. 같은 입력에 같은 응답·같은 DB 결과가 나와야 한다.

## 수용 기준

- [x] AC-1 (MEMBER-01-02, R-11): `accessExpiresAt` 하나로 링크 410·로그인 410·로그인 세션·참여자 등록 세션 만료를 계산한다. 확정은 `confirmed_start_at + 7일`, 미확정은 `voting_deadline_at + 7일`, 마감 없음·미등록은 링크 발급 + 7일
- [x] AC-2 (MEMBER-06-03, STATE-API-02): 모집 시작 세션 갱신이 공통 헬퍼를 거치고 SQL 조건(active 참여자, `expires_at > 판정 시각`)·값은 전과 같다
- [x] AC-3: `SESSION_AFTER_DEADLINE_MS`처럼 7일을 따로 정의한 상수가 없다
- [x] AC-4 (R-10): draft 세션 24시간이 따로인 이유가 코드 주석·스펙에 있다
- [x] AC-5: 기존 테스트 기대값 변경 없이 전체 통과(3개 TZ), lint·typecheck·build 통과
- [x] AC-6: 개발 DB에서 모집 시작 세션 = 마감 + 7일, 로그인 세션 = 링크 만료, 만료·탈퇴 참여자 세션 미갱신이 리팩터링 전과 같다
- [x] AC-7: C-10·C-11에 "잠정(이 저장소 기준), 팀 확정 필요"와 만료 계산 위치 기록

## 데이터와 인터페이스

DB·API 변경 없음.

- `accessExpiresAt(link: AccessExpiryLink): Date` — `AccessExpiryLink = { createdAt; promise: { status; votingDeadlineAt; confirmedStartAt } | null }`. `linkExpiryBase`도 같은 좁은 타입을 받도록 넓혔다(기존 `LinkWithPromise`는 그대로 대입 가능)
- STATE-API-02의 링크 잠금 쿼리가 `created_at`도 읽는다(`SELECT id, created_at ... FOR UPDATE`, 잠금 대상·순서 동일). 새 상태는 마감이 있어 실제 기준으로 쓰이지는 않지만 `accessExpiresAt` 입력을 채우기 위해서다
- `refreshActiveSessions(tx, { promiseId, link, now })` → `{ expiresAt, sessionIds }`. `link`는 갱신 뒤 새 상태(예: 모집 시작이면 `status: "collecting"`·새 마감, 확정이면 `status: "confirmed"`·`confirmedStartAt`)

## draft 세션을 따로 두는 이유

draft에는 `voting_deadline_at`이 없어 `linkExpiryBase`가 링크 발급 시각으로 떨어진다. 이것으로 세션을 주면 "링크 발급 + 7일"이 되는데, draft는 10분 안에 설정을 끝내거나 삭제되는 상태라 그 값에 의미가 없다. 그래서 draft 세션은 발급 시각 + 24시간(R-10)으로 따로 두고, 모집 시작 때 공통 헬퍼가 마감 + 7일로 바꾼다. 링크 410 판정은 draft에서도 `accessExpiresAt`(링크 발급 + 7일)을 쓴다.

## 구현 계획

1. RED: `accessExpiresAt` 대표 테스트(확정 → `confirmed_start_at + 7일`, 미확정 → `voting_deadline_at + 7일`)
2. GREEN: `link-status.ts`에 함수 추가
3. REFACTOR: `resolveLinkStatus`·`resolveLoginAccess`·`registerParticipant`를 새 함수로, `start-collecting.ts` 세션 UPDATE를 `session-expiry.ts`로 이동, 상수 제거
4. 문서: DECISION_CONFLICTS C-10·C-11

## 검증 계획

- Vitest 전체(기존 기대값 그대로), `TZ=UTC`·`TZ=America/Los_Angeles`
- lint·typecheck·build(dev 서버 종료 후)
- 개발 DB: 모집 시작·로그인·탈퇴/만료 세션 미갱신을 리팩터링 전 코드(main)와 후 코드에서 같은 시나리오로 비교

## 미정 사항

- C-10·C-11은 이 저장소 기준 잠정 결정. 팀 확정 필요
- 명세 문구(5.2 표·state.md) 수정은 04·05에서

## 결과

AC-1~7 충족. 기존 테스트 기대값 변경 없음. 검증 근거는 `context/current-feature.md` 검증 결과 참고.
