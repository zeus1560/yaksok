# 약속 상태와 설정 조회 API (STATE-API-01)

## 식별자와 상태

- 스펙 ID: `014-promise-detail-api`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: STATE-01-01, STATE-05-01, STATE-08-01(명세 규칙 연결), RESULT-01-01(active·제출자만 집계), RESULT-04-01(2명 기준), STATE-02-02(draft 10분)
- ERD: DATABASE.md 3.2·3.3·6.1·8.2절, 448행(설정 버전 없이 settings 전체 비교)
- API: STATE-API-00 「effectiveStatus」·「요청 시 상태·마감 판정」·「후보 계산 계약」, STATE-API-01 (`docs/specs/api/state.md`)
- 관련 미결·충돌: 없음(STATE-API-01 TBD 없음). C-07(cancelled 참여자 401) 안을 따른다. 이번 결정은 R-21

## 사용자와 문제

결과 화면과 방장 관리 화면은 약속의 현재 상태·설정·확정 일정을 알아야 한다. 확정 일정(`currentConfirmation`)을 돌려주는 API는 이것뿐이고, 설정 버전을 저장하지 않으므로 화면은 이 API를 주기적으로 조회해 settings를 이전 값과 비교해 변경을 감지한다. 확정 뒤 참여자가 빠져 참석 가능 인원이 2명 미만이 되면 방장에게 재조율·취소를 안내해야 한다.

## 목표와 범위

- 이번에 구현할 동작:
  - `GET /api/v1/promises/{promiseId}` — 이 약속의 active 참여자, draft는 현재 host만
  - 응답 조립 순수 함수 `lib/state/promise-view.ts`(effectiveStatus, draftExpiresAt·draftExpired, settings 매핑, currentConfirmation·hostActionRequired)
  - 확정 구간 공통 가능 인원 `countAvailableParticipants`를 `lib/state/candidates.ts`에 공개하고 `computeCandidates`와 색인·교집합 코드를 같이 쓴다(미래·범위 필터는 후보 계산 쪽에만)
  - 읽기 트랜잭션 하나(REPEATABLE READ, 잠금 없음)에서 약속·세션·참여자·슬롯을 읽고 판정 시각은 그 트랜잭션의 `now()` 하나
- 이번에 구현하지 않을 동작: 화면, 확정(05)·설정 변경(03)·재조율·취소, 상태 전환·만료 draft 삭제, DB 스키마 변경, 레이트 리밋, ETag

## 선행 작업

- 013 — `lib/state/candidates.ts` 집계 기준, 읽기 트랜잭션·세션 재확인 패턴
- 005 — `session-auth.ts`·`withSessionCookie`, `minuteToTime`
- 002 — `DRAFT_EXPIRY_MS`, 010 — `isDeadlinePassed`(마감 경계)

## 사용자 흐름

1. 결과·관리 화면이 세션 쿠키로 조회한다
2. 서버가 같은 시점의 데이터로 상태·설정을 읽고, 마감이 지난 collecting은 closed로 계산만 한다
3. confirmed이면 현재 active·제출 완료 참여자로 확정 구간 공통 가능 인원을 다시 세고, 요청자가 방장이고 2명 미만이면 `hostActionRequired=true`
4. 화면은 settings를 이전 응답과 비교한다(이후 화면 PR)

## 수용 기준

- [x] AC-1 (STATE-API-01 권한): active 참여자 200. draft는 현재 host만 200, 그 외 403 `FORBIDDEN`. 10분 지난 draft도 방장에게 200 + `draftExpired: true`, DB 변경 없음
- [x] AC-2 (STATE-API-00 effectiveStatus): DB collecting이고 마감 ≤ 판정 시각이면 `promiseStatus: "closed"`, DB status 유지
- [x] AC-3 (STATE-API-01 응답): settings 매핑(draft 미설정 값은 각각 null, `HH:mm`, 1440 → `"24:00"`), `draftExpiresAt` = created_at + 10분(draft만), 시각은 초 단위 `+09:00`
- [x] AC-4 (STATE-API-01 처리 순서 5, RESULT-01-01): confirmed일 때만 `currentConfirmation` — startAt = `confirmed_start_at`, endAt = startAt + 현재 소요 시간, 인원 = active·제출 완료 참여자의 확정 구간 슬롯 교집합. 지난 시각·현재 범위 밖이어도 그대로 센다
- [x] AC-5 (STATE-API-01 처리 순서 6): 요청자가 host이고 인원 < 2이면 `hostActionRequired: true`, 일반 참여자는 false. 확정 상태·`confirmed_start_at`은 바꾸지 않음
- [x] AC-6 (STATE-API-00): 검사 순서 400 → 404 → 409 `PROMISE_CANCELLED`(세션보다 우선) → 401 → 403(다른 약속) → 트랜잭션 안 재확인 401 → draft 비방장 403
- [x] AC-7: no-store, 인증 성공 뒤 모든 응답 쿠키 갱신, 다른 참여자의 슬롯·제출 여부·닉네임 비노출
- [x] AC-8: 후보 계산과 같은 집계 함수(두 벌 없음), 기기 시간대 무관(`TZ=UTC`·`America/Los_Angeles` 통과)

## 데이터와 인터페이스

- DB 변경 없음(`confirmed_start_at` 컬럼은 ERD v2 마이그레이션에 이미 있음). STATE-API-01 계약 그대로, 에러 형식은 API_CONVENTIONS 3절 `{ code, message, details? }`(STATE 명세와 같음)
- `lib/state/candidates.ts`: `countAvailableParticipants({ participants, startAt, durationMinutes })` 공개. 내부 `buildSlotIndex`·`countCommon`을 `computeCandidates`와 같이 쓴다

## 구현 계획

- `lib/state/candidates.ts`: 집계 대상 필터·비트 집합 색인 `buildSlotIndex`, 교집합 `countCommon` 분리 → `computeCandidates`(미래·범위·2명 필터)와 `countAvailableParticipants`(필터 없음)가 공유
- `lib/state/promise-view.ts`: `effectivePromiseStatus`, `buildPromiseView`
- `lib/state/promise-detail.ts`: `getPromiseDetail(auth)` — 읽기 트랜잭션, 세션·역할 재확인, confirmed면 확정 구간 슬롯만 읽어 인원 계산
- `app/api/v1/promises/[promiseId]/route.ts`

## 검증 계획

- Vitest: 응답 조립(경계·null·24:00·hostActionRequired 표·데이터 오류), 집계 함수(교집합·제외 대상·과거·범위 밖·30분 경계 아님·33명 이상·후보 계산과 같은 값), 서비스(트랜잭션·판정 순서·조회 조건), 라우트(본문·에러 코드·쿠키·no-store·비노출). 3개 TZ
- lint·typecheck·build(dev 서버 종료 후)
- 개발 DB 실제 호출: 사용자 요청 확인 목록

## 미정 사항

- 없음. 명세에서 정하지 않은 세부(draft 비방장 코드, 409 `INVALID_PROMISE_STATE` 도달 경로, 표기)는 R-21에 기록

## 결과

AC-1~8 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.
