# API 공통 규약

> 원본: Notion 「API」 › MEMBER-API-00 공통 규약
> 추출일: 2026-10-30

> 2026-10-12 1차 리뷰 반영: 잠금 순서, 마감 판정 함수, 세션 만료 규칙을 보강했다.

## 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-04-01, MEMBER-06-01, MEMBER-06-03, TIME-01-01, STATE-01-01
- 권한: 공통
- 허용 상태: 공통
- 상태 전환: 없음
- TBD : MEMBER-05-02, MEMBER-05-03, MEMBER-05-04, MEMBER-06-02, MEMBER-06-04, MEMBER-07-01, MEMBER-07-03, MEMBER-08-01, MEMBER-09-01, EXCEPTION 도메인 전체(본문 미작성)

## 1. 기술 전제

- **런타임:** Next.js(App Router) Route Handlers, TypeScript
- **DB:** PostgreSQL (Neon)
- **Base URL:** `/api/v1`
- **Content Type:** `application/json; charset=utf-8`
- **기준 시간대:** `Asia/Seoul` (TIME-01-01). 모든 시각은 ISO 8601 오프셋 포함 문자열. 예: `2026-10-20T19:00:00+09:00`

## 2. 식별자 규약

| 식별자        | 위치      | 설명                                                                                                     |
| ------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| inviteToken   | URL 경로  | `promise_links.invite_token`. 약속 생성 전 단계의 유일한 식별자                                          |
| promiseId     | URL 경로  | `promises.id` (UUID). 링크 조회 또는 방장 등록 응답으로 전달. UUID를 아는 것만으로는 권한이 없다 (ERD 9) |
| participantId | 응답 바디 | `participants.id` (UUID). 요청 바디로 받은 participantId는 신뢰하지 않고 항상 세션에서 꺼낸다            |

## 3. 응답 포맷

모든 API 응답(성공·에러)에 `Cache-Control: no-store`를 붙인다. 상태·세션·만료가 요청마다 달라지기 때문이다. Route Handler는 처리 함수를 `lib/no-store.ts`의 `noStore`로 한 번 감싼다 (2026-11-04).

성공 시 래퍼 없이 리소스 객체를 그대로 반환한다.

```json
{ "promiseId": "7c1b2f40-...", "promiseStatus": "collecting" }
```

실패 시 HTTP 상태 코드와 함께 아래 형태를 반환한다. `details`는 상황에 따라 생략된다.

```json
{
  "code": "NICKNAME_TAKEN",
  "message": "이미 사용 중인 닉네임입니다.",
  "details": { "field": "nickname" }
}
```

### 공통 에러 코드

| HTTP | code                               | 발생 원인                                                                                                                                                                                                                                                                    |
| ---- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | INVALID_REQUEST                    | JSON 파싱 실패, 필수 필드 누락                                                                                                                                                                                                                                               |
| 401  | UNAUTHENTICATED                    | 세션 쿠키 없음·만료됨. 탈퇴·내보내기로 세션이 즉시 만료된 경우, 또는 참여자가 cancelled인 경우도 포함                                                                                                                                                                        |
| 403  | FORBIDDEN                          | 세션은 유효하나 해당 약속의 참여자가 아니거나 방장 권한 부족                                                                                                                                                                                                                 |
| 403  | INVALID_ORIGIN                     | 상태 변경 요청에 `Origin` 헤더가 없거나 허용 출처(서비스 도메인 `NEXT_PUBLIC_BASE_URL`의 origin, Vercel 미리보기는 그 배포 주소)와 다름 (7절 CSRF)                                                                                                                           |
| 404  | LINK_NOT_FOUND / PROMISE_NOT_FOUND | 존재하지 않는 토큰·약속                                                                                                                                                                                                                                                      |
| 409  | PROMISE_CANCELLED                  | 취소된 약속에 대한 요청 (STATE API 명세 기준으로 통일, 2026-11-04)                                                                                                                                                                                                           |
| 409  | INVALID_PROMISE_STATE              | 이 API에서 허용하지 않는 약속 상태                                                                                                                                                                                                                                           |
| 410  | DRAFT_EXPIRED                      | 약속(promiseId)을 경로로 받는 API에서 생성 후 10분이 지난 draft (STATE-02-02). 잠금을 잡는 쓰기 API는 삭제 후, 잠그지 않는 API는 삭제 없이 응답한다. 링크(inviteToken) 기준 API(MEMBER-API-01)는 에러 대신 `unclaimed`로 응답한다 (2026-11-04, DECISION_CONFLICTS R-11·R-12) |
| 413  | PAYLOAD_TOO_LARGE                  | 요청 본문이 API별 상한을 넘음. Content-Length와 실제로 읽은 크기를 모두 확인한다. 상한은 API 명세에 적는다(TIME-API-01: 256KB). 세션 인증 전에 판정하므로 쿠키를 갱신하지 않는다 (2026-11-04, DECISION_CONFLICTS R-14)                                                       |
| 422  | VALIDATION_FAILED                  | 형식은 맞지만 값이 규칙 위반 (닉네임 길이, PIN 형식 등)                                                                                                                                                                                                                      |
| 500  | INTERNAL_ERROR                     | 서버 오류. 비밀값은 로그·응답에 남기지 않는다                                                                                                                                                                                                                                |

