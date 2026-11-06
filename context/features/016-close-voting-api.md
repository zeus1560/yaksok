# 방장 마감 API (STATE-API-04)

## 식별자와 상태

- 스펙 ID: `016-close-voting-api`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: STATE-01-02(collecting → closed), STATE-05-01(마감 시각 도달), STATE-05-02(조기 마감), STATE-05-03(전원 제출해도 자동 마감 없음)
- ERD: DATABASE.md 8.2절(437행 잠금 후 마감 판정·저장, 506행 제출과 조기 마감 경쟁은 약속 행 잠금 순서로 직렬 처리)
- API: STATE-API-00 「요청 시 상태·마감 판정」·「세션·보존 공통 계약」, STATE-API-04 (`docs/specs/api/state.md`), API_CONVENTIONS 4.1·4.2·5.2절
- 관련 미결·충돌: C-11(조기 마감 세션 기준) — 잠정 B안 적용, 팀 확정 필요. EXCEPTION-06-01(조기 마감·제출 경쟁) ❗미결 — 새 규칙을 정하지 않고 DATABASE.md 506행(잠금 순서 직렬 처리)대로 둔다. C-07(cancelled 참여자 401) 안을 따른다

## 사용자와 문제

방장은 설정한 마감 전이라도 응답이 충분히 모이면 모집을 끝내고 후보를 보고 싶다(STATE-05-02). 마감 시각이 지났지만 아직 쓰기 요청이 없어 DB가 collecting인 약속도 방장이 마감하면 closed로 저장돼야 한다.

## 목표와 범위

- 이번에 할 일:
  - `POST /api/v1/promises/{promiseId}/close` — 이 약속의 현재 active host, Origin 필수, 본문 없음, no-store, 인증 후 모든 응답 쿠키 갱신
  - `lib/state/close-voting.ts` — `promises` 행만 `FOR UPDATE`(draft를 지우지 않으므로 API_CONVENTIONS 4.1-3), 잠금 후 `clock_timestamp()`, 잠금 후 취소·세션·active·host 재확인, closed는 변경 없이 200, collecting은 기한 전(조기)·후(공통) 모두 `status='closed'`만 저장
  - C-11 잠정 B안: 세션·링크 만료는 `voting_deadline_at + 7일` 유지. `refreshActiveSessions`를 부르지 않고 `voting_deadline_at`을 덮어쓰지 않는다
  - 명세 문구: API_CONVENTIONS 5.2 표 조기 마감 행·같은 절 미결 문단, state.md STATE-API-00 「세션·보존 공통 계약」, STATE-API-04 처리 순서 3. DECISION_CONFLICTS C-11에 수정 위치 기록
  - 조기 마감 상태(DB closed + 마감 시각 미래)를 기존 API가 closed로 다루는지 코드·개발 DB로 확인
- 이번에 하지 않을 일: 화면(마감 버튼), DB 스키마 변경(`closedAt`·`closeReason` 없음), 후보 저장, 확정 시각·가능 시간·제출 기록 변경, 세션 갱신

## 선행 작업

- 005 — `session-auth.ts`·`withSessionCookie`, 잠금 후 재확인 패턴(STATE-API-02)
- 007 — 잠금 후 세션·참여자 재확인과 마감 경과 closed 전환(TIME-API-01)
- 015 — `accessExpiresAt`(세션·링크 만료가 `voting_deadline_at + 7일`로 같은 값임)

## 사용자 흐름

1. 방장이 마감을 요청한다(화면은 이후 PR)
2. 서버가 약속 행을 잠그고 최신 권한·상태를 확인한다
3. collecting이면 closed로 저장하고 200, 이미 closed면 아무것도 바꾸지 않고 200
4. 이후 제출은 409 `VOTING_CLOSED`, 후보 조회는 200, 링크 조회는 `view_result`

## 수용 기준

