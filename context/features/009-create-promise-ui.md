# 약속 만들기 화면 (홈 → 방장 등록 → 설정 → 완료)

## 식별자와 상태

- 스펙 ID: `009-create-promise-ui`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-02-01, MEMBER-05-01, MEMBER-06-01, MEMBER-03-02, STATE-02-02, STATE-03-01, TIME-05-02, TIME-06-01, TIME-06-02, TIME-13-02(이번에 확정 기록)
- API: MEMBER-API-09·01·02 (`docs/specs/api/member.md`), STATE-API-02 (`docs/specs/api/state.md`), API_CONVENTIONS 3·5절
- 관련 결정: DECISION_CONFLICTS R-07(날짜 상한), R-10(닉네임), R-12(시작일 하한·만료 draft 410), C-04(마감 기본값) → 이번에 R-15(화면 결정)·R-16(TIME-13-02 확정, 종료일 오늘 빈틈) 기록
- 디자인: Figma `5nUJ1W46y1De0djgsxjQ9G` 35:76·35:278·35:379·35:399·35:2666 (규칙 확정 전 자료 — 동작은 요청서·명세 우선)

## 사용자와 문제

웹에서 약속을 처음 만드는 방장이 링크 발급 → 방장 등록 → 필수 설정을 10분 안에 끝내고 초대 링크를 복사해 채팅방에 공유해야 한다. 같은 링크를 먼저 연 다른 사람은 설정이 끝날 때까지 기다린다.

## 목표와 범위

- 구현: 홈(`app/page.tsx`), `/p/[inviteToken]` 분기, 방장 등록·설정·완료·대기·잘못된/만료 링크·임시 참여 화면, 화면용 순수 로직(`lib/create-promise/`)과 Vitest, 결정 기록
- 제외: 참여자 등록·로그인(PR 2), 시간 입력 그리드(PR 3), 약속 이름, 카카오 공유, API·DB 변경

## 선행 작업

001(링크 발급)·002(링크 조회)·003(방장 등록)·005(설정 완료) API — 모두 `main`에 있음.

## 사용자 흐름

1. 홈 → "새 약속 만들기" → `POST /api/v1/links`(요청 중 "만드는 중…", 실패 시 "잠시 후 다시 시도해 주세요") → `/p/{token}`
2. `/p/{token}`: 저장소에 이 토큰의 설정 진행 정보가 있고 로컬 시한이 남았으면 설정 화면. 아니면 `GET /api/v1/links/{token}`
   - `register_host` → 방장 등록 / `wait_setup` → 대기(pollAfterMs 간격 재조회) / 404·410 → 안내 / 그 밖 → 임시 참여 화면
3. 방장 등록 → 201이면 `{promiseId, 로컬 만료 = 기기 시각 + 10분}` 저장 → 설정. 422 → 입력란 오류, 409 → 재조회(대기)
4. 설정 → `POST /api/v1/promises/{id}/start` → 200 완료 화면(저장소 삭제). 422 → 입력란 오류, 410 → 안내 + 저장소 삭제 + 링크 재조회(방장 등록)
5. 완료 → 초대 링크 복사(토스트), "내 가능 시간 입력하기"는 비활성 "곧 열려요"

## 수용 기준