## 4. 동시성과 시간 판정

### 4.1 잠금 순서 — 모든 쓰기 경로가 동일하게 따른다

링크 단계와 약속 단계를 섞어 잠그면 초안 만료 처리와 설정 완료가 서로를 덮어쓸 수 있다. 그래서 순서를 하나로 고정한다.

1. 링크를 경로로 받는 쓰기 요청(MEMBER-API-02)은 **`promise_links` 행을 먼저** `FOR UPDATE`로 잠근다. MEMBER-API-01은 GET이므로 잠그지 않고 초안 만료도 계산만 한다 (STATE-02-02).
2. 연결된 약속이 있으면 이어서 **`promises` 행도** `FOR UPDATE`로 잠근다.
3. 약속을 경로로 받는 요청(MEMBER-API-03 이하)은 `promises` 행만 잠근다.
   단, `draft`를 물리 삭제할 수 있는 요청(만료 `draft` 정리, `draft` 탈퇴)은
   `promise_link_id`를 잠금 없이 읽은 뒤 1·2번 순서(링크 → 약속)를 따른다.
4. **잠금을 얻은 뒤 상태·`created_at`·`voting_deadline_at`을 다시 읽는다.** 잠금 대기 중에 다른 트랜잭션이 바꿨을 수 있으므로, 잠금 이전에 읽은 값으로 판단하지 않는다.

이 순서 덕분에 초안 만료 삭제와 설정 완료는 같은 약속에 대해 직렬화된다. **설정 완료가 먼저 커밋됐다면 만료 처리자는 잠금 후 재조회에서 `status != 'draft'`를 보고 삭제하지 않는다** (STATE-02-02).

### 4.2 마감·만료 판정 시각

- 판정은 항상 서버(DB) 시각으로 한다. 클라이언트 시각은 신뢰하지 않는다.
- **PostgreSQL `now()`는 트랜잭션 시작 시각이다.** 잠금 대기 시간이 반영되지 않으므로 마감·만료 판정에는 **잠금을 획득한 뒤 `clock_timestamp()`** 를 읽어 사용한다 (ERD 8.2).
- 경계값 처리: 판정 시각이 `voting_deadline_at`과 정확히 같으면 **거절**한다. 초안 만료는 `created_at + 10분 ≤ 판정 시각`이면 만료로 본다.

## 5. 인증·세션

