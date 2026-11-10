# 마감·후보·확정·결과 화면 (화면 PR 4)

## 식별자와 상태

- 스펙 ID: `018-result-ui`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- User Story: US-SCHED-03(일정 후보 선택·확정), US-CONF-02(진행 상태 조회), US-CONF-03(결과 조회) — MVP P0
- 비즈니스 규칙: RESULT-03-01·04-01(후보 조건), RESULT-04-02(방장 불참 후보 확정 시 안내), RESULT-06-01·06-02(정렬·상위 5개), RESULT-11-01(방장만 확정, 마감 뒤에만), RESULT-13-02(확정 뒤 인원은 현재 응답 기준, 2명 미만이어도 유지), STATE-08-01(방장 수동 확정), TIME-10-04(5초 폴링·SWR)
- API: STATE-API-01·04·05·10 (`docs/specs/api/state.md`), MEMBER-API-05(`/me`), TIME-API-02(모두의 시간)
- 관련 미결: RESULT-07-02(겹치는 후보 — 묶지 않음), RESULT-07-01(표시 개수 — 상위 5개 + 더 보기), RESULT-08-01·08-02(후보 없음 안내·후속 행동 — 중립 안내만), RESULT-10-01(후보별 이름 — 보이지 않음), RESULT-05-01·05-03(미제출자·비율 — 보이지 않음), RESULT-11-02(목록 밖 후보 확정 — 사용자 요청과 API대로 허용). 이번 결정은 DECISION_CONFLICTS R-24

## 사용자와 문제

방장은 응답이 충분히 모이면 마감하고, 후보 중 하나를 확정한다. 다른 참여자는 마감·확정을 따로 알림받지 않으므로 열어 둔 화면이 스스로 바뀌어야 한다. 확정 직전 후보가 무효가 되거나 응답이 유실돼도 결과 화면에 도착해야 한다.

## 목표와 범위

- 이번에 할 일:
  1. collecting: 시간 입력 화면 위에 방장 전용 "응답 마감하기"(STATE-API-04). 확인 1회, 요청 중 비활성
  2. closed: 후보 화면(STATE-API-10) 상위 5개 + 공통 가능 인원, "더 보기"(offset). 모든 참여자가 보고 방장에게만 후보마다 "이 시간으로 확정"(STATE-API-05). 방장이 아니면 "방장이 확정하면 여기에 표시돼요". 후보가 없으면 안내
  3. confirmed: 결과 화면 — 확정 일정(한국 시간), 공통 가능 인원, 초대 링크 복사. 방장에게 `hostActionRequired`면 "지금 참석 가능한 사람이 2명 미만이에요"
  4. closed·confirmed에서 "모두의 시간 보기"로 기존 그리드 읽기 전용
  5. 012 이월: 시간 입력 화면 머리글이 closed·confirmed면 설정 마감 시각 대신 "응답 마감됨"
- 이번에 하지 않을 일: 재조율·취소·설정 변경·탈퇴 버튼, 겹치는 후보 묶기, API·DB 변경

## 화면 판단

- 화면 = 상태 조회(STATE-API-01) `promiseStatus` + `/me`의 `role`·`permissions.canManagePromise`·`status`. `/me`의 `deadlinePassed`는 쓰지 않는다(조기 마감에서 false)
- 상태 조회를 SWR로 폴링: 요청 시작 간격 5초(직전 응답 시간만큼 다음 간격을 줄임), 탭 숨김 중지·복귀 즉시 조회, 실패 시 마지막 성공 값 유지 + "연결이 불안정해요"
- draft·cancelled 등 그 밖의 상태와 401·403·404·취소 409는 링크 재조회(011 흐름)

## 실패 처리 (에러 코드 기준 순수 함수 `lib/result/failure.ts`)

| 요청      | 코드                                                                                                           | 처리                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 마감      | 200                                                                                                            | 바로 후보 화면 + 상태 다시 조회                        |
| 마감·확정 | 409 `INVALID_PROMISE_STATE`                                                                                    | 상태 다시 조회(이미 확정·응답 유실 재시도 → 결과 화면) |
| 마감·확정 | 403 `FORBIDDEN`                                                                                                | `/me` 다시 조회(실패하면 링크 재조회), 안내            |
| 확정      | 422 `INVALID_CONFIRMATION_CANDIDATE`·`VALIDATION_FAILED`                                                       | "후보가 바뀌었어요" + 후보 처음부터 다시 조회          |
| 후보 조회 | 409 `INVALID_PROMISE_STATE`                                                                                    | 상태 다시 조회                                         |
| 후보 조회 | 403 `FORBIDDEN`                                                                                                | 링크 재조회(다른 약속 세션)                            |
| 공통      | `UNAUTHENTICATED`·`PROMISE_CANCELLED`·`PROMISE_NOT_FOUND`·`INVALID_REQUEST`·`PROMISE_NOT_OPEN`·`DRAFT_EXPIRED` | 링크 재조회                                            |
| 공통      | `INVALID_ORIGIN`·5xx·네트워크·알 수 없는 코드                                                                  | 화면 유지, 다시 시도 안내                              |

## 수용 기준

- [x] AC-1: collecting에서 현재 방장(role host + canManagePromise + active)에게만 마감 버튼, 확인 1회, 요청 중 비활성
- [x] AC-2: 방장이 마감하면 방장 화면은 바로, 다른 참여자 화면은 다음 상태 조회에서 후보 화면
- [x] AC-3: 후보 상위 5개 + 공통 가능 인원, 더 보기로 다음 페이지, 겹치는 후보는 각각. 방장만 확정 버튼, 그 외 안내 문구, 후보 없음 안내
- [x] AC-4: 방장이 가능하다고 하지 않은 후보를 확정할 때 방장 불참 안내(RESULT-04-02)
- [x] AC-5: 확정 422 → 안내 + 후보 재조회, 409 → 상태 재조회로 결과 화면, 응답 유실 재시도도 결과 화면
- [x] AC-6: 결과 화면 — 확정 일정(한국 시간, 24:00 표기), 공통 가능 인원, 초대 링크 복사(실패 시 직접 복사 안내), 방장에게만 `hostActionRequired` 경고
- [x] AC-7: closed·confirmed에서 모두의 시간 읽기 전용, 머리글 "응답 마감됨"
- [x] AC-8: 상태 조회 5초 폴링, 탭 숨김 중지·복귀 즉시, 실패 시 마지막 값 유지
- [x] AC-9: 실패 분기 순수 함수 코드별 테스트, test(3개 TZ)·lint·typecheck·build, 브라우저 데스크톱·390px

## 구현

- 순수 로직 `lib/result/`: `view.ts`(화면 선택), `failure.ts`(실패 분기), `format.ts`(한국 시간 범위 표기·후보 페이지 합치기·방장 참석 판정·초대 링크), `poll-delay.ts`(폴링 간격 보정)
- 화면 `components/result/`: `promise-room.tsx`(상태 조회 폴링·화면 전환), `close-voting-bar.tsx`, `candidates-panel.tsx`, `result-panel.tsx`, `api-types.ts`
- 연결: `arrived-card.tsx`가 `PromiseRoom`을 그린다(`inviteToken` 전달). `availability-board.tsx` 머리글·`initialTab`

## 결과

AC-1~9 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.
