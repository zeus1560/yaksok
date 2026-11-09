# 참여자 명단 조회 API (MEMBER-API-06)

## 식별자와 상태

- 스펙 ID: `023-participant-list-api`
- 상태: 검토 중

## 근거

- 비즈니스 규칙: MEMBER-07-02(활성 인원), MEMBER-08-01(비참여자 비공개), MEMBER-08-02(제출 여부 비공개), MEMBER-08-03(탈퇴자 제외), MEMBER-03-01(draft 비공개)
- ERD: DATABASE.md 3.3절(participants), 11절(세션)
- API: MEMBER-API-06 (`docs/specs/api/member.md`), API_CONVENTIONS 3·5절
- 관련 미결·충돌: C-07(탈퇴자 세션 401), R-11·R-21(cancelled 409 `PROMISE_CANCELLED` 세션보다 우선), R-14·R-20·R-21(읽기 트랜잭션 패턴). 이번 결정은 R-29

## 사용자와 문제

등록한 참여자가 누가 함께하는지와 정원 현황을 볼 API가 없었다. 현황 조회(TIME-API-02)는 슬롯과 함께 명단을 주지만 정원과 본인 표시, 역할 이름이 없다.

## 목표와 범위

- 이번에 구현할 동작: `GET /api/v1/promises/{promiseId}/participants` — 이 약속의 active 참여자에게 정원·현재 인원·active 명단(등록순, 역할, 본인 표시)
- 이번에 하지 않을 일: 화면, DB 스키마 변경, 탈퇴 기록 조회

## 선행 작업

005(`session-auth.ts`·`withSessionCookie`), 014(읽기 트랜잭션 안 세션 재확인 패턴), 006(같은 경로의 POST)

## 사용자 흐름

1. 참여자가 세션 쿠키로 명단을 요청한다(Origin 검사 없음, 본문 없음)
2. 서버가 공통 인증 순서로 확인하고, 읽기 트랜잭션 하나에서 약속·세션·참여자를 다시 읽는다
3. 200 명단과 갱신된 쿠키를 받는다

## 수용 기준

- [x] AC-1 (MEMBER-API-06 200, MEMBER-07-02·08-03): collecting·closed·confirmed에서 `{ participantLimit, currentParticipantCount, participants[] }`. active만, `created_at ASC, id ASC`, `currentParticipantCount` = 배열 길이, 미제출자·방장 포함
- [x] AC-2 (MEMBER-08-02): 항목은 `participantId·nickname·role·isMe`만. 제출 여부·status·PIN 해시·세션·정규화 닉네임 없음
- [x] AC-3 (MEMBER-08-01): 요청자 = 이 약속의 active 참여자. `isMe`는 요청자 본인만 true. role은 트랜잭션에서 읽은 최신 값(승계 반영)
- [x] AC-4 (MEMBER-03-01): draft는 방장 포함 403 `FORBIDDEN`
- [x] AC-5 (R-11·R-21): cancelled는 세션보다 먼저 409 `PROMISE_CANCELLED`
- [x] AC-6: 401(쿠키 없음·만료·탈퇴), 403(다른 약속 세션), 404, 400(promiseId 형식), 모든 응답 no-store, 인증 성공 뒤 모든 응답 쿠키 갱신
- [x] AC-7: REPEATABLE READ 읽기 트랜잭션 하나·잠금 없음·DB 변경 없음. 마감 지난 collecting도 200(DB collecting 그대로)

## 데이터와 인터페이스

- DB 변경 없음
- 200: `{ participantLimit, currentParticipantCount, participants: [{ participantId, nickname, role, isMe }] }`
- 에러: 400 `INVALID_REQUEST`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `PROMISE_NOT_FOUND`, 409 `PROMISE_CANCELLED`

## 구현 계획

1. RED: 대표 테스트 2건(탈퇴자 제외·등록순, 응답 필드 제한) + 빈 구현(빈 명단 반환)
2. GREEN: `lib/member/participant-list.ts`(읽기 트랜잭션), 같은 경로 `route.ts`에 GET 추가
3. REFACTOR: 판정 순서·재확인 테스트, `route.test.ts`에 GET 테스트
4. 문서: member.md MEMBER-API-06 구현 결정·409 코드, DECISION_CONFLICTS R-29

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`, lint·typecheck·build
- 개발 DB 실제 호출: 세 상태 200, 탈퇴자 제외·등록순, 승계 후 role, isMe, 미제출자 포함, 제출 여부 없음, draft 403(방장 포함), 탈퇴자 세션 401, 쿠키 없음 401, 다른 약속 세션 403, cancelled 409(세션 없이), 404·400, no-store, 확인용 데이터 삭제·스냅샷 비교

## 미정 사항

- 결정(사용자 지시): cancelled 409 `PROMISE_CANCELLED`(명세 `INVALID_PROMISE_STATE` 대신), draft는 방장도 403
- 팀 확인 필요(기존): C-07(탈퇴자 세션 401)

## 결과

AC-1~7 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: `lib/member/participant-list.ts`(읽기 트랜잭션), `app/api/v1/promises/[promiseId]/participants/route.ts`(기존 POST 옆에 GET 추가)
- 테스트: `lib/member/participant-list.test.ts` 19건, `participants/route.test.ts` GET 13건(POST 기존 26건 수정 없음)
- 마감 지난 collecting을 closed로 계산하는 코드는 두지 않았다. 두 상태 모두 허용이고 응답에 상태가 없어 결과가 같다(R-29)
