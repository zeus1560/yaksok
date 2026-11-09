# 모집 중 설정 변경 API (STATE-API-03)

## 식별자와 상태

- 스펙 ID: `021-update-settings-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: STATE-01-02(collecting 중 재설정, 상태 유지), STATE-04-01(모집 중 변경 항목: 정원 증가·마감 연장·소요 시간·날짜·하루 범위), STATE-04-02·09-03(범위 밖 입력만 삭제), STATE-04-03·09-04(확대·이동이면 제출 해제, 축소만이면 유지), STATE-03-01·R-07(날짜 범위 3개월)
- ERD: DATABASE.md 6.3(설정 변경과 재조율 1~8), 5.1(슬롯 경계), 8절(잠금), 「설정 전용 버전 없음」 문단
- API: STATE-API-03 (`docs/specs/api/state.md`), STATE-API-00, STATE-API-02(설정 검증), STATE-API-06(범위 변경 계산 공유), API_CONVENTIONS 4.1·5.2
- 관련 미결·충돌: TIME-14-03·14-04(마감 연장·단축 조건 ❗미결 — 명세·사용자 지시로 「모집 중 연장만」), R-07(노션 원문 "최대 90일" 대신 3개월), R-12·R-26(시작 날짜 하한은 `dateRange`를 보낸 경우만), 이번 결정 R-27

## 사용자와 문제

모집 중인 약속의 방장이 응답을 받는 도중에 정원을 늘리거나 마감을 미루거나, 날짜·하루 범위·소요 시간을 바꾼다. 범위가 줄면 범위 밖 입력만 지우고, 새로 고를 수 있는 칸이 생기면 모두 다시 제출하게 한다.

## 목표와 범위

- 이번에 할 일:
  - `PATCH /api/v1/promises/{promiseId}/settings` — 현재 active host, Origin 필수, application/json, no-store, 인증 후 모든 응답 쿠키 갱신
  - 요청 파싱 `parseSettingsUpdate`(`lib/state/settings-patch.ts`) — 한 필드 이상, 생략한 값은 유지. 020 필드 파서 재사용
  - 검증: `validateStartSettings`(공통) → `validateCollectingChange`(정원 증가만·마감 연장만)
  - 재조율과 같은 단계(잠금·재확인·마감 경과 closed 저장·설정 합치기·범위 정리·설정 저장)를 `lib/state/settings-change.ts`로 묶어 `reopen-promise.ts`와 `update-settings.ts`가 함께 쓴다(재조율 동작 변경 없음)
  - 마감을 연장할 때만 `refreshActiveSessions`
- 이번에 하지 않을 일: 화면(설정 변경 폼·축소 경고), DB 스키마 변경

## 선행 작업

- 020 — `range-change.ts`·`settings-patch.ts`·재조율 잠금·재확인 패턴
- 005 — `validateStartSettings`
- 015 — `refreshActiveSessions`
- 014 — STATE-API-01 settings 표기

## 사용자 흐름

1. 방장이 바꿀 필드만 보낸다(화면은 이후 PR)
2. 서버가 약속 행을 잠그고 최신 권한·상태·마감을 확인한 뒤 합친 설정을 검증한다
3. 범위 밖 슬롯 삭제, 제출·버전 처리, 설정 저장, 마감 연장이면 세션 갱신
4. 200 `{ promiseId, promiseStatus: "collecting", settings, changeImpact }`
5. 참여자 화면은 다음 폴링에서 settings·버전을 보고 다시 그린다(012 동작)

## 수용 기준

- [x] AC-1: Origin 403 → promiseId 400 → 본문 400(빈 요청 포함) → 404 → cancelled 409(세션보다 우선) → 401 → 403(다른 약속) → 잠금 → 취소 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403
- [x] AC-2 (처리 순서 1): 잠금 후 마감 시각 이상이면 closed를 저장하고 409 `INVALID_PROMISE_STATE`(저장 유지). draft·closed·confirmed 409, `allowedStates=["collecting"]`
- [x] AC-3: 합친 설정을 STATE-API-02와 같은 규칙으로 검증(R-07, `dateRange`를 보낸 경우만 시작 날짜 하한), 정원 < active 422 `CAPACITY_BELOW_ACTIVE_COUNT`, 정원 감소 422 `CAPACITY_DECREASE_NOT_ALLOWED`, 마감 단축 422 `DEADLINE_SHORTEN_NOT_ALLOWED`. 실패 시 아무것도 바뀌지 않음
- [x] AC-4 (처리 순서 2~6): 범위 밖 active 참여자 슬롯만 삭제, 축소만이면 제출 유지·슬롯이 지워진 참여자만 버전 +1, 확대·이동이면 모든 active 참여자 제출 해제·버전 +1, 새 슬롯 자동 선택 없음
- [x] AC-5 (처리 순서 7): 범위 그대로·소요 시간만·정원만·마감만이면 슬롯·제출·버전 유지
- [x] AC-6 (처리 순서 8): 마감 연장 때만 active 참여자의 유효 세션을 새 마감 + 7일로, 요청자 쿠키도 그 값. 만료·탈퇴 세션은 되살리지 않음
- [x] AC-7: 상태는 collecting 유지, 200 응답 `settings`(변경 후 전체, STATE-API-01 표기)·`changeImpact` 6개 필드
- [x] AC-8: 제출과의 경쟁·같은 방장 병렬 변경이 잠금 순서대로 직렬 적용과 같은 결과
- [x] AC-9: 재조율 기존 테스트 그대로 통과(공용 모듈로 옮긴 뒤 단위 33건·개발 DB 66개 항목)
- [x] AC-10: test(3개 TZ)·lint·typecheck·build, 개발 DB 실제 호출, 012 화면 브라우저 확인(코드 변경 없음)

## 데이터와 인터페이스

- DB·스키마 변경 없음
- 요청: `{ participantLimit?, dateRange?: { startDate, endDate }, dailyTimeRange?: { startTime, endTime }, durationMinutes?, votingDeadlineAt? }` 중 하나 이상. 형식은 STATE-API-02와 같다
- 200: `{ promiseId, promiseStatus: "collecting", settings: { participantLimit, dateRange, dailyTimeRange, durationMinutes, votingDeadlineAt }, changeImpact: { rangeChanged, hasAddedSelectableSlots, submissionsReset, removedSlotCount, versionChangedParticipantCount, candidateRecalculationRequired } }`
- 422 `CAPACITY_DECREASE_NOT_ALLOWED` `{ field: "participantLimit" }`, `DEADLINE_SHORTEN_NOT_ALLOWED` `{ field: "votingDeadlineAt" }` 신설. 설정 위반 → 응답 변환은 `settingsViolation`(재조율과 공유)

## 구현 계획

1. RED: 대표 테스트 2건(결과 값 검증) + 아무것도 바꾸지 않는 빈 구현
2. GREEN: 재조율 공통 단계 추출, 모집 중 규칙, 서비스 구현
3. REFACTOR: 서비스 분기 테스트, 순수 함수 테스트, Route Handler와 `route.test.ts`
4. 문서: state.md STATE-API-03 구현 결정·에러 표, API_CONVENTIONS 5.2 마감 연장 행, DECISION_CONFLICTS R-27

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`
- lint·typecheck·build(dev 서버 종료 후)
- 개발 DB 실제 호출: 사용자 요청 목록 전부 + 재조율 회귀, 확인용 데이터 삭제·스냅샷 비교
- 브라우저: 버전이 오른 참여자·버전이 그대로인 참여자의 로컬 입력·머리글

