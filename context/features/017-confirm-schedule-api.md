# 최종 일정 확정 API (STATE-API-05)

## 식별자와 상태

- 스펙 ID: `017-confirm-schedule-api`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: STATE-01-02(closed → confirmed), STATE-08-01(방장 수동 확정), RESULT-03-01·04-01(후보 조건, 공통 2명 이상), TIME-08-01(지난 시작 판정)
- ERD: DATABASE.md 7.1·7.2·8.2절(잠금 후 마감 판정·저장)
- API: STATE-API-00 「후보 계산 계약」·「세션·보존 공통 계약」, STATE-API-05 (`docs/specs/api/state.md`), API_CONVENTIONS 4.1·4.2·5.2절
- 관련 미결·충돌: C-10(확정 시 기존 세션 만료) — 잠정 A안 적용, 팀 확정 필요. R-20(후보 "미래" 경계 = 시작 > 판정 시각, 확정은 잠금 후 `clock_timestamp()`로 같은 함수를 다시 부른다). C-07(cancelled 참여자 401)

## 사용자와 문제

마감 후 방장은 후보 중 하나(상위 5개 밖이어도)를 최종 일정으로 정한다. 후보 조회와 확정 사이에 참여자가 탈퇴하거나 시간이 지나 후보가 무효가 될 수 있으므로 확정 시점에 후보 조회와 같은 규칙으로 다시 검사해야 한다.

## 목표와 범위

- 이번에 할 일:
  - `POST /api/v1/promises/{promiseId}/confirmation` — 현재 active host, Origin 필수, 본문 `{ startAt }`, no-store, 인증 후 모든 응답 쿠키 갱신
  - `lib/state/candidates.ts` — 후보 한 개 판정 함수(`evaluateStart`)를 꺼내 `computeCandidates`와 확정 검증(`validateCandidateStart`)이 함께 쓴다
  - `lib/state/confirm-schedule.ts` — `promises` 행 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, 잠금 후 취소·세션·active·host 재확인, 마감 지난 collecting은 closed 먼저 저장, closed만 허용, 후보 재검증, `confirmed_start_at`·`status='confirmed'` 함께 저장
  - C-10 잠정 A안: 같은 트랜잭션에서 `refreshActiveSessions`에 확정 상태를 넘겨 active 참여자의 유효 세션만 `confirmed_start_at + 7일`
  - 명세 문구: API_CONVENTIONS 5.2 표 확정 행·미결 문단, state.md STATE-API-05 처리 순서에 세션 갱신 단계, DECISION_CONFLICTS C-10 수정 위치
- 이번에 하지 않을 일: 화면(확정 버튼), DB 스키마 변경, 재조율(STATE-API-06), 제출 상태·슬롯 변경

## 선행 작업

- 013 — `computeCandidates`(같은 판정 규칙)
- 015 — `refreshActiveSessions`·`accessExpiresAt`
- 016 — 잠금 후 재확인 패턴, 007 — 마감 경과 closed 저장 후 커밋 패턴(TIME-API-01)

## 사용자 흐름

1. 방장이 후보 조회(STATE-API-10)로 본 시작 시각 하나를 보낸다(화면은 이후 PR)
2. 서버가 약속 행을 잠그고 최신 권한·상태·후보 유효성을 확인한다
3. 유효하면 confirmed로 저장하고 200 `{ promiseId, promiseStatus: "confirmed", currentConfirmation: { startAt, endAt } }`
4. 무효면 422 `INVALID_CONFIRMATION_CANDIDATE` → 화면은 후보를 다시 조회한다. 응답이 유실되면 STATE-API-01로 확인한다

## 수용 기준

