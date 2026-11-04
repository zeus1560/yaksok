# 가능 시간 현황 조회 API (TIME-API-02)

## 식별자와 상태

- 스펙 ID: `008-availability-status-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: TIME-02-02·02-03(시간 형식·정밀도), TIME-05-02(24:00), TIME-10-03(미제출 입력 계산), TIME-10-04(제출과 반영·버전), TIME-12-01(빈 선택 제출), TIME-12-02(미제출과 불참 구분), TIME-15-01~04(마감 판정), STATE-02-02(draft 10분), STATE-09-04(범위 변경 시 제출 해제), STATE-10-01(취소)
- 결정: R-11(`PROMISE_CANCELLED`), R-12(promiseId 형식 400·만료 draft 410·쿠키 갱신), R-13(잠금 없는 draft 비삭제), R-14(TIME 에러 코드 정렬·슬롯 초 단위 표기), C-07(cancelled 참여자 세션 401), A-06(serverTime [제안] → 이번 확정)
- ERD: DATABASE.md 3.3(`availability_version`·`availability_submitted_at`), 6.2(탈퇴 데이터 보존·집계 제외), 11절(기한 지난 collecting GET은 DB 불변, draft 10분 경과 GET은 DB 불변, 탈퇴 세션 401)
- API: TIME-API-02 (`docs/specs/api/time.md`), API_CONVENTIONS 3·5절, STATE-API-02 응답의 `votingDeadlineAt` 표기
- 관련 미결·충돌: 레이트 리밋 [제안] 미구현, ETag·304는 P1

## 사용자와 문제

입력 화면이 5초마다 약속 상태·설정 범위·참여자별 가능 시간·내 동기화 정보(version)를 받아 히트맵과 내 입력을 그린다. 다른 참여자의 제출 여부는 드러나면 안 되고(미제출과 빈 선택 제출이 구분되지 않아야 함), 다른 기기 제출·범위 변경으로 내 버전이 바뀌면 로컬 입력을 폐기해야 한다.

## 목표와 범위

- 구현: `GET /api/v1/promises/[promiseId]/availability`, 조회 서비스(REPEATABLE READ 읽기 트랜잭션), 테스트, 문서 갱신
- 제외: 화면·폴링, 레이트 리밋([제안]), ETag·304(P1), DB 스키마 변경. 이 API는 DB를 바꾸지 않는다

## 선행 작업

005 — `session-auth.ts`·`withSessionCookie`·`minuteToTime`, 006 — `no-store`·`PROMISE_NOT_OPEN`, 007 — 슬롯 초 단위 표기(`toSeoulIsoString`)·`toSeoulIsoMillisString`·draft 판정 패턴

## 사용자 흐름

GET → 세션 인증(형식 400 → 404 → 취소 409 → 401 → 다른 약속 403, Origin 검사 없음) → 이후 모든 응답 쿠키 갱신 → REPEATABLE READ 트랜잭션: `now()` 판정 시각 → 약속 행(잠금 없음, 없으면 404 + 쿠키 삭제) → cancelled 409 → draft(10분 경과 410 / 진행 중 409 `PROMISE_NOT_OPEN`) → 세션·참여자 재확인 401 → effectiveStatus(마감 경과 collecting → closed 계산만) → active 참여자·슬롯 → 200. 모든 응답 `Cache-Control: no-store`.

## 수용 기준

- [x] AC-1 (API_CONVENTIONS 3): 모든 응답 `Cache-Control: no-store`, Origin 검사 없음
- [x] AC-2 (R-12, API_CONVENTIONS 5): `session-auth.ts` 순서 그대로(400 → 404 → 409 `PROMISE_CANCELLED` → 401 → 403), 인증 성공 후 모든 응답 쿠키 갱신(Max-Age = 판정 시각 기준 DB `expires_at`까지 남은 초)
- [x] AC-3 (A-06 확정): 조회는 REPEATABLE READ 읽기 트랜잭션 하나, 잠금 없음, 판정 시각은 트랜잭션 안 `now()`
- [x] AC-4 (STATE-10-01, STATE-02-02, R-12·R-13): 트랜잭션 안 cancelled 409, draft 10분 경과(`created_at + 10분 ≤ 판정 시각`) 410 `DRAFT_EXPIRED`(삭제 없음) / 진행 중 409 `PROMISE_NOT_OPEN`
- [x] AC-5 (ERD 11절, C-07): 트랜잭션 안에서 세션·참여자 재확인 — 세션 없음·만료, 참여자가 이 약속의 active가 아니면 401 `UNAUTHENTICATED`
- [x] AC-6 (TIME-15-01~04, ERD 11절): DB collecting이고 판정 시각 ≥ 마감이면 응답 status만 closed, DB 불변. closed·confirmed 그대로
- [x] AC-7: 200 본문 명세 형식 — `serverTime` 밀리초 3자리, `votingDeadlineAt` STATE-API-02와 같은 초 단위 `+09:00`, 슬롯 초 단위 `+09:00`, 1440 → `"24:00"`
- [x] AC-8 (TIME-12-02, 6.2): `participants`는 active만 등록순(`created_at`, `id`), `totalParticipants` = active 수. `availableSlots`는 제출 시각 있는 참여자만 저장 슬롯, 나머지 []. 다른 참여자 제출 여부·제출 시각·version 미포함
- [x] AC-9 (TIME-10-03·10-04, STATE-09-04): `me` = { participantId, version, submitted, slots }. 제출 해제 상태여도 `me.slots`에 저장 슬롯, 지난 슬롯도 그대로
- [x] AC-10: 세션 토큰·쿠키 값 로그 없음, 원시 DB 오류 미노출(500 `INTERNAL_ERROR`)

## 데이터와 인터페이스

- 스키마 변경 없음. 읽기만 한다.
- Route Handler 계약: TIME-API-02 응답 표.

## 구현 계획

1. `lib/time/availability-status.ts` — `getAvailabilityStatus(auth)`: RepeatableRead 트랜잭션, `now()` → 약속 행 → 상태 판정 → 세션 재확인 → active 참여자·슬롯 조회. 결과에 쿠키 계산용 `session` 포함
2. `app/api/v1/promises/[promiseId]/availability/route.ts` — GET, `noStore`, `authenticatePromiseSession`, 결과 → 응답 변환(`toSeoulIsoString`·`toSeoulIsoMillisString`·`minuteToTime`)
3. 테스트: 서비스 단위(판정·응답 내용), 라우트(400·404·no-store·쿠키 갱신·본문 형식)
4. 문서: time.md TIME-API-02·상태별 허용 표·결정 목록, DECISION_CONFLICTS R-14·A-06

## 검증 계획

- Vitest: 요청서 「테스트」 항목 전부(판정 9종, 응답 내용 4종, 라우트 4종)
- `npm run lint` / `typecheck` / `build` / `test`
- dev 서버 + 본인 개발 DB: 링크 발급 → 방장 등록 → 설정 완료 → 참여자 등록 → 일부 제출 → 현황 조회 curl, 다른 기기(로그인 세션) 제출 후 me.version 변화, 확인용 데이터 삭제·5개 테이블 스냅샷 비교

## 미정 사항

- 합의됨(요청서): 위 수용 기준 전부
- 문서 정렬(요청서 외, 공통 규약에 맞춤): TIME-API-02 에러 형식 줄 `{"error":{…}}` → API_CONVENTIONS `{ code, message, details? }`, 예시 `votingDeadlineAt`의 `.000` 제거(STATE-API-02 표기)
- 미구현: 레이트 리밋 [제안], ETag·304(P1)

## 결과

- 구현: `app/api/v1/promises/[promiseId]/availability/route.ts`(GET, `noStore`, 인증 모듈 순서, 인증 후 모든 응답 쿠키 갱신, 응답 변환), `lib/time/availability-status.ts`(`getAvailabilityStatus` — RepeatableRead 트랜잭션, `now()` 판정, 잠금 없음, 404·409·410·401 판정, effectiveStatus 계산, active 참여자 등록순)
- AC-1~10: 단위 테스트 35건과 dev 서버 curl로 확인(세부는 `context/current-feature.md` 검증 결과). 10분 경계 draft·다른 약속 세션 403·트랜잭션 안 재확인 401은 단위 테스트로만 확인
- 판단: 트랜잭션 안 재확인에 세션 만료도 포함(TIME-API-01과 같은 기준), 등록순 동률은 `id` 오름차순(DATABASE.md 승계 순서와 같은 기준), 인증 뒤 약속 행이 사라지면 404 + 쿠키 삭제, 재확인 통과 후 목록에 내가 없으면 401
- 검토(2026-11-05): 위 판단과 요청서 외 문서 정렬 2건 승인
