# 방장 관리 화면 (화면 PR 5a)

## 식별자와 상태

- 스펙 ID: `027-host-manage-ui`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- User Story: US-CONF-02(진행 상태 조회), 방장 관리(설정 변경·재조율·취소·내보내기) — MVP P0
- 비즈니스 규칙: STATE-09-02(재조율 새 마감 필수), STATE-09-03·09-04(범위 변경 시 입력 정리·재제출), STATE-09-05(확정 해제), TIME-14-03·04(정원 증가만·마감 연장만, R-27), MEMBER-08-02(명단 제출 여부 비공개), TIME-10-04(5초 폴링)
- API: STATE-API-01·03·06·07 (`docs/specs/api/state.md`), MEMBER-API-05·06·08 (`docs/specs/api/member.md`)
- 관련 결정: R-24(018 화면), R-25(취소 409 처리), R-26(같은 과거 범위 재전송 422 → 바꾼 경우만 `dateRange`), R-27(설정 변경), R-29(명단), R-30(내보내기). 이번 화면 결정은 R-33

## 사용자와 문제

방장은 모집 중 정원·마감·범위를 바꾸거나, 마감·확정 뒤 다시 열거나, 약속을 취소하거나, 잘못 들어온 참여자를 내보내야 한다. API는 모두 있지만 화면이 없다. 다른 참여자는 누가 들어왔는지(정원 현황 포함) 볼 수 없다.

## 목표와 범위

- 이번에 할 일:
  1. 방장 전용 "방장 메뉴"를 화면 위쪽에 둔다. 현재 방장(`/me` role host + active + canManagePromise)이 아니면 그리지 않는다. 기존 "응답 마감하기"(018)도 이 메뉴로 옮긴다
  2. 설정 변경(STATE-API-03): collecting(상태 조회 기준, 마감 전)
  3. 재조율(STATE-API-06): closed·confirmed
  4. 약속 취소(STATE-API-07): collecting·closed·confirmed
  5. 참여자 명단(MEMBER-API-06): 모든 참여자. 등록순·방장 표시·내 항목·정원 현황
  6. 참여자 내보내기(MEMBER-API-08): 방장에게만, collecting(마감 전), 본인 행에는 버튼 없음
- 이번에 하지 않을 일: 탈퇴·로그아웃 버튼, 시간 입력 화면 버그(다음 PR 5b), API·DB 변경

## 화면 판단

- 방장 버튼 = `canManage(me)`(018과 같음). `/me`의 `deadlinePassed`는 쓰지 않는다
- 상태별 메뉴는 상태 조회(STATE-API-01) `promiseStatus` 기준: collecting → 마감·설정 변경·취소, closed·confirmed → 재조율·취소
- 폼의 현재 값은 상태 조회의 `settings`. 바꾼 필드만 보낸다. 날짜 범위는 시작·종료 중 하나라도 바뀌었을 때만 `dateRange`(R-26)
- 화면 검증은 서버와 같은 순수 함수(`validateStartSettings`·`validateCollectingChange`·`applySettingsPatch`)로 한다
- 설정 변경: 정원 − 버튼은 현재 값에서 막고, 마감 입력 `min`은 현재 마감. 기존 마감 ≥ 새 마지막 날 00:00이면 "마감이 새 마지막 날보다 늦어서 줄일 수 없어요. 재조율로 다시 열어 주세요"로 저장을 막는다
- 범위 변경 미리 보기: `lib/state/range-change.ts`의 `hasAddedSelectableSlots`를 그대로 쓴다 — (전, 후, 지금)이 참이면 "모든 참여자가 다시 제출해야 해요", (후, 전, 0)이 참이면(지워지는 칸이 있음) "범위 밖 입력이 삭제돼요"
- 재조율: 새 마감 필수. 나머지는 "설정도 바꾸기"를 펼쳤을 때만 보낸다. 정원 하한은 max(2, 현재 인원). confirmed면 "확정된 일정이 해제돼요"
- 저장 뒤 `changeImpact`를 한 줄로 안내(삭제된 칸 수, 제출 해제, 확정 해제)
- 명단은 상태 조회와 같은 5초 폴링(탭 숨김 중지). 내보내기 성공·실패 뒤 명단·상태를 다시 조회

## 실패 처리 (에러 코드 기준 순수 함수 `lib/manage/failure.ts`)

