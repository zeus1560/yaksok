# 공통 상태 가드 점검과 정리 (STATE-API-09)

## 식별자와 상태

- 스펙 ID: `026-common-guard-cleanup`
- 상태: 검토 중

## 근거

- 비즈니스 규칙: STATE-10-01(취소된 약속), STATE-06-01·06-02(마감 뒤 처리), MEMBER-02-01(방장 선점)
- ERD: DATABASE.md 3.5(세션 행 삭제·만료), 8절(잠금 순서·잠금 후 재확인), 11절
- API: STATE-API-09 「적용 작업과 허용 조건」·「공통 처리 계약」(`docs/specs/api/state.md`), STATE-API-02, MEMBER-API-02 (`docs/specs/api/member.md`), API_CONVENTIONS 4·5절
- 관련 미결·충돌: R-22(02만 403), R-25(취소 규칙), R-30(마감 경과 closed 저장 차이), R-31(로그아웃과 겹친 설정 완료), C-07, C-12, R-17, X-10. 이번 결정은 R-32

## 사용자와 문제

API마다 취소 판정·잠금 후 재확인·마감 경과 처리를 따로 구현해 와서 공통 계약과 어긋난 곳이 있다. 설정 완료는 로그아웃과 겹치면 지운 세션 토큰으로 쿠키를 다시 심고, 취소된 링크에 방장 등록을 하면 "이미 선점"으로 안내된다. 어긋난 곳이 어디인지 한눈에 볼 표가 없다.

## 목표와 범위

- 이번에 할 일: 구현된 API 20개(MEMBER 01~09, STATE 01~08·10, TIME 01·02)의 공통 가드 점검표 `docs/development/GUARD_MATRIX.md`, STATE-API-02 잠금 후 세션·참여자 재확인(401 정렬), MEMBER-API-02 취소된 링크 409 `PROMISE_CANCELLED`, 검토 뒤 추가 지시로 TIME-API-01 재확인 순서(N-2)
- 이번에 하지 않을 일: 새 API, DB 스키마, 화면, R-30(마감 경과 closed 저장)·C-07·C-12 변경, N-2를 뺀 새 차이(N-1·N-3·N-4·N-5) 수정

## 선행 작업

005(설정 완료), 003(방장 등록), 019(취소 규칙 R-25), 025(로그아웃 — 세션 행 삭제, R-31)

## 사용자 흐름

1. 방장이 설정 완료를 누르는 사이 같은 쿠키로 로그아웃이 처리됨 → 설정 완료는 401과 쿠키 삭제, 설정은 저장되지 않음 → 다시 로그인하면 이어서 설정
2. 취소된 약속의 링크로 방장 등록을 시도 → 409 `PROMISE_CANCELLED` → 화면은 링크를 다시 조회해 취소 안내(화면 변경 없음, 409로 분기)
3. 참여자가 제출을 누르는 사이 로그아웃·탈퇴·내보내기가 처리되고 마감이 지남 → 제출은 401과 쿠키 삭제, closed는 저장되지 않음(다음 GET·쓰기가 closed로 판정)

## 수용 기준

- [x] AC-1 (STATE-API-09 3절): 점검표 — API별 취소 판정 위치·Origin 위치·잠금 대상과 순서·잠금 후 재확인·마감 경과 처리·허용 상태·잠금 후 비활성 참여자 응답·쿠키·no-store를 코드로 채우고 명세와 다른 칸을 표시
- [x] AC-2 (R-31·R-22): 설정 완료는 잠금 후 세션 행을 다시 읽는다. 행 없음 → 401·쿠키 Max-Age=0(지운 토큰을 다시 심지 않음), 만료·참여자 cancelled·소속 불일치 → 401, 최신 role이 host가 아니면 403. 저장 없음
- [x] AC-3 (R-25, 공통 처리 1): 취소된 링크에 방장 등록 → 409 `PROMISE_CANCELLED`, DB 변경 없음, 쿠키 없음. 링크 만료 410·본문 400·422·Origin 403은 먼저
- [x] AC-4 (R-30·C-07·C-12·R-17·R-31): 고치지 않을 차이를 점검표에 기록(마감 경과 closed 저장 API별 분류와 GET 계산 때문에 사용자 결과가 같다는 점 포함)
- [x] AC-5: 점검 중 새로 발견한 차이는 표시·보고(N-1~N-5). N-2만 사용자 지시로 고침
- [x] AC-6: 기존 기대값 변경은 AC-2·AC-3·AC-7 때문인 것만
- [x] AC-7 (공통 처리 4, R-31, N-2): 제출은 잠금 후 취소 판정 바로 뒤 세션·참여자를 재확인한다. 세션이 무효하면 상태·마감과 관계없이 401, 행이 없으면 쿠키 Max-Age=0, 마감이 지났어도 closed 저장 없음. 세션이 유효하면 기존 응답 그대로

