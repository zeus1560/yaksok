# 참여자 화면 마무리 (화면 PR 5b)

## 식별자와 상태

- 스펙 ID: `028-participant-finish-ui`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: STATE-06-01(탈퇴 가능 상태), MEMBER-10-03(탈퇴자 데이터 보존), MEMBER-11-01(탈퇴자 재참여 불가), MEMBER-12-01·03·04(방장 탈퇴·자동 승계·후임 없으면 취소), MEMBER-04-02(로그아웃 뒤 재로그인), TIME-10-02·10-04(로컬 임시 입력), STATE-09-03(범위 변경 시 범위 밖 입력 정리)
- API: STATE-API-08 (`docs/specs/api/state.md`), MEMBER-API-05·06·07 (`docs/specs/api/member.md`), STATE-API-01, TIME-API-02
- 관련 결정: R-28(탈퇴), R-29(명단 순서), R-31(로그아웃), R-33(방장 관리 화면), C-07·C-12(탈퇴 뒤 401). 이번 화면 결정은 R-34

## 사용자와 문제

- 참여자는 약속에서 나가거나(탈퇴) 공용 기기에서 로그아웃할 화면이 없다. API(022·025)만 있다.
- 방장이 나가 자동 승계된 사람의 열린 화면에는 새로고침 전까지 방장 메뉴가 나타나지 않는다(022에서 발견).
- 설정 변경으로 범위가 줄어도 버전이 그대로인 참여자의 제출 전 입력에 범위 밖 칸이 남아 "선택 N칸"이 화면보다 많이 센다(021에서 발견).
- `lib/result/view.ts`의 `canClose`는 027에서 마감 버튼을 방장 메뉴로 옮긴 뒤 쓰지 않는다.

## 목표와 범위

- 이번에 할 일:
  1. 약속 나가기(STATE-API-08): 참여 뒤 화면의 모든 참여자, draft 설정 화면의 방장. 확인 창 1회, 상황별 문구
  2. 로그아웃(MEMBER-API-07): "이 기기에서 로그아웃"(확인 없음), "모든 기기에서 로그아웃"(`allDevices=true`, 확인 1회)
  3. 나가기·로그아웃 성공 뒤 이 약속의 브라우저 저장값(제출 전 입력, 카운트다운 기준값)을 지우고 링크 재조회
  4. 폴링으로 받은 새 설정 기준으로 제출 전 입력의 범위 밖 칸을 지우고 저장소에도 반영
  5. 후임 방장 화면에 방장 메뉴가 새로고침 없이 나타남
  6. `canClose` 정리
- 이번에 하지 않을 일: API·DB 변경, 탈퇴자 재참여 허용, 방장 위임 기능

## 사용자 흐름

- 나가기: "약속 나가기" → 확인 창(문구는 아래) → 요청 중 버튼 막음 → 200 → 저장값 삭제 → 링크 재조회(일반 참여자: 참여 화면 + "약속에서 나갔어요" 안내, 혼자인 방장: 취소 안내, draft 방장: 방장 등록 화면 + "만들던 약속을 삭제했어요")
- 확인 문구:
  - 일반 참여자: "약속에서 나가면 다시 참여할 수 없어요"(MEMBER-11-01)
  - 방장 + 다른 참여자: 명단(MEMBER-API-06) 등록순에서 본인을 뺀 첫 사람으로 "OOO님이 방장이 돼요"
  - 방장 혼자: "약속이 취소돼요"
  - draft 방장: "만들던 약속이 삭제돼요"
  - 방장 문구는 확인 창을 열 때 명단을 새로 조회해 정한다. 조회 실패면 마지막 명단, 그것도 없으면 일반 방장 문구("다음 참여자가 방장이 되고, 혼자라면 약속이 취소돼요")
- 로그아웃: 이 기기 → 바로 요청, 모든 기기 → 확인 창 → 204 → 저장값 삭제 → 링크 재조회(로그인 화면 + "로그아웃했어요. 닉네임과 PIN으로 다시 로그인할 수 있어요")
- 저장값: `yaksok:availability:{promiseId}:*`(이 브라우저에 남은 이 약속의 모든 제출 전 입력)와 `yaksok:setup:{inviteToken}`

## 실패 처리 (에러 코드 기준 순수 함수 `lib/leave/failure.ts`)