- [x] AC-1 (STATE-05-02, STATE-API-04 처리 순서 3): collecting이고 마감 전이면 closed로 저장하고 200 `{ promiseId, promiseStatus: "closed" }`. `voting_deadline_at`·세션 `expires_at`은 바뀌지 않음(C-11 B안)
- [x] AC-2 (STATE-05-01): collecting이고 잠금 후 `clock_timestamp() ≥ voting_deadline_at`이면 같은 방식으로 closed 저장, 200
- [x] AC-3 (STATE-API-04 처리 순서 2): 이미 closed면 데이터 변경 없이 200. 병렬 2건도 둘 다 200, 상태 변경은 한 번
- [x] AC-4 (처리 순서 4): draft(10분 지난 draft 포함, 삭제 없음)·confirmed → 409 `INVALID_PROMISE_STATE`, details `{ promiseStatus, allowedStates: ["collecting", "closed"] }`
- [x] AC-5 (STATE-API-00): 검사 순서 Origin 403 → promiseId 400 → 404 → 409 `PROMISE_CANCELLED`(세션보다 우선) → 401 → 403(다른 약속) → 잠금 → 잠금 후 취소 409 → 세션·참여자 재확인 401 → host 아님 403 → 상태
- [x] AC-6 (처리 순서 4·5·6): 확정 시각·가능 시간·제출 기록·버전을 지우거나 바꾸지 않음. 후보를 저장하지 않음. 전원 제출·후보 인원은 조건이 아님
- [x] AC-7 (DATABASE.md 506행): 마감이 먼저 잠금을 잡으면 동시에 들어온 제출은 저장되지 않고 409 `VOTING_CLOSED`
- [x] AC-8: 조기 마감 상태를 링크 조회(`view_result`)·`/me`(closed, 입력·제출 권한 false)·제출(409, 저장 없음)·현황(closed)·후보(200)·상태 조회(closed)가 모두 closed로 다룸
- [x] AC-9: no-store, 인증 성공 뒤 모든 응답 쿠키 갱신(Max-Age는 갱신되지 않은 세션 기준)
- [x] AC-10: 명세 문구 3곳과 C-11 기록, 테스트(3개 TZ)·lint·typecheck·build 통과

## 데이터와 인터페이스

- DB·스키마 변경 없음. `UPDATE promises SET status = 'closed' WHERE id = $1 AND status = 'collecting'`
- `closeVoting(auth) → { kind: "not_found" | "cancelled" | "unauthenticated" | "forbidden" | "invalid_state" | "ok", ... }`. ok는 `changed`(이번 요청이 바꿨는지)·`deadlineReached`(잠금 후 판정에서 기한이 이미 지났는지)를 담는다 — 응답 본문에는 넣지 않는다(명세에 없음, closedAt·closeReason을 이력처럼 응답하지 않음)
- 본문은 읽지 않는다. 명세가 "본문 없음"이라 보낸 본문은 무시한다

## 구현 계획

1. RED: `close-voting.test.ts` 대표 테스트 2건 + 항상 현재 상태를 그대로 반환하는 빈 구현
2. GREEN: 잠금·재확인·저장 구현
3. REFACTOR: 나머지 단위 테스트, Route Handler와 `route.test.ts`
4. 문서: 명세 문구 3곳, C-11, A-09 진행

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`
- lint·typecheck·build(dev 서버 종료 후)
- 개발 DB 실제 호출: 사용자 요청 목록(조기·기한 경과·중복·병렬 마감, 403·409·401·404·400, 조기 마감 상태 일관성, 마감·제출 동시 요청), 확인용 데이터 삭제·스냅샷 비교

## 미정 사항

- C-11 B안은 이 저장소 기준 잠정. 팀 확정 필요
- EXCEPTION-06-01은 미결 그대로 둔다. 이번 구현은 잠금 순서대로 먼저 잡은 요청이 이기는 기존 ERD 동작만 따른다

## 결과

AC-1~10 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고. 마감·제출 경쟁은 잠금 순서를 강제한 경우 두 방향(마감 먼저 → 제출 409 미저장, 제출 먼저 → 저장 후 마감)과 잠금 조작 없는 병렬 5회(모두 마감이 먼저)를 확인했다.
