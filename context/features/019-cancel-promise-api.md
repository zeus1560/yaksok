# 약속 취소 API (STATE-API-07)

## 식별자와 상태

- 스펙 ID: `019-cancel-promise-api`
- 상태: 검토 중
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: STATE-01-02(취소 전 상태 → cancelled), STATE-10-01(현재 active 방장만, 복원 불가, 취소 안내 외 비공개), STATE-02-02(draft 10분 만료)
- ERD: DATABASE.md 4절 `promises.cancelled_at`, `ck_promise_cancelled_at`(status=cancelled ⇔ cancelled_at 있음), 6절 방장 불변식(취소 약속은 active host 불변식 제외·모든 세션 즉시 만료)
- API: STATE-API-00 「취소 상태 오류」·「세션·보존 공통 계약」, STATE-API-07, STATE-API-09 「탈퇴·취소·초안 폐기의 구분」 (`docs/specs/api/state.md`), API_CONVENTIONS 4.1·5.2절
- 관련 미결·충돌: C-07(cancelled 참여자 401), C-12(취소 뒤 `/me` 401 — R-17로 cancelled 약속도 세션을 검사), 이번 결정 R-25, STATE-10-03(취소 복구 ❗미결, X-06 — 10-01이 "복원 불가"로 확정해 이번 구현은 복원 경로를 두지 않음)

## 사용자와 문제

방장이 약속을 더 진행하지 않기로 했을 때 모든 참여자가 더 이상 입력·조회할 수 없게 하되, DB 데이터는 지우지 않고 남긴다. 링크를 연 사람에게는 취소 사실만 알린다.

## 목표와 범위

- 이번에 할 일:
  - `POST /api/v1/promises/{promiseId}/cancel` — 현재 active host, Origin 필수, 본문 없음(읽지 않음), no-store, 인증 후 모든 응답 쿠키 갱신
  - `lib/state/cancel-promise.ts` — `promises` 행 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, 잠금 후 취소·세션·active·host 재확인, `status='cancelled'`·`cancelled_at`을 함께 저장, 같은 트랜잭션에서 이 약속의 세션 일괄 만료
  - `lib/member/session-expiry.ts` `expireAllSessions` — 참여자 상태와 관계없이 이 약속의 아직 유효한 세션 `expires_at`을 판정 시각으로(STATE-API-08 탈퇴도 같은 위치에 둔다)
  - 요청자 응답 쿠키 Max-Age=0
  - 10분 지난 draft는 취소하지 않고 410 `DRAFT_EXPIRED`
- 이번에 하지 않을 일: 화면(취소 버튼·취소 안내 변경), DB 스키마 변경, 탈퇴(STATE-API-08), 취소 복구

## 선행 작업

- 015 — `session-expiry.ts`
- 016·017 — 잠금 후 재확인 패턴(`close-voting.ts`·`confirm-schedule.ts`)
- 002·004·006 — 링크 조회 `nextAction: cancelled`, 로그인·참여자 등록 cancelled 409(이미 구현)

## 사용자 흐름

1. 방장이 취소를 요청한다(화면은 이후 PR)
2. 서버가 약속 행을 잠그고 최신 권한·상태를 확인한다
3. 약속을 cancelled로 저장하고 모든 세션을 만료한다. 200 `{ promiseId, promiseStatus: "cancelled", cancelledAt, message }`, 요청자 쿠키 삭제
4. 이후 같은 API를 포함한 세션 API·로그인·참여자 등록은 세션과 관계없이 409 `PROMISE_CANCELLED`, 링크 조회는 `nextAction: cancelled`

## 수용 기준

