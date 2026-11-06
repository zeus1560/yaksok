# 공식 시간 후보 조회 API (STATE-API-10)

## 식별자와 상태

- 스펙 ID: `013-candidates-api`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: RESULT-01-01(active·제출자만), RESULT-01-02(방장도 한 명), RESULT-03-01(연속 시간 충족, 30분 단위 시작, 범위 초과·지난 시작 제외), RESULT-04-01(2명 이상), RESULT-04-02(방장 참석 필수 아님), RESULT-06-01·06-02(정렬·상위 5개), STATE-05-01, TIME-08-01(지난 슬롯 = 시작 ≤ 현재)
- ERD: DATABASE.md 7.1~7.3, 8.2, 10, 11절(공통 참석자 1명 사례, 응답 0명 기한 후 GET, 방장 불가·다른 2명 가능, 빈 제출, closed 탈퇴)
- API: STATE-API-00 「후보 계산 계약」·「요청 시 상태·마감 판정」, STATE-API-10 (`docs/specs/api/state.md`)
- 관련 미결·충돌: RESULT-02-01·02-02(❗미결이지만 RESULT-03-01 추가 결정에 답이 있음 — DECISION_CONFLICTS 3절 RESULT 메모), RESULT-07-01(❗미결 — API 명세 limit 1~5를 따름), RESULT-07-02 겹치는 후보(❗미결 — API 명세대로 30분 간격 시작점을 각각 반환), RESULT-12-01 확정 시 재계산(❗미결 — 05 몫). 이번 결정은 R-20

## 사용자와 문제

마감 후 방장이 확정할 시간을 고르려면, 제출한 참여자들의 가능 시간에서 약속 길이 전체에 함께 참석할 수 있는 사람 수가 많은 시간을 알아야 한다. 같은 계산을 확정(STATE-API-05) 직전 재검증에도 써야 기준이 하나로 유지된다.

## 목표와 범위

- 이번에 구현할 동작:
  - `GET /api/v1/promises/{promiseId}/candidates?limit&offset` — 이 약속의 active 참여자(방장만이 아님)가 effectiveStatus=closed일 때 조회
  - 후보 계산 순수 함수 `lib/state/candidates.ts`(05에서 재사용), limit·offset 검증·페이지 자르기 `lib/state/candidate-page.ts`
  - 읽기 트랜잭션 하나(REPEATABLE READ, 잠금 없음)에서 약속·세션·참여자·슬롯을 읽고 계산 시각은 그 트랜잭션의 `now()` 하나
- 이번에 구현하지 않을 동작: 화면, 확정(05)·재조율·취소, 후보 테이블·후보 ID·영구 순위, DB 스키마 변경, 레이트 리밋

## 선행 작업

- 005 — `session-auth.ts`·`withSessionCookie`
- 008 — 읽기 트랜잭션·세션 재확인·effectiveStatus 계산 패턴
- 007 — 슬롯 저장 형식(30분 경계, 지난 슬롯 경계)

## 사용자 흐름

1. 마감 후(또는 DB는 collecting이지만 마감 시각이 지난 뒤) 참여자가 후보를 조회한다
2. 서버가 같은 시점의 데이터로 전체 날짜 범위의 후보를 계산해 정렬하고 offset부터 limit개를 돌려준다
3. 후보가 없으면 200 빈 배열(화면은 재조율·취소 안내 — 이후 PR)
4. 더 보기: `nextOffset`으로 다시 요청. 요청 사이 데이터·시간이 바뀌면 total·순서가 달라질 수 있다(`calculatedAt` 반환, 스냅샷 보장 없음)

## 수용 기준

- [x] AC-1 (STATE-API-00, RESULT-01-01): active이고 제출 시각이 있는 참여자만 집계. 탈퇴자 보존 슬롯·제출 해제자 저장 슬롯·빈 제출은 기여하지 않음
- [x] AC-2 (RESULT-03-01, TIME-08-01): 후보 시작은 한국 시간 30분 경계, 시작 > 계산 시각. 구간 전체가 같은 날짜의 하루 범위 안(24:00 포함, 넘으면 제외). 날짜 범위 전체 대상
- [x] AC-3 (RESULT-03-01, ERD 7.1·11절): 공통 가능 인원 = 구간 내 모든 슬롯의 참여자 집합 교집합 크기. 슬롯별 최솟값 2명·교집합 1명 사례가 후보에서 빠짐
- [x] AC-4 (RESULT-04-01·04-02): 2명 이상만, 방장 참석 불필요
- [x] AC-5 (RESULT-06-01·06-02): 인원 내림차순 → 시작 오름차순
- [x] AC-6 (STATE-API-10): limit 1~5(기본 5)·offset ≥ 0(기본 0), total·hasMore·nextOffset, offset ≥ total이면 빈 배열·false·null. 후보 없음 200
- [x] AC-7 (STATE-API-00·10): 검사 순서 400 → 422 → 404 → 409 `PROMISE_CANCELLED`(세션보다 우선) → 401 → 403, 이후 409 `INVALID_PROMISE_STATE`(details `promiseStatus`·`allowedStates`). 마감 경과 collecting은 closed로 계산만, DB 변경 없음
- [x] AC-8: 모든 응답 no-store, 인증 성공 뒤 모든 응답 쿠키 갱신, 참여자별 슬롯·제출 여부·닉네임 비노출
- [x] AC-9: 기기 시간대 무관(`TZ=UTC`·`America/Los_Angeles` 통과), 참여자 30명·3개월·00:00~24:00에서 계산 시간 확인

## 데이터와 인터페이스

- DB 변경 없음. STATE-API-10 계약 그대로, 에러 형식은 API_CONVENTIONS 3절 `{ code, message, details? }`(STATE 명세와 같음)
- `session-auth.ts`에 `isPromiseIdFormat` 공개(인증 전 400을 422보다 먼저 내기 위해, 기존 동작 그대로)

## 구현 계획

- `lib/state/candidates.ts`: `computeCandidates({ settings, participants, now })` — 참여자 필터 → 슬롯별 참여자 비트 집합 → 날짜·시작점마다 구간 슬롯 AND → 2명 이상 → 정렬
- `lib/state/candidate-page.ts`: `parseCandidatePage`, `sliceCandidatePage`
- `lib/state/promise-candidates.ts`: `getPromiseCandidates(auth)` — 읽기 트랜잭션, 세션 재확인, effectiveStatus, 계산
- `app/api/v1/promises/[promiseId]/candidates/route.ts`

## 검증 계획

- Vitest: 계산 함수(교집합·하루 경계·지난 시작점·제외 대상·1명 구간·정렬 동점·소요 시간·30명 3개월 성능·설정 오류), 페이지, 서비스(트랜잭션·판정·조회 조건), 라우트(본문·페이지·에러 코드·쿠키·no-store·비노출). 3개 TZ
- lint·typecheck·build(dev 서버 종료 후)
- 개발 DB 실제 호출: 사용자 요청 확인 목록

## 미정 사항

- RESULT-07-02 겹치는 후보 ❗미결 — API 명세대로 시작점마다 각각 반환(화면에서 묶을지는 결과 화면 PR에서)
- 확정 시 재계산 기준 시각: 05는 잠금 후 `clock_timestamp()`로 같은 함수를 부르면 된다(ERD 8.2). 이번 범위 아님

## 결과

AC-1~9 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.