| 요청     | 코드                                                                             | 처리                                                                         |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 나가기   | 200                                                                              | 완료(저장값 삭제 + 링크 재조회)                                              |
| 나가기   | 401 `UNAUTHENTICATED`                                                            | **완료와 같음** — 응답 유실 뒤 재요청이면 세션이 이미 만료됐다               |
| 나가기   | 409 `PROMISE_CANCELLED`, 404 `PROMISE_NOT_FOUND`                                 | **완료와 같음** — 혼자인 방장(약속 취소)·draft 방장(초안 삭제)의 재요청 응답 |
| 나가기   | 403 `FORBIDDEN`, 409 `INVALID_PROMISE_STATE`, `PROMISE_NOT_OPEN`·`DRAFT_EXPIRED` | 링크 재조회(저장값 유지)                                                     |
| 로그아웃 | 204                                                                              | 완료                                                                         |
| 로그아웃 | 401 `UNAUTHENTICATED`(쿠키 없음)                                                 | 완료와 같음 — 이미 로그아웃 상태                                             |
| 로그아웃 | 403 `FORBIDDEN`, 404 `PROMISE_NOT_FOUND`                                         | 링크 재조회                                                                  |
| 공통     | `INVALID_ORIGIN`·400·5xx·네트워크·알 수 없는 코드                                | 화면 유지, 다시 시도 안내                                                    |

## 수용 기준

- [x] AC-1 (STATE-API-08, MEMBER-11-01·12-03·12-04): 모든 참여자와 draft 방장에게 "약속 나가기"가 있고, 확인 창이 상황별 문구(일반·승계 이름·혼자 취소·초안 삭제)를 보여 준다
- [x] AC-2 (STATE-API-08): 성공·401·취소/약속 없음 재요청 응답 모두 저장값 삭제 + 링크 재조회. 나간 뒤 같은 닉네임 재등록·로그인은 거절 안내
- [x] AC-3 (MEMBER-API-07, R-31): 이 기기·모든 기기 로그아웃, 모든 기기는 확인 1회. 204·401 모두 저장값 삭제 + 로그인 화면. 로그아웃 문구는 다시 로그인할 수 있음을, 나가기 문구는 다시 참여할 수 없음을 알린다
- [x] AC-4 (STATE-09-03, TIME-10-04): 새 설정 범위 밖 칸을 제출 전 입력과 저장소에서 지워 "선택 N칸"이 화면과 같다
- [x] AC-5 (MEMBER-12-03): 승계된 참여자의 열린 화면에 다음 폴링 안에 방장 메뉴가 나타난다
- [x] AC-6: `canClose` 제거, 실패 분기·확인 문구·저장값·범위 정리 순수 함수 테스트, test(3개 TZ)·lint·typecheck·build, 브라우저 데스크톱·390px

## 구현 계획

- 순수 로직 `lib/leave/`: `confirm.ts`(나가기 확인 문구), `failure.ts`(나가기·로그아웃 실패 분기), `storage.ts`(지울 저장 키)
- `lib/availability/sync.ts`: `clipDraftToRange`(새 설정 범위 밖 칸 제거, `isSlotInRange` 사용)
- `lib/result/view.ts`: `canClose` 제거, 명단의 내 역할과 `/me` 역할 비교 `roleChanged`
- 화면 `components/leave/leave-panel.tsx`(나가기·로그아웃), `promise-room.tsx`(패널 연결·`/me` 갱신), `availability-board.tsx`(범위 정리), `setup-form.tsx`(draft 방장 나가기), `invite-flow.tsx`(나간 뒤·로그아웃 뒤 저장값 삭제·안내·로그인 모드)

## 검증 계획

- Vitest: `lib/leave/*.test.ts`, `lib/availability/sync.test.ts`, `lib/result/view.test.ts`(TDD 대표 2건 먼저 RED)
- 브라우저: `scripts/verify/028-participant-finish.mjs`(Playwright, 데스크톱 1280px·390px, 시작할 때 주요 화면 미리 컴파일), 027 스크립트 회귀
- 개발 DB 확인용 데이터 삭제, 스냅샷 시작 상태와 동일

## 미정 사항

- 없음(사용자 지시로 범위 확정). 화면 판단은 R-34에 기록

## 결과

AC-1~6 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: 순수 로직 `lib/leave/{confirm,failure,storage}.ts`, `lib/availability/sync.ts`(`settingsRange`·`clipDraftToRange`·`rangeClippedNotice`), `lib/result/view.ts`(`canClose` 제거, `roleChanged`·`PROMOTED_NOTICE`). 화면 `components/leave/leave-panel.tsx`(`LeaveControl`·`SessionPanel`), `promise-room.tsx`(내 참여 영역, 명단 역할 변화 → `/me` 갱신), `availability-board.tsx`(범위 정리 후 버전 비교), `setup-form.tsx`(draft 방장 나가기), `invite-flow.tsx`(저장값 삭제·안내·로그인 모드, 나가기 중 일반 재조회 무시·마지막 재조회만 반영), `arrived-card.tsx`, `create-promise/api.ts`(`storageKeys`)
- 계획과 다른 점: `/me`를 5초 폴링하지 않고 명단의 내 역할 변화로만 다시 부름(R-34, 요청 수 증가 없음). 나가기 재요청의 409 `PROMISE_CANCELLED`·404 `PROMISE_NOT_FOUND`도 완료로 처리
