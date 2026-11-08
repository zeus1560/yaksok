# 재조율 시작 API (STATE-API-06)

## 식별자와 상태

- 스펙 ID: `020-reopen-promise-api`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: STATE-01-01·01-02(closed·confirmed → collecting), STATE-06-03(마감 후 설정은 재조율로만), STATE-08-01, STATE-09-01(재조율 시작 상태), STATE-09-02(새 미래 마감 필수), STATE-09-03(범위 밖 슬롯만 삭제), STATE-09-04(추가 슬롯이 있으면 제출 해제, 축소만이면 유지), STATE-09-05(확정 해제), STATE-03-01·R-07(날짜 범위 3개월)
- ERD: DATABASE.md 4절 `confirmed_start_at`(재조율 시 NULL), 5.1(슬롯 경계), 5.2(재조율 마감은 미래), 6.3(설정 변경과 재조율 1~8), 8절(잠금)
- API: STATE-API-06 (`docs/specs/api/state.md`), STATE-API-00 「세션·보존 공통 계약」, STATE-API-02(설정 검증), API_CONVENTIONS 4.1·5.2
- 관련 미결·충돌: X-05(closed 재조율 — 09-01 본문은 confirmed만, 사용자 지시로 closed 포함), C-10(확정 세션 기준 — 재조율하면 확정 + 7일에서 새 마감 + 7일로 바뀜), C-11, R-07(명세 노션 원문 "90일" 대신 3개월), R-12(시작 날짜 하한), 이번 결정 R-26

## 사용자와 문제

마감됐거나 확정된 약속을 방장이 다시 열어 응답을 받는다. 범위를 바꾸면 기존 입력 중 새 범위 안의 것은 남기고, 새로 선택할 수 있는 칸이 생기면 모두 다시 제출하게 한다.

## 목표와 범위

- 이번에 할 일:
  - `POST /api/v1/promises/{promiseId}/reopen` — 현재 active host, Origin 필수, application/json, no-store, 인증 후 모든 응답 쿠키 갱신
  - 요청 파싱 `lib/state/settings-patch.ts` — `votingDeadlineAt` 필수, 나머지 선택(생략 시 유지). STATE-API-02 필드 파서 재사용
  - 설정 검증은 `validateStartSettings` 재사용. `dateRange`를 보낸 경우에만 시작 날짜 하한(오늘 이후, R-12) 검사. 정원 < active 인원은 422 `CAPACITY_BELOW_ACTIVE_COUNT`
  - 범위 변경 계산 순수 함수 `lib/state/range-change.ts` — 집합 A·B, 삭제할 슬롯, 추가 슬롯 여부, 버전 증가 참여자. STATE-API-03이 그대로 쓴다
  - `lib/state/reopen-promise.ts` — `promises`만 `FOR UPDATE`, 잠금 후 `clock_timestamp()`·재확인, 슬롯 삭제·제출 해제·버전·설정·상태·`confirmed_start_at=NULL`·세션 갱신을 한 트랜잭션으로
- 이번에 하지 않을 일: 화면(재조율 버튼·안내), DB 스키마 변경, STATE-API-03(모집 중 설정 변경)

## 선행 작업

- 005 — `parseStartSettings`·`validateStartSettings`
- 015 — `refreshActiveSessions`
- 016·017·019 — 잠금 후 재확인, 마감 지난 collecting closed 저장 패턴
- 007 — `filterSlots`의 범위 판정(5.1)

## 사용자 흐름

1. 방장이 새 마감(필수)과 바꿀 설정을 보낸다(화면은 이후 PR)
2. 서버가 약속 행을 잠그고 최신 권한·상태를 확인한 뒤 새 설정을 검증한다
3. 범위 밖 슬롯 삭제, 제출·버전 처리, 확정 해제, collecting·새 마감 저장, 세션을 새 마감 + 7일로 갱신
4. 200 `{ promiseId, promiseStatus: "collecting", currentConfirmation: null, changeImpact }`
5. 버전이 오른 참여자의 시간 입력 화면은 다음 폴링에서 서버 버전이 달라진 것을 보고 로컬 입력을 버린다(012 동작)

## 수용 기준