- **인증 방식:** 서버가 발급하는 httpOnly 세션 쿠키 (MEMBER-06-03). 쿠키는 **약속별로 분리**한다.
- **쿠키 이름:** `ys_session_{promiseId}`
- **쿠키 속성:** `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/{promiseId}`
- **저장:** 원본 토큰은 브라우저에만 두고 서버는 `participant_sessions.session_token_hash`에 해시만 저장한다.
- **다중 기기:** 여러 기기 동시 로그인을 허용하고 기기별 세션을 따로 둔다 (MEMBER-04-02).
- **매 요청 재검증:** 세션 만료, 참여자 `status = active`, 약속 현재 상태를 요청마다 다시 확인한다. 클라이언트가 보낸 `isHost`·`participantId`는 믿지 않는다.
- **세션 인증 순서 (공통 모듈 `lib/member/session-auth.ts`):** promiseId 형식(400 `INVALID_REQUEST`) → 약속 존재(404) → cancelled면 세션 검사보다 먼저 409 `PROMISE_CANCELLED` → `ys_session_{promiseId}` 쿠키의 SHA-256 해시로 세션 조회 → `expires_at > DB 시각`·참여자 `status=active`(실패 시 401 `UNAUTHENTICATED`) → 다른 약속 소속이면 403 `FORBIDDEN`.
- **쿠키 갱신 (2026-11-04, DECISION_CONFLICTS R-12):** 세션 인증에 성공한 요청의 **모든 응답**(에러 포함)은 `Set-Cookie`로 쿠키를 다시 보낸다. `Max-Age`는 응답 시점 DB `expires_at`까지 남은 초(내림)이며, 같은 요청에서 `expires_at`이 바뀌었으면 바뀐 값으로 계산한다. 같은 요청에서 세션 행이 삭제됐으면 `Max-Age=0`으로 쿠키를 지운다. 서버가 세션을 연장해도 브라우저 쿠키가 처음 받은 Max-Age로 먼저 사라지는 문제를 막기 위해서다.

### 5.1 쿠키 Path가 만드는 제약 — 반드시 지킬 것

쿠키 Path가 `/api/v1/promises/{promiseId}`이므로 **`/api/v1/links/...` 요청에는 세션 쿠키가 전달되지 않는다.** 애초에 클라이언트는 링크 조회 전에는 promiseId를 모르므로 보낼 쿠키를 고를 수도 없다.

따라서 본인 복원은 다음 2단계로만 한다.

```txt
GET /api/v1/links/:inviteToken      → promiseId 확인 (쿠키 없음)
GET /api/v1/promises/:promiseId/me  → 본인·권한 확인 (쿠키 전달됨)
```

MEMBER-API-01 응답에 본인 정보를 담지 않는 이유가 이것이다.

### 5.2 세션 만료 규칙

