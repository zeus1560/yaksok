# 참여 경로 화면 (참여자 등록·로그인·도착)

## 식별자와 상태

- 스펙 ID: `011-participate-ui`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-03-01·03-02(설정 중 화면), MEMBER-04-01·04-02(닉네임+PIN 인증, 다른 기기), MEMBER-05-01·05-05·05-06(닉네임 길이·중복·탈퇴 닉네임), MEMBER-06-01(PIN 형식), MEMBER-06-03(쿠키 유지), MEMBER-07-02(정원), MEMBER-08-01(비참여자 비공개), MEMBER-11-01·11-02(재참여 불가)
- API: MEMBER-API-03·04·05·01 (`docs/specs/api/member.md`), API_CONVENTIONS 6절(NICKNAME_TAKEN 뒤 로그인으로 판별)·7절(INVALID_CREDENTIALS 비구분)
- 관련 미결·충돌: MEMBER-06-02(PIN 분실, ❗미결 — 화면 없음), MEMBER-06-04(PIN 시도 제한, ❗미결 — 구현하지 않음), C-07(cancelled 참여자 코드). 이번 결정은 R-18

## 사용자와 문제

방장이 공유한 링크를 연 사람이 닉네임·PIN으로 참여하거나, 다른 기기에서 다시 로그인해야 한다. 등록 응답을 못 받은 사람과 방장 등록 응답을 못 받은 방장도 같은 값으로 복구할 수 있어야 한다.

## 목표와 범위

- 이번에 구현할 동작:
  - 세션 없는 collecting(`nextAction=join`) → 참여자 등록 화면, "이미 참여하셨나요? 로그인"으로 전환
  - 등록 409 `NICKNAME_TAKEN` → 같은 값으로 로그인 1회 판별(200 복구 / 401 안내 + 닉네임을 채운 로그인 전환)
  - draft 대기 화면의 "방장이신가요? 로그인"(009에서 넘긴 409 복구)
  - 등록·로그인 성공 → 링크 조회 + `/me`로 다음 화면. 도착 화면은 `/me`만으로 닉네임·방장 표시, 시간 입력 자리
  - 세션 없는 closed·confirmed → 마감 안내 + 로그인, cancelled → 취소 안내
  - 정원 초과·마감 경과·참여 기간 만료·참여 종료 안내
  - 실패 분기 순수 함수(에러 코드 기준)와 코드별 테스트
- 이번에 구현하지 않을 동작: 가능 시간 입력(PR 3), 결과 화면, PIN 분실·시도 제한, API·DB 변경

## 선행 작업

- 010 — `/me` 기반 화면 결정, 009 — 대기·설정·완료 화면
- 004·006 — 로그인·참여자 등록 API

## 사용자 흐름

1. 링크 진입 → 링크 조회 → `promiseId`가 있으면 `/me`
2. `/me` 200: draft면 방장은 설정, 그 외 대기 / cancelled면 취소 안내 / 나머지는 도착 화면
3. `/me` 실패: `join` → 등록 화면, `view_result` → 마감 안내 + 로그인, `wait_setup` → 대기(+ 방장 로그인), `cancelled` → 취소 안내
4. 등록·로그인 성공 → 1번부터 다시(세션 쿠키가 생겼으므로 `/me` 200)
5. 실패는 `lib/participate/failure.ts`가 입력란·폼 오류·재조회·안내 화면으로 나눈다

## 수용 기준

- [x] AC-1 (MEMBER-API-03, MEMBER-08-01): 세션 없는 collecting은 등록 화면. 등록 전 약속 설정 값을 보이지 않고 다른 API를 부르지 않는다. 201 → 도착 화면
- [x] AC-2 (MEMBER-04-02, MEMBER-API-04): 등록 화면에서 로그인으로 전환, 다른 기기 로그인 → 도착 화면. 401은 닉네임·PIN을 구분하지 않는 문구
- [x] AC-3 (API_CONVENTIONS 6절): `NICKNAME_TAKEN` → 같은 값 로그인 1회. 200 → 도착(응답 유실 복구), 401 → 중복 안내 + 닉네임을 채우고 PIN을 비운 로그인 화면
- [x] AC-4 (MEMBER-03-02, 009 이월): 대기 화면 "방장이신가요? 로그인" → host·draft면 설정 화면(카운트다운은 010 규칙), 그 외는 재조회 결과
- [x] AC-5 (MEMBER-API-05): 도착 화면은 `/me` 닉네임과 방장 표시, 시간 입력 자리. 방장이 완료 화면을 새로고침해도 도착 화면
- [x] AC-6 (MEMBER-07-02, STATE-06-02, MEMBER-11-01): 정원 초과·마감 경과·참여 기간 만료·참여 종료·취소·마감 상태 안내. 마감 경과·마감 상태는 기존 참여자 로그인 진입점
- [x] AC-7: 실패 분기는 에러 코드 기준 순수 함수, 코드별 테스트
- [x] AC-8 (MEMBER-06-01): PIN은 저장소·콘솔·URL에 없음, `inputMode=numeric`·`autocomplete=off`, 요청 중 버튼 비활성, 시도 제한 없음
- [x] AC-9: 390px 한 열, 가로 스크롤 없음

## 데이터와 인터페이스

- API·DB 변경 없음. 등록·로그인·`/me`·링크 조회 명세 그대로 사용

## 구현 계획

- `lib/participate/failure.ts`(+ 테스트): `classifyRegisterFailure`, `classifyLoginFailure`, `resolveNicknameTaken`, 안내 문구
- `lib/create-promise/invite-view.ts`(+ 테스트): 화면 종류 `join`·`arrived`·`closed`·`cancelled` 추가, 세션 있으면 `/me` 상태 우선
- `components/participate/participant-auth-card.tsx`: 등록·로그인 카드(중복 판별 포함)
- `components/participate/arrived-card.tsx`: 도착 화면
- `components/create-promise/invite-flow.tsx`: 화면 연결, 대기 화면 방장 로그인, 마감 안내 + 로그인

## 검증 계획

- Vitest: 실패 분기 코드별, 화면 결정 조합
- lint·typecheck·test·build(dev 서버 종료 후)
- 브라우저: 새 등록 → 도착 / 같은 닉네임 다른 PIN → 중복 안내 → 로그인 전환 / 응답 유실(등록 응답·쿠키 차단) → 자동 로그인 1회로 도착 / 다른 기기 로그인 / 대기 화면 방장 로그인 → 설정 / 정원 초과·마감 경과(DB) / 방장 새로고침 → 방장 표시 / 390px / PIN 노출 없음

## 미정 사항

- PIN 분실(MEMBER-06-02) ❗미결 — 화면에 "PIN 찾기"를 두지 않는다
- PIN 시도 제한(MEMBER-06-04) ❗미결 — 공개 배포 전 팀 안건
- C-07 — cancelled 참여자의 로그인은 403 `PARTICIPANT_CANCELLED`(안내 화면), 세션 API는 401

## 결과

`context/current-feature.md` 검증 결과 참고.