## 데이터와 인터페이스

- DB 변경 없음
- STATE-API-02: 잠금 후 401 `UNAUTHENTICATED` 추가(이전 403 경로 대체)
- MEMBER-API-02: 409 `PROMISE_CANCELLED` 추가
- TIME-API-01: 잠금 후 재확인을 상태·마감 판정보다 먼저(세션 무효면 어느 상태든 401)

## 구현 계획

1. 점검표 작성(코드 읽기)
2. RED: `start-collecting.test.ts` 재확인 5건·`start/route.test.ts` 401 1건, `host-registration.test.ts` 취소 2건·`host/route.test.ts` 1건
3. GREEN: `lib/state/start-collecting.ts` 재확인(close-voting.ts와 같은 조건), `start/route.ts` 401 분기, `lib/member/host-registration.ts` `cancelled`, `host/route.ts` 409 분기
4. REFACTOR: 쓰지 않는 `participant.findUnique` 모의 제거, 기존 테스트 정리
5. N-2(검토 뒤 추가): `submit-availability.test.ts` RED 8건 → `lib/time/submit-availability.ts` 재확인을 취소 판정 바로 뒤로 이동 → 기존 테스트의 「재조회하지 않음」 단언 정리
6. 문서: GUARD_MATRIX.md, time.md TIME-API-01 처리 순서 5, state.md STATE-API-02 처리 순서·쿠키, member.md MEMBER-API-02 에러 표·처리 순서, DECISION_CONFLICTS R-32 신설·R-22·R-31 후속 표시

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`, lint·typecheck·build
- 개발 DB 실제 호출(`scripts/verify/026-common-guard.mjs`, Git 제외): 링크 행을 다른 연결로 잠가 설정 완료를 잠금 대기시킨 뒤 로그아웃·세션 만료를 끼워 넣기, 취소된 링크(draft·collecting) 방장 등록, 약속 행을 잠가 제출을 잠금 대기시킨 뒤 로그아웃·세션 만료를 끼워 넣기(마감 지남·조기 마감·마감 전). 남은 `scripts/verify/025-logout.mjs` 회귀. 확인용 데이터 삭제·스냅샷 비교

## 미정 사항

- 결정(사용자 지시): 위 두 수정과 N-2, R-30·C-07·C-12·N-1·N-3·N-4·N-5는 기록만
- 이번 구현 판단: 취소된 링크라도 링크 만료면 410이 먼저(링크 조회와 같은 판정 함수·순서). 잠금 후 cancelled 409 분기의 쿠키는 다른 API와 같이 인증 시점 만료값(N-4)
- 팀 확인 필요: R-30, C-07, C-12, N-1·N-3·N-4·N-5

## 결과

AC-1~7 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: `lib/state/start-collecting.ts`, `app/api/v1/promises/[promiseId]/start/route.ts`, `lib/member/host-registration.ts`, `app/api/v1/links/[inviteToken]/host/route.ts`, `lib/time/submit-availability.ts`
- 테스트: 새 테스트 9건(설정 완료 lib 5·route 1, 방장 등록 lib 2·route 1). 기존 기대값 변경 1건(설정 완료 잠금 후 host·cancelled: forbidden → unauthenticated), 방장 등록 `it.each`에서 `cancelled` 케이스를 빼 새 테스트로 옮김(기대값 already_registered → cancelled). 그 밖에 모의 데이터만 바꾼 기존 테스트 3건. N-2: 새 테스트 8건(`submit-availability.test.ts`), 기존 단언 변경 2곳(「마감 경과 → closed 저장」과 상태별 거절 `it.each` 4개 케이스의 「세션 재조회를 하지 않는다」 → 「재확인을 먼저 한다」, 결과 값은 그대로)