## 미정 사항

- 결정(사용자 지시·명세): 모집 중 정원은 증가만, 마감은 연장만(TIME-14-03·04 ❗미결 — 팀 확인 필요), 날짜 범위는 R-07(3개월), `dateRange`를 생략하면 시작 날짜 하한을 검사하지 않음
- 결정(이번 구현, R-27): 빈 요청 400, 공통 규칙 → 모집 중 규칙 순서(정원 < active는 `CAPACITY_BELOW_ACTIVE_COUNT`), 같은 정원·같은 마감은 변경 없음으로 허용, `rangeChanged`·`candidateRecalculationRequired` 정의
- 화면 PR 몫: 범위가 줄어도 버전이 그대로인 참여자의 로컬 입력은 남고, 화면 밖 칸이 제출 바 "선택 N칸"에 포함됨(제출하면 서버가 제외하고 안내)

## 결과

AC-1~10 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: `lib/state/update-settings.ts`, `lib/state/settings-change.ts`(재조율과 공유), `lib/state/settings-patch.ts`(`parseSettingsUpdate`·`validateCollectingChange`), `lib/state/start-settings.ts`(위반 코드 2종 추가), `lib/state/promise-view.ts`(`buildSettingsView` 공개), `lib/api-error.ts`(422 2종·`settingsViolation`), `app/api/v1/promises/[promiseId]/settings/route.ts`
- 재조율: `reopen-promise.ts`가 공용 단계를 쓰도록 바꿈(같은 SQL·같은 순서), `reopen/route.ts`는 `settingsViolation` 사용. 기존 테스트 수정 없음
- 문서: state.md STATE-API-03 구현 결정·에러 표, API_CONVENTIONS 5.2 마감 연장 행, DECISION_CONFLICTS R-27 신설