| 시점                                  | 세션 만료(`expires_at`)와 쿠키 Max-Age                                                                                                                                                                                                                                                                                                                                                                                                                                              | 근거                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| draft에서 발급                        | 발급 시점(DB 시각) + 24시간, 쿠키 Max-Age=86400                                                                                                                                                                                                                                                                                                                                                                                                                                     | 마감 시각이 아직 없음. **확정 (2026-11-04, DECISION_CONFLICTS R-10)** — 규칙 본문에는 없음 |
| 모집 시작(draft → collecting)         | 해당 약속의 `status=active` 참여자 세션 중 **아직 유효한 것만** `voting_deadline_at + 7일`로 갱신한다(만료됐거나 cancelled 참여자의 세션은 되살리지 않음, STATE-API-00·02). 요청자 쿠키는 그 응답에서, 다른 기기 쿠키는 이후 세션 인증 응답에서 Set-Cookie로 Max-Age를 갱신한다                                                                                                                                                                                                     | MEMBER-06-03                                                                               |
| 마감 연장(모집 중 설정 변경)          | 설정 변경과 같은 트랜잭션에서 해당 약속의 `status=active` 참여자 세션 중 **아직 유효한 것만** 새 `voting_deadline_at + 7일`로 갱신한다(만료됐거나 cancelled 참여자의 세션은 되살리지 않음). 마감을 바꾸지 않은 설정 변경(같은 값 포함)은 갱신하지 않는다. 모집 중 마감 단축은 422 `DEADLINE_SHORTEN_NOT_ALLOWED`로 거절하므로 단축 때 세션 규칙은 없다. 요청자 쿠키는 그 응답에서, 다른 기기 쿠키는 이후 세션 인증 응답에서 갱신한다                                                | STATE-API-03, R-27 (기존 "연장·단축 모두 모든 세션 갱신" 문구를 03 명세에 맞춤)            |
| 조기 마감                             | 세션·링크 만료는 `voting_deadline_at + 7일`을 유지하며 조기 마감 때 갱신하지 않는다. `voting_deadline_at`도 덮어쓰지 않는다(STATE-API-04)                                                                                                                                                                                                                                                                                                                                           | **C-11 잠정, 팀 확정 필요**                                                                |
| 최종 일정 확정(closed → confirmed)    | 확정과 같은 트랜잭션에서 해당 약속의 `status=active` 참여자 세션 중 **아직 유효한 것만** `confirmed_start_at + 7일`로 갱신한다(만료됐거나 cancelled 참여자의 세션은 되살리지 않음, STATE-API-05). 요청자 쿠키는 그 응답에서, 다른 기기 쿠키는 이후 세션 인증 응답에서 Set-Cookie로 Max-Age를 갱신한다. 조기 마감 뒤 마감 시각보다 이른 일정으로 확정하면 만료가 앞당겨질 수 있다                                                                                                    | **C-10 잠정, 팀 확정 필요**                                                                |
| 재조율(closed·confirmed → collecting) | 재조율과 같은 트랜잭션에서 해당 약속의 `status=active` 참여자 세션 중 **아직 유효한 것만** 새 `voting_deadline_at + 7일`로 갱신한다(만료됐거나 cancelled 참여자의 세션은 되살리지 않음). confirmed에서 재조율하면 `confirmed_start_at + 7일`보다 짧아질 수 있다. 요청자 쿠키는 그 응답에서, 다른 기기 쿠키는 이후 세션 인증 응답에서 갱신한다                                                                                                                                       | STATE-API-06, R-26, **C-10 잠정**                                                          |
| 탈퇴·내보내기                         | 해당 참여자의 모든 세션 expires_at을 현재 시각으로 변경해 즉시 만료한다(행은 삭제하지 않음). 이후 그 쿠키는 401. 구현: 아직 유효한 세션만 `expires_at`=탈퇴 시각(이미 만료된 세션은 원래 시각). 방장 승계면 옛 방장 세션만 만료하고 새 방장 세션은 그대로다. 후임 없는 방장의 탈퇴는 아래 「약속 취소」 행과 같다. 탈퇴는 요청자 쿠키 Max-Age=0. 내보내기는 대상 세션만 같은 방식으로 만료하고 요청한 방장의 세션·쿠키는 그대로 갱신한다(일반 탈퇴와 같은 함수 `cancelParticipant`) | MEMBER-10-03, STATE-API-08, MEMBER-API-08, R-28, R-30                                      |
| 약속 취소                             | 취소와 같은 트랜잭션에서 이 약속의 세션 중 **아직 유효한 것을 참여자 상태와 관계없이** `expires_at`=취소 시각(`cancelled_at`)으로 바꾼다. 행은 삭제하지 않고, 이미 만료된 세션은 원래 시각을 둔다. 요청자 쿠키는 Max-Age=0. 이후 세션 API는 세션보다 먼저 409 `PROMISE_CANCELLED`                                                                                                                                                                                                   | STATE-API-07, R-25                                                                         |
| draft 탈퇴, 10분 만료                 | 세션 행 물리 삭제(약속과 함꼐 삭제됨)                                                                                                                                                                                                                                                                                                                                                                                                                                               | ERD 10절                                                                                   |
| 로그아웃(MEMBER-API-07)               | 쿠키의 세션 행을 물리 삭제한다. `allDevices=true`이고 그 세션이 아직 유효(만료 전·active 참여자)하면 같은 참여자의 세션 행을 모두 삭제한다. 만료·cancelled 참여자 세션이면 자기 행만 지운다. 행이 없어도·만료돼도·취소된 약속이어도 204와 쿠키 Max-Age=0(공통 인증 순서의 409 `PROMISE_CANCELLED` 예외). 다른 약속 세션은 403 `FORBIDDEN`·삭제 없음                                                                                                                                 | ERD 3.5, MEMBER-04-02, R-31                                                                |