- [x] AC-1 (STATE-08-01, 처리 순서 7): closed이고 유효 후보면 `confirmed_start_at`·`status=confirmed`를 함께 저장하고 200. endAt = startAt + 현재 `duration_minutes`, 시각은 초 단위 `+09:00`
- [x] AC-2 (처리 순서 6): 상위 5개 밖이어도 유효 후보면 200
- [x] AC-3 (처리 순서 3): 같은 절대 시각이면 `+09:00`·`Z`·다른 오프셋 표기 모두 같은 결과. 형식 오류는 422 `VALIDATION_FAILED`(`details.field = "startAt"`)
- [x] AC-4 (처리 순서 4·5): 지난 시각(시작 ≤ 판정 시각)·30분 경계 아님·날짜 범위 밖·하루 범위를 넘는 구간·공통 가능 1명 이하 → 422 `INVALID_CONFIRMATION_CANDIDATE`
- [x] AC-5: 후보 판정은 `computeCandidates`와 같은 함수. `computeCandidates`가 돌려준 모든 후보는 확정 검증 통과, 목록에 없는 시작점은 모두 거부(전수 비교 테스트)
- [x] AC-6 (처리 순서 2): 마감 지난 collecting은 closed 저장 후 계속 진행. 무효 후보로 422가 나도 closed 저장은 커밋. 마감 전 collecting·confirmed(재요청 포함)·draft → 409 `INVALID_PROMISE_STATE`(allowedStates `["closed"]`), confirmed 일정은 바뀌지 않음
- [x] AC-7 (처리 순서 1): Origin 403 → promiseId 400 → 본문 400 → startAt 422 → 404 → cancelled 409(세션보다 우선) → 401 → 403(다른 약속) → 잠금 → 취소 409 → 세션·참여자 재확인 401 → host 아님 403 → 상태
- [x] AC-8 (C-10 잠정 A안): 확정과 같은 트랜잭션에서 active 참여자의 유효 세션만 `confirmed_start_at + 7일`. 만료·탈퇴 세션은 그대로. 요청자 쿠키는 이 응답에서, 다른 기기는 다음 인증 응답에서 Max-Age 갱신
- [x] AC-9: 제출 상태·슬롯·버전을 바꾸지 않음
- [x] AC-10: 같은 방장의 서로 다른 후보 확정 병렬 2건 — 하나만 200, 다른 하나 409
- [x] AC-11: 확정 뒤 상태 조회 `currentConfirmation`, 링크 조회 `view_result`, `/me` `confirmed`, 후보 조회 409
- [x] AC-12: 명세 문구·C-10 기록, test(3개 TZ)·lint·typecheck·build

## 데이터와 인터페이스

- DB·스키마 변경 없음. `UPDATE promises SET status = 'confirmed', confirmed_start_at = $1 WHERE id = $2 AND status = 'closed'`
- 시작 시각 형식: `YYYY-MM-DDTHH:MM[:SS[.fff]]` + `Z` 또는 `±HH:MM`(대문자 T·Z, 실제 달력 날짜, 오프셋 ±14:00 이내, 소수 초 1~3자리). 본문이 JSON 객체가 아니거나 `startAt`이 없거나 문자열이 아니면 400
- `validateCandidateStart({ settings, participants, now, startAt }) → { ok: true, candidate } | { ok: false, reason }`. reason: `not_future`·`not_slot_boundary`·`out_of_date_range`·`out_of_daily_range`·`too_few_participants`(응답 본문에는 넣지 않음)
- 422 `INVALID_CONFIRMATION_CANDIDATE` 신설(`lib/api-error.ts`), details 없음

## 구현 계획

1. RED: `confirm-schedule.test.ts` 대표 2건 + 항상 현재 상태를 그대로 돌려주는 빈 구현
2. GREEN: 잠금·재확인·검증·저장 구현, `candidates.ts`에서 판정 함수 분리
3. REFACTOR: 나머지 단위 테스트, 전수 비교 테스트, Route Handler와 `route.test.ts`
4. 문서: 명세 문구, C-10

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`
- lint·typecheck·build(dev 서버 종료 후)
- 개발 DB 실제 호출: 사용자 요청 목록 전부, 확인용 데이터 삭제·스냅샷 비교

## 미정 사항

- C-10 A안은 이 저장소 기준 잠정. 팀 확정 필요
- 조기 마감 후 마감 시각보다 이른 시각으로 확정하면 세션·링크 만료가 `voting_deadline_at + 7일`보다 앞당겨진다(A안 원칙 "모든 세션 만료 = 링크 만료"를 따른 결과)

## 결과

AC-1~12 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고. 후보 판정은 `candidates.ts`의 `evaluateStart` 하나를 `computeCandidates`와 `validateCandidateStart`가 함께 쓰며, 무작위 데이터 40개 전수 비교 테스트로 "목록에 있다 ⇔ 통과"를 확인했다(열거 범위를 일부러 줄이면 28건 실패하는 것도 확인 후 되돌림).