- [x] AC-1 (STATE-API-07 처리 순서 2): draft(10분 이내)·collecting(마감 전·후)·closed·confirmed에서 `status=cancelled`, `cancelled_at`=잠금 후 `clock_timestamp()`를 함께 저장하고 200. `cancelledAt`은 초 단위 `+09:00`, `message` "취소된 약속입니다."
- [x] AC-2 (처리 순서 3·4): 설정·참여자 role·status·cancelled_at·닉네임·PIN 해시·슬롯·제출 시각·`availability_version`·`confirmed_start_at`을 바꾸지 않음. 링크 유지
- [x] AC-3 (처리 순서 5): 같은 트랜잭션에서 이 약속의 유효 세션을 참여자 상태와 관계없이(탈퇴자 포함) `expires_at`=취소 시각으로. 행은 삭제하지 않음. 요청자 응답 쿠키 Max-Age=0
- [x] AC-4 (처리 순서 1): Origin 403 → promiseId 400 → 404 → 이미 cancelled 409(세션보다 우선) → 401 → 403(다른 약속) → 잠금 → 취소 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403 → 10분 지난 draft 410
- [x] AC-5 (처리 순서 8): 첫 성공만 200, 재요청 409. 같은 방장 병렬 2건 — 하나만 200
- [x] AC-6 (STATE-API-00·09): 취소 뒤 링크 조회 `cancelled`, 상태 조회·현황·후보·제출·마감·확정·설정 완료·로그인·참여자 등록이 세션과 관계없이 409 `PROMISE_CANCELLED`. 다른 기기 세션도 401이 아니라 409
- [x] AC-7: 취소와 확정·제출 경쟁 — 취소가 먼저 잠그면 확정·제출은 409 `PROMISE_CANCELLED`, 저장 없음
- [x] AC-8: test(3개 TZ)·lint·typecheck·build, 개발 DB 실제 호출

## 데이터와 인터페이스

- DB·스키마 변경 없음. `UPDATE promises SET status = 'cancelled', cancelled_at = $now WHERE id = $id AND status <> 'cancelled'`
- `expireAllSessions(tx, { promiseId, now }) → { sessionIds }`: `UPDATE participant_sessions AS s SET expires_at = $now FROM participants AS p WHERE s.participant_id = p.id AND p.promise_id = $id AND s.expires_at > $now`
- 응답 쿠키는 `withSessionCookie(response, auth, { expiresAt: now, now })` — 기존 헬퍼가 남은 초 0을 계산해 값 비움 + Max-Age=0. 헬퍼 변경 없음

## 구현 계획

1. RED: `cancel-promise.test.ts` 대표 2건 + 현재 상태를 그대로 돌려주는 빈 구현
2. GREEN: 잠금·재확인·저장·세션 만료 구현
3. REFACTOR: 나머지 단위 테스트, `expireAllSessions` 테스트, Route Handler와 `route.test.ts`
4. 문서: state.md STATE-API-07 구현 결정, API_CONVENTIONS 5.2 취소 행, DECISION_CONFLICTS R-25

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`
- lint·typecheck·build(dev 서버 종료 후)
- 개발 DB 실제 호출: 사용자 요청 목록 전부, 확인용 데이터 삭제·스냅샷 비교

## 미정 사항

- 10분 지난 draft: 명세는 허용 상태에 draft만 적고 만료 draft를 따로 정하지 않는다. 취소를 저장하면 링크가 영구히 cancelled가 되어 재사용할 수 없으므로 STATE-API-02와 맞춰 410 `DRAFT_EXPIRED`로 거절한다(사용자 지시, R-25). 삭제는 하지 않는다(링크를 잠그지 않음)
- `/me`(MEMBER-API-05)는 R-17로 cancelled 약속도 세션을 검사하므로 취소 뒤에는 401이다(409 아님). 바꾸지 않고 C-12로 기록, 팀 결정 필요
- 이미 만료된 세션은 원래 만료 시각을 둔다(명세 "모든 세션 행 expires_at=clock_timestamp()"와 다르게 읽음, R-25)

## 결과

AC-1~8 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: `lib/state/cancel-promise.ts`, `lib/member/session-expiry.ts` `expireAllSessions`, `app/api/v1/promises/[promiseId]/cancel/route.ts`
- 문서: state.md STATE-API-07 구현 결정, API_CONVENTIONS 5.2 약속 취소 행, DECISION_CONFLICTS R-25·C-12