- [x] AC-1 (STATE-API-06 처리 순서 1): Origin 403 → promiseId 400 → 본문 400 → 404 → cancelled 409(세션보다 우선) → 401 → 403(다른 약속) → 잠금 → 취소 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403 → 허용 상태(closed·confirmed·마감 지난 collecting) 아니면 409 `INVALID_PROMISE_STATE`
- [x] AC-2 (처리 순서 2, R-07·R-12): 합친 설정을 STATE-API-02와 같은 규칙으로 검증해 422. 시작 날짜 하한은 `dateRange`를 보낸 경우만. 정원 < active 인원은 422 `CAPACITY_BELOW_ACTIVE_COUNT`. 실패 시 슬롯·참여자·설정·세션 변경 없음
- [x] AC-3 (처리 순서 3): confirmed였으면 `confirmed_start_at=NULL`, `confirmationCleared: true`
- [x] AC-4 (처리 순서 4·5, STATE-09-03·04): 새 범위 밖 active 참여자 슬롯만 삭제. B−A가 비면 제출 유지, 슬롯이 실제로 지워진 참여자만 버전 +1
- [x] AC-5 (처리 순서 6): B−A가 있으면 모든 active 참여자 `availability_submitted_at=NULL`·버전 +1(미제출자 포함)
- [x] AC-6 (처리 순서 7): 범위 그대로·소요 시간만·마감만 변경이면 슬롯·제출·버전 유지
- [x] AC-7 (처리 순서 8·9): `status=collecting`·새 설정·새 마감 저장. active 참여자의 유효 세션만 새 마감 + 7일, 요청자 쿠키 갱신
- [x] AC-8: 재조율과 확정 경쟁 — 먼저 잠근 쪽이 이김. 같은 방장 병렬 재조율 — 200 하나·409 하나
- [x] AC-9: test(3개 TZ)·lint·typecheck·build, 개발 DB 실제 호출, 버전 오른 참여자 화면 확인(브라우저)

## 데이터와 인터페이스

- DB·스키마 변경 없음
- 요청: `{ votingDeadlineAt, participantLimit?, dateRange?: { startDate, endDate }, dailyTimeRange?: { startTime, endTime }, durationMinutes? }`. 형식은 STATE-API-02와 같다(마감은 오프셋 필수). `null`·부분 객체는 400, 모르는 필드는 무시
- 200: `{ promiseId, promiseStatus: "collecting", currentConfirmation: null, changeImpact: { hasAddedSelectableSlots, submissionsReset, removedSlotCount, versionChangedParticipantCount, confirmationCleared } }`
- 422 `CAPACITY_BELOW_ACTIVE_COUNT` `{ field: "participantLimit" }` 신설
- `planRangeChange({ before, after, now, participants }) → { hasAddedSelectableSlots, submissionsReset, removedSlotIds, versionChangedParticipantIds }`

## 구현 계획

1. RED: 대표 테스트 2건(결과 값 검증) + 아무것도 바꾸지 않는 빈 구현
2. GREEN: 범위 계산·파싱·검증·잠금·저장 구현
3. REFACTOR: 순수 함수 단위 테스트(축소·확대·이동·하루 범위·소요 시간·마감만·미제출자), 서비스 분기, Route Handler와 `route.test.ts`
4. 문서: state.md STATE-API-06 구현 결정, API_CONVENTIONS 3절 에러 코드·5.2 재조율 행, DECISION_CONFLICTS R-26·X-05·C-10

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`
- lint·typecheck·build(dev 서버 종료 후)
- 개발 DB 실제 호출: 사용자 요청 목록 전부, 확인용 데이터 삭제·스냅샷 비교
- 브라우저: 버전이 오른 참여자의 시간 입력 화면 안내·로컬 입력 폐기

## 미정 사항

- 결정(사용자 지시): closed 재조율 허용(X-05), 날짜 범위는 R-07(3개월), `dateRange`를 생략하면 시작 날짜 하한을 검사하지 않음
- 결정(이번 구현, R-26): 슬롯 정리·버전·제출 해제는 active 참여자만(탈퇴자 기록 보존). 「선택 가능」 추가 슬롯은 B−A 중 판정 시각 이후 시작 칸만 센다. 마감 지난 collecting은 closed를 먼저 저장(검증 실패여도 커밋). draft는 10분 경과와 관계없이 409
- 팀 확인: C-10 — confirmed에서 재조율하면 세션이 확정 + 7일 → 새 마감 + 7일로 바뀌어 짧아질 수 있음

## 결과

AC-1~9 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: `lib/state/reopen-promise.ts`, `lib/state/range-change.ts`(순수 함수, 03 공용), `lib/state/settings-patch.ts`(부분 요청 파싱·합치기), `lib/state/start-settings.ts`(필드 파서 공개, `checkStartDateFloor` 옵션, 정원 위반 `code`), `lib/time/slots.ts` `isSlotInRange`(`filterSlots`와 공유), `lib/api-error.ts` `capacityBelowActiveCount`, `app/api/v1/promises/[promiseId]/reopen/route.ts`
- 문서: state.md STATE-API-06 구현 결정, API_CONVENTIONS 5.2 재조율 행, DECISION_CONFLICTS R-26 신설·X-05·C-10 추가
- 기존 테스트 기대값 수정 1곳: `start-collecting.test.ts` 정원 위반 결과에 `code` 필드 추가(STATE-API-02 응답은 그대로 `VALIDATION_FAILED`)
