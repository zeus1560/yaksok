# 참여자 내보내기 API (MEMBER-API-08)

## 식별자와 상태

- 스펙 ID: `024-remove-participant-api`
- 상태: 완료

## 근거

- 비즈니스 규칙: MEMBER-10-03(탈퇴·내보내기 상태 변경), MEMBER-11-02(내보낸 사람 재참여 불가), STATE-06-01(마감 판정), MEMBER-07-02(활성 인원), MEMBER-08-03(cancelled 집계 제외)
- ERD: DATABASE.md 6.2(참여자 상태), 8절(잠금), 3.5(세션)
- API: MEMBER-API-08 (`docs/specs/api/member.md`), STATE-API-09 공통 처리, API_CONVENTIONS 4·5.2절
- 관련 미결·충돌: R-11(cancelled 409 세션보다 우선), R-13(참여자 등록 마감 경과 상태 유지), R-28(본인 탈퇴), C-07(cancelled 참여자 401·로그인 403), A-02(명세 미완성). 이번 결정은 R-30

## 사용자와 문제

방장이 잘못 들어온 사람이나 더 이상 함께하지 않는 사람을 모집 중에 빼낼 방법이 없었다. 빼야 정원이 비고 후보 집계에서도 빠진다.

## 목표와 범위

- 이번에 구현할 동작: `DELETE /api/v1/promises/{promiseId}/participants/{participantId}` — 현재 active host가 collecting·마감 전에 다른 참여자를 cancelled로 바꾸고 그 참여자의 세션을 즉시 만료한다
- 이번에 하지 않을 일: 화면, DB 스키마 변경, 내보낸 사람 복귀

## 선행 작업

022(본인 탈퇴의 일반 참여자 분기·`expireParticipantSessions`), 021(`lockPromiseAsHost`), 005(`session-auth.ts`), 006(참여자 등록 마감 경과 처리)

## 사용자 흐름

1. 방장이 세션 쿠키·Origin과 함께 대상 participantId로 DELETE를 보낸다(본문 없음)
2. 서버가 공통 인증 뒤 `promises` 행을 잠그고 권한·상태·마감·대상을 다시 확인한다
3. 대상이 cancelled가 되고 대상 세션이 만료된다. 방장은 200과 갱신된 쿠키를 받는다
4. 내보낸 사람이 열어 둔 화면의 다음 요청은 401 → 링크 재조회 흐름(011)

## 수용 기준

- [x] AC-1 (MEMBER-10-03): 200 `{ participantId, participantStatus: "cancelled", currentParticipantCount, participantLimit }`. 대상 `status=cancelled`·`cancelled_at`=판정 시각, 슬롯·제출 시각·버전·닉네임·PIN 해시 보존, 대상의 유효 세션만 만료(다른 참여자 세션 그대로), 약속 상태 그대로
- [x] AC-2: 이미 cancelled인 대상은 아무것도 바꾸지 않고 200 (멱등)
- [x] AC-3: 권한 — 잠금 후 다시 읽은 요청자 role이 host가 아니면 403, 요청자 세션 만료·cancelled면 401, 본인 지정 409 `CANNOT_REMOVE_SELF`, 대상 없음·다른 약속 404 `PARTICIPANT_NOT_FOUND`
- [x] AC-4 (STATE-06-01, R-13): collecting 아니면 409 `INVALID_PROMISE_STATE`, 마감 지났으면 409 `DEADLINE_PASSED`(DB 상태 그대로 — 참여자 등록과 같음), cancelled는 세션보다 먼저 409 `PROMISE_CANCELLED`
- [x] AC-5: 400(promiseId·participantId 형식), 401, 403 `INVALID_ORIGIN`, 404 `PROMISE_NOT_FOUND`, 모든 응답 no-store, 인증 성공 뒤 모든 응답 쿠키 갱신
- [x] AC-6 (MEMBER-07-02·08-03·11-02): 내보낸 뒤 정원에서 빠져 새 등록 가능, 닉네임 계속 `NICKNAME_TAKEN`, 로그인 403 `PARTICIPANT_CANCELLED`, 세션 401, 명단·현황·후보 집계 제외
- [x] AC-7: 동시성 — 제출·대상 탈퇴·방장 탈퇴·같은 대상 내보내기와 `promises` 잠금으로 직렬화
- [x] AC-8: 대상 처리를 본인 탈퇴와 같은 함수로 공유하고 탈퇴 기존 테스트가 기대값 수정 없이 통과

## 데이터와 인터페이스

- DB 변경 없음
- 200: `{ participantId, participantStatus: "cancelled", currentParticipantCount, participantLimit }`
- 에러: 400 `INVALID_REQUEST`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`·`INVALID_ORIGIN`, 404 `PROMISE_NOT_FOUND`·`PARTICIPANT_NOT_FOUND`, 409 `PROMISE_CANCELLED`·`INVALID_PROMISE_STATE`·`DEADLINE_PASSED`·`CANNOT_REMOVE_SELF`

## 구현 계획

1. RED: 대표 테스트 2건(대상만 cancelled·대상 세션만 만료, 재요청 무변경 200) + 빈 구현
2. GREEN: `lib/member/participant-cancel.ts` `cancelParticipant`(탈퇴 일반 분기에서 추출), `lib/member/remove-participant.ts`
3. REFACTOR: 거절·순서·경계 테스트, `participants/[participantId]/route.ts`와 테스트, 에러 헬퍼 2개
4. 문서: member.md MEMBER-API-08, API_CONVENTIONS 5.2, DECISION_CONFLICTS R-30·A-02

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`, lint·typecheck·build
- 개발 DB 실제 호출: 200 끝 상태, 재요청, 에러 전부, 마감 경과, closed·confirmed·draft·cancelled, 내보낸 뒤 확인, 동시성(잠금 대기열로 순서 고정), 확인용 데이터 삭제·스냅샷 비교

## 미정 사항

- 결정(사용자 지시): cancelled 409 `PROMISE_CANCELLED`, 마감 경과는 참여자 등록과 같이 closed 저장 없음
- 팀 확인 필요: 마감 경과 처리의 STATE-API-09 5번과의 차이(MEMBER-API-03·08), C-07

## 결과

AC-1~8 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: `lib/member/remove-participant.ts`, `lib/member/participant-cancel.ts`, `app/api/v1/promises/[promiseId]/participants/[participantId]/route.ts`, `lib/api-error.ts`(`participantNotFound`·`cannotRemoveSelf`), `lib/state/withdraw-participant.ts`(일반 참여자 분기가 `cancelParticipant` 사용)
- 테스트: `remove-participant.test.ts` 26건, `[participantId]/route.test.ts` 24건. 탈퇴 테스트 기대값 수정 없음
