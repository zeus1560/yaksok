# 내 참여 정보 조회 API (MEMBER-API-05)와 방장 복원 전환

## 식별자와 상태

- 스펙 ID: `010-me-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-04-02(다른 기기 접속), MEMBER-06-03(인증 유지), STATE-01-01, STATE-02-02(10분 설정), STATE-06-01·06-02(마감 후 입력·탈퇴), STATE-10-01(취소 권한), MEMBER-12-01·12-03(방장 탈퇴 승계), TIME-15-01·15-04(마감 경계·상태 변경 지연)
- ERD: DATABASE.md 3.3(`participants.availability_submitted_at`), 3.5(세션 매 요청 재확인)
- API: MEMBER-API-05 (`docs/specs/api/member.md`), MEMBER-API-01 「화면 분기」 표, API_CONVENTIONS 3·5절
- 관련 미결·충돌: C-06(탈퇴 세션 처리 — 삭제 vs `expires_at` 갱신, 어느 쪽이든 401), C-07(cancelled 참여자 401 안, 팀 확인 대기). 이번 결정은 R-17

## 사용자와 문제

방장 복원이 브라우저 저장소에만 의존해, 다른 기기나 저장소를 지운 방장도 대기 화면을 본다. 세션 쿠키는 이미 있으므로 서버에 "지금 보는 사람이 누구인지" 물어 화면을 정한다. 이후 참여 경로(PR 2)와 방장 관리 기능도 이 API를 기준으로 쓴다.

## 목표와 범위

- 이번에 구현할 동작:
  - `GET /api/v1/promises/{promiseId}/me` — 세션 쿠키 필수, 잠금 없음, Origin 검사 없음, 허용 상태 전체(cancelled 포함)
  - `deadlinePassed`·`permissions` 산정 순수 함수와 조합 테스트(마감 경계 포함)
  - `/p/[inviteToken]`: 링크 조회 결과에 `promiseId`가 있으면 `/me`로 화면 결정. draft + host → 설정, 그 외 draft → 대기, `/me` 실패 → `nextAction`대로
  - 브라우저 저장소는 카운트다운 기준값으로만 사용. 기준값이 없는 draft 방장은 카운트다운 대신 "등록 후 10분 안에 설정을 마쳐야 합니다"
- 이번에 구현하지 않을 동작: collecting 이후 화면(임시 참여 화면 유지), 탈퇴 API, 대기 화면의 "방장이신가요? 로그인"(PR 2), API 명세 변경(남은 시간 필드 추가 등)

## 선행 작업

- 009 — `/p/[inviteToken]` 분기·설정 화면·저장소 카운트다운
- 004·005 — 세션 발급과 `session-auth.ts`

## 사용자 흐름

1. 링크 진입 → 링크 조회(MEMBER-API-01). `promiseId`가 없으면 방장 등록 화면
2. `promiseId`가 있으면 `/me` 호출
   - 200 + `promiseStatus=draft` + `role=host` → 설정 화면. 이 기기 저장소에 같은 약속의 유효한 기준값이 있으면 카운트다운, 없으면 10분 안내
   - 그 외(200 member, 401·403·404·5xx·네트워크) → `nextAction`대로(대기·임시 참여)
3. 대기 화면 폴링도 같은 결정(링크 조회 + `/me`)을 반복한다
4. 설정 중 만료는 서버 410 `DRAFT_EXPIRED`가 판정한다(009와 같음)

## 수용 기준

- [x] AC-1 (MEMBER-API-05): 200 본문 9개 필드, `availabilitySubmittedAt`은 `participants.availability_submitted_at`(null = 미제출, 밀리초 `+09:00`), `sessionExpiresAt` 초 단위 `+09:00`, 쿠키 갱신, no-store
- [x] AC-2 (STATE-06-02, STATE-10-01, STATE-06-01): permissions 산정 — 상태 5종 × 마감 경과 × 역할, cancelled 참여자는 모두 false, `canSubmit = canEditAvailability`
- [x] AC-3 (TIME-15-01·04): `deadlinePassed`는 판정 시각 ≥ 마감이면 true(정확히 마감 시각 포함), collecting이어도 true 가능, 마감 없는 draft는 false
- [x] AC-4 (MEMBER-API-05 허용 상태): 취소된 약속도 유효한 세션이면 200 `promiseStatus=cancelled`, 권한 모두 false
- [x] AC-5 (MEMBER-API-05 에러, API_CONVENTIONS 5절): 400 형식 오류, 404 약속 없음, 401 쿠키 없음·만료·위조·cancelled 참여자, 403 다른 약속 세션, 인증 후 세션 소실·만료는 401 + 쿠키 삭제
- [x] AC-6 (ERD 3.5): 세션·참여자·약속을 매 요청 한 문장으로 다시 읽고 `participants.promise_id`를 경로와 대조
- [x] AC-7 (MEMBER-API-01 화면 분기): draft + `/me` host → 설정, 다른 브라우저 → 대기, 401·403 → `nextAction`
- [x] AC-8 (STATE-02-02, R-17): 저장소는 방장 판단에 쓰지 않음. 기준값 없는 방장은 카운트다운 숨김 + 10분 안내
- [x] AC-9: 완료 화면 새로고침 시 `/me`가 `role=host`로 응답(화면은 임시 참여 화면 유지)

## 데이터와 인터페이스

- 스키마 변경 없음. `availabilitySubmittedAt` ↔ `participants.availability_submitted_at`(`Timestamptz(3)`, nullable)
- Route Handler 계약은 MEMBER-API-05 그대로. 응답 시각 표기만 R-17에 기록
- `authenticatePromiseSession(request, promiseId, { allowCancelled })` 옵션 추가 — 기본값은 기존 동작

## 구현 계획

- `lib/member/me-permissions.ts`(+ 테스트): `isDeadlinePassed`, `computeMePermissions`
- `lib/member/me.ts`(+ 테스트): 세션 id로 세션·참여자·약속·`clock_timestamp()`를 한 문장으로 재조회
- `app/api/v1/promises/[promiseId]/me/route.ts`(+ 테스트)
- `lib/member/session-auth.ts`(+ 테스트): `allowCancelled` 옵션
- `lib/create-promise/invite-view.ts`(+ 테스트): `decideInviteView`, `setupCountdownBase`
- `components/create-promise/{invite-flow,setup-form,api}.ts(x)`: `/me` 기반 분기, 카운트다운 숨김

## 검증 계획

- Vitest: 위 단위·라우트 테스트
- lint·typecheck·test·build(dev 서버 종료 후)
- 브라우저: 다른 브라우저 → 대기 / 같은 브라우저 저장소 삭제 후 새로고침 → 설정 + 카운트다운 숨김 / 완료 후 새로고침 → `/me` role=host / 다른 약속 쿠키로 `/me` → 403 또는 401
- 확인용 데이터 삭제, 스냅샷 시작 상태와 동일, dev 서버 종료

## 미정 사항

- C-07(cancelled 참여자 401) 팀 확인 대기 — 이 API도 401로 따른다. 그래서 명세의 `status=cancelled` 응답은 실제로 나오지 않는다(R-17)
- 만료된 draft를 `/me`로 직접 부르면 410이 아니라 200 `promiseStatus=draft`다(명세에 410 없음). 화면은 링크 조회가 unclaimed로 계산하므로 `/me`를 부르지 않는다

## 결과

AC-1~9 충족. PR #15로 `main`에 병합(2026-11-06). 검증 근거는 `context/current-feature.md` 완료 이력의 2026-11-06 「내 참여 정보 조회 API」 항목에 있다.