- [ ] AC-1 (MEMBER-API-09): 홈 버튼 요청 중 비활성·"만드는 중…", 성공 시 `/p/{token}` 이동, 실패 시 안내
- [ ] AC-2 (MEMBER-API-01, MEMBER-03-02): 링크 조회 결과로 등록·대기(폴링)·404·410·임시 참여 화면 분기, 저장소 복원 우선
- [ ] AC-3 (MEMBER-API-02, MEMBER-05-01, MEMBER-06-01): 방장 등록 화면 검증, 422 `details.field` 표시, 409 → 대기
- [ ] AC-4 (R-07, R-12, STATE-API-02): 날짜 선택 — 오늘 이전·상한 초과 불가, 종료일 내일부터, 오늘만 고르면 안내
- [ ] AC-5 (TIME-05-02, TIME-06-01): 하루 시간 30분 단위 드롭다운, 기본 09:00~24:00, 종료 목록은 시작보다 늦은 시각만
- [ ] AC-6 (TIME-06-02): 소요 시간 −/+ 30분, 기본 2시간, 범위 축소 시 자동 감소 + 안내
- [ ] AC-7 (C-02, STATE-API-02): 정원 2~30, −/+와 직접 입력
- [ ] AC-8 (TIME-13-02): 마감 기본값 시작일 전날 23:59 → 지났으면 종료일 전날 23:59, 직접 수정 후 유지, `+09:00`으로 전송
- [ ] AC-9 (STATE-02-02): 경과 시간 기준 카운트다운·1분 강조·새로고침 복원, 0이 되어도 화면이 막지 않음
- [ ] AC-10 (STATE-API-02): 422 입력란 표시, 410 안내·저장소 삭제·링크 화면 복귀
- [ ] AC-11: 완료 화면 요약·배지·링크 복사 토스트·비활성 입력 버튼
- [ ] AC-12: 모바일 한 열 / 넓은 화면 두 열, PIN·세션 로그 없음, 같은 출처 fetch

## 구현 계획

- `lib/create-promise/` 순수 로직: `date-range.ts`, `deadline.ts`, `time-options.ts`, `countdown.ts`, `setup-storage.ts`, `format.ts` (+ 테스트)
- `components/create-promise/` 클라이언트 컴포넌트, `components/common/` 헤더·카드
- `app/page.tsx`, `app/p/[inviteToken]/page.tsx`, `app/layout.tsx`(lang·메타데이터), `app/globals.css`(Figma 토큰)

## 검증 계획

- Vitest: 날짜 선택 가능 여부·상한 말일 보정, 마감 기본값, 소요 시간 보정, 시간 목록, 카운트다운, 저장소 파싱, 설정 완료 실패 분기(에러 코드별)
- lint·typecheck·test·build(dev 서버 종료 후)
- 브라우저 확인 목록은 `context/current-feature.md`에 기록

## 화면 분기 위치

`/p/[inviteToken]` 분기는 클라이언트 컴포넌트가 링크 조회 API(MEMBER-API-01)를 호출해 정한다. 저장소 복원과 대기 화면 폴링이 브라우저에서만 가능하기 때문이다. "서버 컴포넌트는 `lib/`를 직접 호출한다"(`context/coding-standards.md`)는 일반 규칙의 예외다.

## 설정 완료 실패 분기

상태 코드가 아니라 에러 코드로 분기한다(`lib/create-promise/start-failure.ts`).

- 저장소 삭제 + 링크 재조회: `DRAFT_EXPIRED`(만료 안내), `UNAUTHENTICATED`·`FORBIDDEN`·`PROMISE_NOT_FOUND`·`PROMISE_CANCELLED`·`INVALID_PROMISE_STATE`(방장 세션이 없거나 더 이상 설정할 수 없음)
- 저장소 유지: `VALIDATION_FAILED`(해당 입력란), `INVALID_REQUEST`(입력 확인 안내), `INVALID_ORIGIN`·`INTERNAL_ERROR`·네트워크 오류·알 수 없는 코드(다시 시도 안내)

## 다음 PR로 넘기는 항목

- **방장 등록 응답 유실 409 복구 (PR 2):** draft 대기 화면에 "방장이신가요? 로그인" 진입점을 두고, 로그인(MEMBER-API-04) 결과 역할이 host이면 설정 화면으로 보낸다. 응답이 유실된 방장과 경쟁에서 진 사람을 화면에서 구분할 수 없으므로 409 전용 분기 화면은 만들지 않는다. 링크 조회 draft 응답의 `promiseId`로 로그인 경로를 고른다.

## 미정 사항

- MEMBER-API-05(`/me`) 미구현 → 방장 복원은 브라우저 저장소로만 한다(다른 기기·저장소 삭제 시 방장도 대기 화면)

## 결과

`context/current-feature.md` 검증 결과 참고.
