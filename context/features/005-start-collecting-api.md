# 설정 완료와 모집 시작 API (STATE-API-02)

## 식별자와 상태

- 스펙 ID: `005-start-collecting-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: STATE-01-02(draft → collecting), STATE-02-02(draft 10분·삭제 순서), STATE-03-01(모집 시작 필수값), MEMBER-06-03(세션 유지), TIME-01-01(Asia/Seoul)
- 결정: R-07(종료일 오늘부터 3개월, 달력 월), R-11(재인증), R-12(이번 결정), C-07(cancelled 참여자 401 안)
- ERD: DATABASE.md 4.2(CHECK·서버 검증), 8절(잠금), 10절(draft 물리 삭제)
- API: STATE-API-00·02 (`docs/specs/api/state.md`), API_CONVENTIONS 3·4.1·4.2·5·5.2·7절, MEMBER-API-04 (`docs/specs/api/member.md`)
- 관련 미결·충돌: A-09(Origin — STATE-API-02 반영), C-02(정원 2~30, ERD 기준 사용), C-04·TIME-13-xx(마감 입력 규칙 미결 — STATE-03-01 문장만 적용)

## 사용자와 문제

방장 등록 후 10분 안에 정원·날짜·하루 시간·소요 시간·마감을 정해 가능 시간 수집을 시작해야 한다. 이후 세션 인증 API가 모두 같은 인증 순서와 쿠키 갱신 규칙을 쓰도록 공통 모듈이 필요하다.

## 목표와 범위

- 구현: `POST /api/v1/promises/[promiseId]/start`, 세션 인증 공통 모듈, 설정 검증, MEMBER-API-04 만료 draft 410 변경, 문서 갱신
- 제외: 화면, 다른 STATE API, 시도 제한, DB 스키마 변경

## 사용자 흐름

설정 화면에서 저장 → Origin → 세션 인증(형식 400 → 404 → 취소 409 → 401 → 403) → 본문 형식 400 → 트랜잭션: 링크 → 약속 `FOR UPDATE`, `clock_timestamp()` → 취소 409 → 최신 active host 아니면 403 → draft 아니면 409 → 10분 지났으면 삭제·410(커밋) → 규칙 422 → 저장 + 세션 연장 → 200 + 쿠키.

## 수용 기준

- [x] AC-1 (A-09): Origin 없음·불일치 → 403 `INVALID_ORIGIN`. 모든 응답 `Cache-Control: no-store`
- [x] AC-2 (STATE-API-00): 세션 인증 공통 모듈 — promiseId 형식 400, 없는 약속 404, cancelled는 세션보다 먼저 409, 쿠키 SHA-256 해시 조회, 만료·cancelled 참여자 401, 다른 약속 세션 403
- [x] AC-3 (R-12): 세션 인증 성공 후 모든 응답에 Set-Cookie, Max-Age = 응답 시점 `expires_at`까지 남은 초. 같은 요청에서 바뀌면 바뀐 값, 세션 삭제 시 Max-Age=0
- [x] AC-4 (4.1·4.2): 링크 → 약속 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, 잠금 후 cancelled 409·비방장 403·비 draft 409(details 포함)
- [x] AC-5 (STATE-02-02): 10분 지난 draft는 세션 → 방장 참여자 → promise 삭제 후 410 `DRAFT_EXPIRED`, 삭제는 커밋
- [x] AC-6 (STATE-03-01, R-07, R-12): 설정 형식 400 / 규칙 422, 하나라도 실패하면 저장 없음 — 정원 2~30·active 이상, 실제 날짜, 오늘 ≤ 시작 ≤ 종료 ≤ 오늘 + 3개월, HH:mm 30분 경계(24:00=1440), 소요 시간, 오프셋 있는 마감·판정 시각 이후·endDate 00:00 이전
- [x] AC-7: 설정 + `status=collecting` 한 트랜잭션 저장
- [x] AC-8 (STATE-API-00 세션 계약): active 참여자의 유효 세션만 `마감 + 7일`로 갱신, 만료·cancelled 세션 유지
- [x] AC-9: 200 본문 명세 그대로, `votingDeadlineAt` +09:00
- [x] AC-10 (R-12): MEMBER-API-04 10분 지난 draft → 410 `DRAFT_EXPIRED`, 삭제 없음
- [x] AC-11 (R-12): MEMBER-API-04 promiseId 형식 오류 404 → 400 `INVALID_REQUEST`. 약속 기준 API는 형식 오류 400, 링크 토큰 기준 API는 기존대로 404

## 데이터와 인터페이스

스키마 변경 없음. 쓰기: `promises` 설정 7개 컬럼 + `status`, `participant_sessions.expires_at` 일괄 갱신(410 경로는 세션·참여자·약속 삭제).

## 구현

1. `lib/time/seoul.ts`: `seoulDateOf`, `seoulMidnight`, `isCalendarDate`, `addCalendarMonths`
2. `lib/state/start-settings.ts`: `parseStartSettings`(400), `validateStartSettings`(422, 순수 함수), `minuteToTime`
3. `lib/member/session-auth.ts`: `authenticatePromiseSession`, `withSessionCookie`, `readCookie`
4. `lib/state/start-collecting.ts`: `startCollecting` 트랜잭션
5. `app/api/v1/promises/[promiseId]/start/route.ts`
6. `lib/api-error.ts`: 401·403·409(details)·410 `DRAFT_EXPIRED` 헬퍼
7. `lib/member/login.ts`·`auth/session/route.ts`: `draft_expired` → 410
8. 문서: state.md(STATE-API-02), member.md(MEMBER-API-04), API_CONVENTIONS(3·5·5.2절), DECISION_CONFLICTS(R-11 갱신, R-12 신설, A-09)

## 미정 사항·판단

- 아래 판단은 2026-11-04 모두 승인됨. 검토 후 MEMBER-API-04 promiseId 형식 오류를 400으로 통일하고, R-12 시작 날짜 근거는 "TIME-API-01이 지난 슬롯을 무시해 과거 날짜는 선택할 수 없는 칸이 된다"만 남겼다.
- 결정(사용자 확인, 2026-11-04): 날짜 상한은 R-07(오늘 + 3개월, 달력 월, 말일 보정). 요청서의 "시작일 + 89일"은 R-07과 충돌해 채택하지 않았다. 89·90일 경계 테스트 대신 3개월 경계(02-04/02-05, 11-30 → 02-28/03-01) 테스트로 대체.
- 판단: 본문 형식 검사(400)는 세션 인증 뒤에 한다. 취소 약속에 형식이 틀린 본문을 보내도 409가 먼저 나오고, 인증 성공 후 400도 쿠키를 갱신한다.
- 판단: "실제 존재하지 않는 날짜(2026-02-30)·시각(25:00)"과 오프셋 없는 마감은 형식 오류 400, 30분 경계·범위·순서는 422로 나눴다. 정수가 아닌 숫자(2.5)는 422.
- 판단: 410·잠금 후 404(다른 요청이 이미 정리)는 세션 행이 사라졌으므로 쿠키를 `Max-Age=0`으로 지운다.
- 판단: 요청자 세션이 인증과 잠금 사이에 만료되면 갱신 대상에서 빠지고, 200 응답 쿠키는 원래 `expires_at`(이미 지남 → Max-Age=0) 기준이다.
- 판단: 마감 입력에 밀리초가 있으면 그대로 저장하고 응답은 초 단위(+09:00)로 표기한다.
- 남은 미결: STATE 담당자 구현과 시작 날짜 규칙 비교(R-12), 마감 입력 규칙(TIME-13-xx), API_CONVENTIONS 5.2 "마감 연장·단축 시 모든 세션" 행은 STATE-API-03 구현 때 유효 세션만으로 맞춘다.

## 결과

- 수용 기준 AC-1~11 충족 (2026-11-04). Vitest 273건(이번 116건), lint·typecheck·build 통과.
- 개발 DB: 링크 발급 → 방장 등록 → 같은 쿠키로 설정 완료 200, Max-Age = 마감 + 7일까지 남은 초, 1440 저장, 만료·cancelled 세션 유지, 10분 지난 draft 410 삭제 커밋 확인. 확인용 데이터 삭제.
- MEMBER-API-04의 400 변경은 테스트로만 확인했다(dev 서버 재확인 없음). 상세는 `context/current-feature.md` 완료 이력.
