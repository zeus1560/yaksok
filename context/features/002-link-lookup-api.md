# 초대 링크 조회 API (MEMBER-API-01)

## 식별자와 상태

- 스펙 ID: `002-link-lookup-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-01-02(링크 만료), MEMBER-02-01, MEMBER-03-02(설정 중 폴링), STATE-02-01, STATE-02-02(draft 10분 만료, GET은 계산만)
- ERD: DATABASE.md 3절 `promise_links`·`promises`, 11절 "draft 생성 후 10분이 지난 상태에서 GET 조회"
- API: MEMBER-API-01 (`docs/specs/api/member.md`), 공통 규약 3절·4.1·4.2 (`docs/specs/API_CONVENTIONS.md`)
- 관련 미결·충돌: 없음 (A-09는 POST API 대상이라 해당 없음)

## 사용자와 문제

초대 링크(`/p/{inviteToken}`)를 연 사람은 약속 내용 없이 "지금 어떤 단계인지"만 알고 다음 화면(방장 등록·설정 대기·참여·결과·취소)을 골라야 한다. 설정 중 화면은 이 API를 폴링한다.

## 목표와 범위

- 이번에 구현할 동작: `GET /api/v1/links/[inviteToken]`, 순수 판정 함수 `lib/member/link-status.ts`, 조회 서비스 `lib/member/link-lookup.ts`, 토큰 형식 검사, 테스트, 문서 갱신
- 이번에 구현하지 않을 동작: `/p/[inviteToken]` 페이지, MEMBER-API-02(만료 draft 실제 삭제 포함), 다른 API의 `INVALID_ORIGIN` 적용(A-09), 레이트 리밋

## 선행 작업

001-link-issue-api (`lib/api-error.ts`, `lib/member/invite-link.ts` 재사용). 병합 확인: main 93a2036.

## 사용자 흐름

링크 접속 → `GET /api/v1/links/{token}` → 형식 검사 → 링크·약속 조회와 DB 시각(`clock_timestamp()`) 조회 → 판정 → 200 본문 / 404 / 410. 설정 중(draft)이면 `pollAfterMs` 간격으로 재조회.

## 수용 기준

- [ ] AC-1 (MEMBER-API-01): 형식이 다르거나 없는 토큰은 404 `LINK_NOT_FOUND`. 형식 오류는 DB를 조회하지 않는다.
- [ ] AC-2 (MEMBER-01-02): 기준 시각 + 7일 ≤ 판정 시각이면 410 `LINK_EXPIRED`. 기준 시각: 방장 등록 전·마감 없는 draft → 링크 `created_at`, 확정 → `confirmed_start_at`, 그 외 → `voting_deadline_at`(재조율 시 새 마감).
- [ ] AC-3 (STATE-02-02): draft이고 약속 `created_at` + 10분 ≤ 판정 시각이면 200 `unclaimed` / `register_host` / `promiseId=null` / `draftExpired=true`.
- [ ] AC-4 (MEMBER-API-01 화면 분기): unclaimed→register_host, draft→wait_setup(+`pollAfterMs` 3000), collecting→join, closed·confirmed→view_result, cancelled→cancelled. 응답 필드는 명세 6개뿐이다.
- [ ] AC-5 (STATE-02-02, API_CONVENTIONS 4.1): GET은 잠금·쓰기·삭제를 하지 않는다.
- [ ] AC-6 (API_CONVENTIONS 4.2): 판정 시각은 DB 시각이며, 판정 함수는 시각을 주입받는다.
- [ ] AC-7 (API_CONVENTIONS 3절): DB 오류는 500 `INTERNAL_ERROR`, 원문 미노출.

## 데이터와 인터페이스

스키마 변경 없음. 읽기만: `promise_links(invite_token, created_at)`, `promises(id, status, created_at, voting_deadline_at, confirmed_start_at)`. 계약은 MEMBER-API-01 참조.

## 구현 계획

1. `lib/member/invite-link.ts`: `isInviteTokenFormat` 추가
2. `lib/member/link-status.ts`: `linkExpiryBase`, `resolveLinkStatus(link, now)` 순수 함수
3. `lib/member/link-lookup.ts`: 형식 검사 → `findUnique` + `clock_timestamp()` 병렬 조회 → 판정
4. `lib/api-error.ts`: `LINK_NOT_FOUND`, `LINK_EXPIRED` 헬퍼
5. `app/api/v1/links/[inviteToken]/route.ts`: 결과를 상태 코드로 매핑, `Cache-Control: no-store`

## 검증 계획

- Vitest: `link-status.test.ts`(기준 시각 종류별 경계, 만료 draft, 재조율, 겹침 순서), `link-lookup.test.ts`(형식 오류·없는 토큰·DB 시각), `route.test.ts`(상태 코드·헤더·500)
- lint / typecheck / test / build
- 개발 DB 확인용 데이터로 dev 서버 curl, GET 전후 4개 테이블 행 수·내용 해시 비교
- DATABASE.md 11절: "draft 생성 후 10분이 지난 상태에서 GET 조회 → 만료로 계산해 안내하지만 DB는 변경하지 않음"

## 미정 사항

- 해석: 링크 7일 만료와 draft 10분 만료가 겹치면 처리 순서 3번(410)이 5번(200 draftExpired)보다 먼저다. 요청의 "만료된 draft는 200"은 10분 만료로 해석했다.
- 해석: 기준 시각은 `status`로 고른다. `cancelled`는 이전에 확정됐더라도 `voting_deadline_at` 기준이다(명세 "그 외 약속"). `confirmed`인데 `confirmed_start_at`이 없으면 `voting_deadline_at`으로 대체한다(CHECK상 발생하지 않음). `cancelled`이고 `voting_deadline_at`이 NULL인 조합은 CHECK `ck_promise_required_settings`가 cancelled를 예외로 두어 스키마상 가능하며, 이때는 링크 발급 시각을 기준으로 한다(테스트로 고정, 2026-11-04 승인).
- `pollAfterMs` 3000: 규칙 본문에 값이 없고 명세 예시값이다.
- 추가: 모든 응답에 `Cache-Control: no-store` (명세 보안 정보에 반영).
- 형식 오류 토큰은 DB를 조회하지 않아 응답이 빠르다. 형식은 공개 정보라 "없는 토큰과 만료 토큰의 응답 지연을 비슷하게" 요구와 충돌하지 않는다고 판단했다.
- [제안] 레이트 리밋: 미구현 (기존과 동일).

## 결과

2026-11-04 구현·검증, 판단 1~4 승인 후 완료. 마감 없는 cancelled 테스트 추가 후 `npm run test` 50건 통과

| 수용 기준 | 결과 | 근거 |
| --- | --- | --- |
| AC-1 | 충족 | `link-lookup.test.ts` 형식 오류 4종은 DB 미조회 / curl `AAAA…`(없음)·`bad-token`·`…%21` → 404 |
| AC-2 | 충족 | `link-status.test.ts` 등록 전·collecting·confirmed 각각 7일 직전 유효/정확히 7일 만료, 확정은 시작 시각 기준, 재조율 새 마감 기준 / curl 발급 8일 지난 링크 → 410 |
| AC-3 | 충족 | 정확히 10분 경계 테스트 / curl 20분 지난 draft → 200 `draftExpired:true` |
| AC-4 | 충족 | 상태별 테스트, 필드 6개 `toEqual` / curl unclaimed·draft(`pollAfterMs:3000`) |
| AC-5 | 충족 | 조회는 `findUnique`·`SELECT clock_timestamp()`뿐 / curl 7건 전후 `promise_links`·`promises`·`participants`·`participant_sessions` 행 수·md5 동일 |
| AC-6 | 충족 | `link-lookup.test.ts` now 미지정 시 `$queryRaw` 1회, 지정 시 0회 |
| AC-7 | 충족 | `route.test.ts` 500 본문에 원문 없음 |

변경 파일: `app/api/v1/links/[inviteToken]/route.ts`(+test), `lib/member/link-status.ts`(+test), `lib/member/link-lookup.ts`(+test), `lib/member/invite-link.ts`(`isInviteTokenFormat`), `lib/api-error.ts`, `docs/specs/api/member.md`(404 형식 오류, `no-store`).