| 참여자 등록(MEMBER-API-03)으로 발급 | `linkExpiryBase + 7일`(collecting이므로 `voting_deadline_at + 7일`). 쿠키 Max-Age는 잠금 후 판정 시각 기준 `expires_at`까지 남은 초(내림) | **확정 (2026-11-04, DECISION_CONFLICTS R-13)** |
| 재인증(MEMBER-API-04)으로 발급 | draft면 발급 시각 + 24시간. 그 외에는 `linkExpiryBase + 7일`(MEMBER-API-01 링크 만료와 같은 기준 시각). 쿠키 Max-Age는 `expires_at`까지 남은 초(내림) | **확정 (2026-11-04)** |

**만료 후 재로그인:** 로그인 가능 기간 = 링크 유효 기간(`linkExpiryBase + 7일`)이다. 이 기간이 지나면 **PIN 재인증도 거절한다**(MEMBER-API-04에서 410 `ACCESS_PERIOD_EXPIRED`). 7일은 "로그인 유지 기간"이 아니라 "본인 입력에 접근할 수 있는 기간"으로 해석한다. **확정 (2026-11-04, DECISION_CONFLICTS R-11).** 확정된 약속은 `confirmed_start_at` 기준이라 마감 + 7일이 지나도 로그인할 수 있다.

**미결 (DECISION_CONFLICTS R-11):** 확정 시 기존 세션 갱신(C-10)은 잠정 A안(active 참여자의 유효 세션만 `confirmed_start_at + 7일`, STATE-API-05)으로, 조기 마감 시 세션 기준과 링크 기준의 차이(C-11)는 잠정 B안(둘 다 `voting_deadline_at + 7일`)으로 맞췄다. 둘 다 팀 확정이 필요하다.

## 6. 중복 요청·응답 유실

등록 API는 성공했는데 응답이 유실될 수 있다. 이때 같은 요청을 재시도하면 `HOST_ALREADY_REGISTERED` 또는 `NICKNAME_TAKEN`이 나는데, **실제로는 본인이 성공한 경우와 남이 선점한 경우를 응답만으로 구분할 수 없다.**

MVP에서는 `Idempotency-Key` 대신 **재인증으로 복구**한다.

1. 등록이 409로 실패하면 클라이언트는 "이미 등록하셨나요? 로그인" 분기를 보여준다.
2. 사용자가 방금 입력한 닉네임·PIN 그대로 MEMBER-API-04를 호출한다.
3. 성공하면 본인이 앞서 등록에 성공한 것이므로 그대로 진행한다. 401이면 남이 선점한 것이다.

이 흐름은 등록과 재인증을 분리해 둔 현재 구조에서 추가 구현 없이 동작한다. 요청 단위 멱등 보장이 필요해지면 그때 `Idempotency-Key`를 도입한다. 근거 규칙(EXCEPTION-11-01, 11-02)은 본문 미작성 상태다.

## 7. 보안 정보

- **PIN:** 숫자 4자리(MEMBER-06-01) = 조합 1만 가지. 해시 저장은 원문 노출만 막을 뿐이므로 시도 제한이 반드시 필요 → **MEMBER-06-04 미정**.
- **실패 메시지 통일:** 닉네임 없음과 PIN 불일치를 구분하지 않고 동일한 `INVALID_CREDENTIALS`로 응답한다.
- **CSRF:** `SameSite=Lax` + 상태 변경 요청에 `Origin` 헤더 검증. 실패하면 403 `INVALID_ORIGIN`.
  - 허용 출처(`lib/public-url.ts` `allowedOrigins`, R-36): 로컬·운영은 `NEXT_PUBLIC_BASE_URL`의 origin(운영은 Vercel 운영 도메인 `VERCEL_PROJECT_PRODUCTION_URL`도), Vercel 미리보기(`VERCEL_ENV=preview`)는 그 배포의 주소 `VERCEL_URL`과 브랜치 주소 `VERCEL_BRANCH_URL`(https). 다른 배포·다른 사이트·같은 호스트의 http는 403.
- 전 구간 HTTPS. PIN·세션 토큰은 어떤 로그에도 기록하지 않는다.
- PIN 분실 시 복구 수단을 제공하지 않는다. 분실한 참여자는 새 닉네임으로 재참여해야 하며 기존 입력은 이어받지 못한다.
