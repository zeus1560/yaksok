# 가능 시간 제출 API (TIME-API-01)

## 식별자와 상태

- 스펙 ID: `007-availability-submit-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: TIME-02-02·02-03(시간 형식·정밀도), TIME-05-02(24:00), TIME-06-01(30분 슬롯), TIME-07-01(구간 경계), TIME-08-01(지난 슬롯), TIME-10-01~04(저장·제출·버전), TIME-11-01~02(재제출), TIME-12-01(빈 선택 제출), TIME-15-01~04(마감 판정), STATE-02-02(draft 10분), STATE-10-01(취소)
- 결정: R-11(`PROMISE_CANCELLED` 통일), R-12(promiseId 형식 400·만료 draft 410·쿠키 갱신), R-13(잠금 안 draft 비삭제), C-07(cancelled 참여자 세션 401), C-08(`AVAILABILITY_VERSION_CONFLICT`), 신규 R-14(이번 정렬)
- ERD: DATABASE.md 4.1(`UNIQUE(participant_id, slot_start_at)`), 4.2(`ck_slot_start_at_boundary`), 5.1·5.2(범위·지난 슬롯), 8.2(제출·오래된 버전·재시도), 11절(체크리스트)
- API: TIME-API-01 (`docs/specs/api/time.md`), API_CONVENTIONS 3·4·5·7절
- 관련 미결·충돌: A-05(5,000개 상한 — 이번 요청서로 확정), A-09(Origin — TIME-API-01 반영), 레이트 리밋 [제안] 미구현

## 사용자와 문제

참여자(방장 포함)가 가능한 30분 칸을 골라 제출·재제출한다. 여러 기기에서 동시에 고쳐도 남의 제출을 조용히 덮어쓰면 안 되고, 응답 유실 뒤 같은 요청을 다시 보내도 충돌로 오인하면 안 된다. 지난 칸은 고정되고 범위 밖 칸은 빼고 저장한다.

## 목표와 범위

- 구현: `PUT /api/v1/promises/[promiseId]/me/availability`, 슬롯 형식 검증·범위 필터, 제출 트랜잭션, 테스트, 문서 갱신
- 제외: TIME-API-02(현황 조회), 화면, 레이트 리밋([제안]), DB 스키마 변경

## 선행 작업

005 — `session-auth.ts`(인증 순서·`withSessionCookie`), 006 — `no-store`·`PROMISE_NOT_OPEN`·잠금 후 상태 판정 패턴. 스키마의 `participants.availability_version`·`availability_submitted_at`, `participant_available_slots` 존재 확인.

## 사용자 흐름

제출 → Origin 403 → 본문 256KB 초과 413 → 세션 인증(형식 400 → 404 → 취소 409 → 401 → 다른 약속 403) → 이후 모든 응답 쿠키 갱신 → JSON·필드 400 → 원본 5,001개 이상 422 `SLOT_LIMIT_EXCEEDED` → 형식 422 `INVALID_SLOT_FORMAT` → 중복 합침 → 트랜잭션: `promises` `FOR UPDATE`, 잠금 후 `clock_timestamp()` → 취소 409 → draft(만료 410 / 진행 중 409 `PROMISE_NOT_OPEN`) → closed·confirmed 409 `VOTING_CLOSED` → 마감 경과면 closed 전환 커밋 + 409 `VOTING_CLOSED` → 세션·참여자 재확인 401 → 지난 슬롯 무시·범위 필터 → 버전 비교(재시도 200 / 충돌 409) → 미래 슬롯 교체·제출 시각·버전 +1 → 200.

## 수용 기준

- [x] AC-1 (A-09, API_CONVENTIONS 3·7): Origin 실패 403 `INVALID_ORIGIN`, 모든 응답 `Cache-Control: no-store`
- [x] AC-2: Content-Length 또는 실제 읽은 크기 256KB 초과 → 413 `PAYLOAD_TOO_LARGE`
- [x] AC-3 (R-12, API_CONVENTIONS 5): `session-auth.ts` 순서 그대로, 인증 성공 후 모든 응답 Set-Cookie(Max-Age = 응답 시점 DB `expires_at`까지 남은 초)
- [x] AC-4: JSON 파싱 실패, `baseVersion`(0 이상 정수)·`slots`(문자열 배열) 누락·타입 오류 → 400 `INVALID_REQUEST`
- [x] AC-5 (A-05): 원본 slots 5,000개 초과 → 422 `SLOT_LIMIT_EXCEEDED`(중복 정리 전)
- [x] AC-6 (TIME-02-02·02-03·06-01): `+09:00`, 분 00·30, 초 0(`.000` 허용), 실제 날짜가 아니면 422 `INVALID_SLOT_FORMAT`. 같은 시각은 합침
- [x] AC-7 (DATABASE 8.2, API_CONVENTIONS 4.2): `promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`. cancelled 409 → draft 410/409 → closed·confirmed 409 → 마감 경과 closed 전환 커밋 + 409
- [x] AC-8 (ERD 11절, C-07): 잠금 후 세션·참여자 재확인(미만료, active, 이 약속 소속). 아니면 401
- [x] AC-9 (TIME-08-01, ERD 5.1·5.2): 지난 슬롯(시작 ≤ 판정 시각) 무시·미집계, 범위 밖 미래 슬롯 droppedSlotCount
- [x] AC-10 (TIME-10-04, ERD 8.2): 버전 불일치 시 재시도면 200(변경 없음), 아니면 409 `AVAILABILITY_VERSION_CONFLICT` + details, 저장 없음
- [x] AC-11 (TIME-10-01·11-02·12-01): 미래 슬롯만 교체, 지난 슬롯 보존, 제출 시각 = 판정 시각, 버전 +1, 빈 배열 정상 제출
- [x] AC-12: 200 본문 `{ version, submitted, submittedAt, slots, droppedSlotCount }` 명세 형식
- [x] AC-13: 세션 토큰·쿠키 값 로그 없음

## 데이터와 인터페이스

스키마 변경 없음. TIME-API-01 명세 참조. 시각 표기: `submittedAt`만 밀리초 3자리(`…T18:35:10.027+09:00`). 200 `slots`와 409 details `slots`는 모두 초 단위(`…T14:00:00+09:00`) — 검토 후 통일(R-14).

## 구현 계획

1. `lib/time/seoul.ts` — 밀리초 3자리 표기 `toSeoulIsoMillisString`
2. `lib/time/slots.ts` — `parseSlotStrings`(상한·형식·중복), `filterSlots`(지난 슬롯·범위)
3. `lib/time/submit-availability.ts` — 트랜잭션 `submitAvailability`(잠금 후 판정·재확인·버전·저장)
4. `lib/api-error.ts` — 413·409 `VOTING_CLOSED`·409 `AVAILABILITY_VERSION_CONFLICT`·422 두 종류
5. `app/api/v1/promises/[promiseId]/me/availability/route.ts` — Origin → 크기 → 인증 → 본문 → 서비스
6. 테스트(각 파일 옆), 문서(time.md, DECISION_CONFLICTS)

## 검증 계획

- 단위: `slots.test.ts`(형식·상한·필터 경계), `submit-availability.test.ts`(가짜 tx로 판정 순서·저장·버전·마감 커밋), `route.test.ts`(403·413·400·422·쿠키·no-store)
- dev 서버 + 본인 개발 DB: 링크 발급 → 방장 등록 → 설정 완료 → 참여자 등록 → 제출 200, 두 기기 같은 baseVersion → 두 번째 409, 같은 요청 재전송 → 200 버전 그대로, 마감 경과 closed 커밋. 확인 후 데이터 삭제와 스냅샷 비교
- ERD 11절: 동일 슬롯 중복 저장(합침·UNIQUE), 다른 약속 참여자(403), 23:00 종료에 23:00 시작 거절, 24:00 종료에 23:30 허용, 기한 지난 collecting 쓰기 → closed 전환 후 거절, 슬롯 0개 제출, 탈퇴자 쿠키 401, 취소 약속 409
- `npm run lint` / `typecheck` / `test` / `build`

## 미정 사항

- 합의됨(요청서): 위 수용 기준 전부, 문서 정렬(R-14)
- 판단(2026-11-05 검토 결과):
  1. 잠금 후 재확인에 세션 행의 만료도 포함했다. 탈퇴·내보내기는 세션 `expires_at`을 현재 시각으로 바꾸므로, 인증과 잠금 사이에 탈퇴가 커밋되면 401이 나고 쿠키는 Max-Age=0으로 지워진다. → 승인
  2. 413은 세션 인증 전에 판정하므로 쿠키를 갱신하지 않는다(요청서 순서). 400·422는 인증 후라 쿠키를 갱신한다. → 승인
  3. 재시도 200의 `slots`는 서버 저장값 전체(지난 슬롯 포함), `droppedSlotCount`는 이번 요청 기준, `version`·`submittedAt`은 그대로. → 확정(구현이 이미 서버 저장값 기준이었음을 테스트로 확인)
  4. 슬롯 표기는 200·409 details·TIME-API-02 모두 초 단위로 통일, 밀리초 3자리는 `submittedAt`만. → 검토에서 변경 결정(R-14)
  5. 문서 간 차이(에러 래퍼 형식, `SUBMISSION_CONFLICT` 구 명칭, 결정 목록 체크)는 기존 판단(API_CONVENTIONS·C-08)대로 정리. → 승인
- 추가 결정: 413 `PAYLOAD_TOO_LARGE`를 API_CONVENTIONS 3절 공통 에러 코드로 추가
- 미결: 레이트 리밋 [제안], 상태별 허용 표의 TIME-API-02 draft 코드(TIME-API-02 범위)

## 결과

수용 기준 AC-1~13 모두 충족. 근거는 `context/current-feature.md` 「검증 결과」 표(2026-11-04, 검토 후 2026-11-05 재검증): Vitest 433건(이번 78건), lint·typecheck·build 통과, dev 서버 + 개발 DB에서 제출 200, 두 기기 409, 재전송 200(버전 그대로), 지난 슬롯 보존, 마감 경과 closed 커밋 + 409, 403·413·400·422·401 확인, 확인용 데이터 삭제 후 스냅샷 동일.

단위 테스트로만 확인: draft·만료 draft·confirmed·cancelled, 탈퇴 참여자·인증 뒤 세션 만료, 다른 약속 세션 403, 검토 후 슬롯 표기 통일(dev 서버 미재확인).