| 요청                           | 코드                                                                                                  | 처리                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 설정 변경·재조율               | 422 `VALIDATION_FAILED`(field)                                                                        | 해당 입력란에 서버 메시지                             |
| 설정 변경                      | 422 `CAPACITY_DECREASE_NOT_ALLOWED`·`DEADLINE_SHORTEN_NOT_ALLOWED`·`CAPACITY_BELOW_ACTIVE_COUNT`      | 정원·마감 입력란 안내 + 상태 다시 조회                |
| 재조율                         | 422 `CAPACITY_BELOW_ACTIVE_COUNT`                                                                     | 정원 입력란 안내 + 명단 다시 조회                     |
| 설정 변경·재조율·취소·내보내기 | 409 `INVALID_PROMISE_STATE`                                                                           | 안내 + 상태 다시 조회(폼 닫음)                        |
| 공통 쓰기                      | 403 `FORBIDDEN`                                                                                       | `/me` 다시 조회                                       |
| 취소                           | 409 `PROMISE_CANCELLED`                                                                               | **성공과 같음**(응답 유실 재요청, R-25) → 링크 재조회 |
| 내보내기                       | 409 `CANNOT_REMOVE_SELF`·`DEADLINE_PASSED`, 404 `PARTICIPANT_NOT_FOUND`                               | 안내 + 명단·상태 다시 조회                            |
| 명단 조회                      | 403 `FORBIDDEN`                                                                                       | 링크 재조회(다른 약속 세션)                           |
| 공통                           | `UNAUTHENTICATED`·`PROMISE_CANCELLED`(취소 외)·`PROMISE_NOT_FOUND`·`PROMISE_NOT_OPEN`·`DRAFT_EXPIRED` | 링크 재조회                                           |
| 공통                           | `INVALID_ORIGIN`·5xx·네트워크·알 수 없는 코드                                                         | 화면 유지, 다시 시도 안내                             |
| 설정 변경·재조율               | 400 `INVALID_REQUEST`                                                                                 | 입력 확인 안내(다시 시도)                             |

## 수용 기준

- [x] AC-1: 현재 방장에게만 방장 메뉴가 화면 위쪽에 보이고, 상태별로 쓸 수 있는 동작만 보인다
- [x] AC-2 (STATE-API-03, R-26·27): 바꾼 필드만 보내고 범위를 안 바꿨으면 `dateRange`를 보내지 않는다. 정원 감소·마감 단축은 고를 수 없다. 마감 때문에 막히는 축소는 이유와 함께 막는다
- [x] AC-3 (STATE-09-03·04): 저장 전 범위 축소·확대·이동 결과를 미리 보여 주고, 저장 뒤 `changeImpact`를 안내한다. 다른 참여자 화면은 다음 폴링에서 바뀐다
- [x] AC-4 (STATE-API-06): closed·confirmed에서 새 마감만으로, 또는 설정도 바꿔 다시 연다. confirmed면 확정 해제 안내. 참여자 화면은 시간 입력 화면으로 바뀐다
- [x] AC-5 (STATE-API-07, R-25): 확인 1회, 요청 중 버튼 막음, 성공·409 `PROMISE_CANCELLED` 모두 링크 재조회로 취소 안내. 참여자 화면도 취소 안내
- [x] AC-6 (MEMBER-API-06): 모든 참여자에게 명단(등록순·방장·나)과 현재 인원/정원. 제출 여부 없음
- [x] AC-7 (MEMBER-API-08): 방장에게만, collecting에서, 본인 행 제외 내보내기. 확인 1회, 성공 뒤 명단 갱신, 실패 코드별 안내·재조회. 내보내진 사람 화면은 다음 요청 401로 링크 재조회
- [x] AC-8: 실패 분기 순수 함수 코드별 테스트, test(3개 TZ)·lint·typecheck·build, 브라우저 방장 1280px·참여자 390px

## 구현 계획

- 순수 로직 `lib/manage/`: `settings-form.ts`(폼 값 ↔ settings, 바꾼 필드만 요청 본문, 화면 검증, 범위 변경 미리 보기), `impact.ts`(changeImpact 안내 문구), `failure.ts`(API별 실패 분기)
- 화면 `components/manage/`: `host-menu.tsx`(방장 메뉴, 마감 확인 포함), `settings-panel.tsx`(설정 변경·재조율 공용 폼), `cancel-panel.tsx`, `participant-list.tsx`
- 연결: `promise-room.tsx`가 상태 조회의 `settings`를 보관하고 메뉴·명단을 그린다. `close-voting-bar.tsx`는 메뉴 안 마감 확인으로 옮긴다

## 검증 계획

- Vitest: `lib/manage/*.test.ts`(TDD 대표 2건 먼저 RED)
- 브라우저: `scripts/verify/027-host-manage.mjs`(Playwright, 방장 1280px·참여자 390px)
- 개발 DB 확인용 데이터 삭제, 스냅샷 시작 상태와 동일

## 미정 사항

- 없음(사용자 지시로 범위 확정). 화면 판단은 R-33에 기록
- 팀 확인: 명단 기본 접힘·5초 폴링, "범위 밖 입력이 삭제돼요"는 칸 기준(실제 입력 유무와 무관) — R-33

## 결과

AC-1~8 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: 순수 로직 `lib/manage/{settings-form,impact,failure}.ts`, 화면 `components/manage/{host-menu,settings-panel,cancel-panel,participant-list}.tsx`, `promise-room.tsx`(settings 보관·명단 폴링·방장 메뉴·명단 연결), `close-voting-bar.tsx` → 메뉴 안 `CloseVotingConfirm`, `setup-form.tsx`의 `Section`·`Stepper`·`ReadOnlyValue`·`SELECT` export(재사용)
- `lib/state/range-change.ts`는 서버 전용 의존성이 없어(`slots.ts`·`seoul.ts`만) 화면에서 그대로 import했다. 같은 규칙을 화면에 새로 쓰지 않았다
