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

| 식별자 | 위치 | 설명 |
| --- | --- | --- |
| inviteToken | URL 경로 | `promise_links.invite_token`. 약속 생성 전 단계의 유일한 식별자 |
| promiseId | URL 경로 | `promises.id` (UUID). 링크 조회 또는 방장 등록 응답으로 전달. UUID를 아는 것만으로는 권한이 없다 (ERD 9) |
| participantId | 응답 바디 | `participants.id` (UUID). 요청 바디로 받은 participantId는 신뢰하지 않고 항상 세션에서 꺼낸다 |

## 3. 응답 포맷

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

| HTTP | code | 발생 원인 |
| --- | --- | --- |
| 400 | INVALID_REQUEST | JSON 파싱 실패, 필수 필드 누락 |
| 401 | UNAUTHENTICATED | 세션 쿠키 없음·만료됨. 탈퇴·내보내기로 세션이 즉시 만료된 경우, 또는 참여자가 cancelled인 경우도 포함 |
| 403 | FORBIDDEN | 세션은 유효하나 해당 약속의 참여자가 아니거나 방장 권한 부족 |
| 403 | INVALID_ORIGIN | 상태 변경 요청에 `Origin` 헤더가 없거나 서비스 도메인(`NEXT_PUBLIC_BASE_URL`의 origin)과 다름 (7절 CSRF) |
| 404 | LINK_NOT_FOUND / PROMISE_NOT_FOUND | 존재하지 않는 토큰·약속 |
| 409 | PROMISE_STATE | 취소된 약속에 대한 요청 |
| 422 | VALIDATION_FAILED | 형식은 맞지만 값이 규칙 위반 (닉네임 길이, PIN 형식 등) |
| 500 | INTERNAL_ERROR | 서버 오류. 비밀값은 로그·응답에 남기지 않는다 |

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

### 5.1 쿠키 Path가 만드는 제약 — 반드시 지킬 것

쿠키 Path가 `/api/v1/promises/{promiseId}`이므로 **`/api/v1/links/...` 요청에는 세션 쿠키가 전달되지 않는다.** 애초에 클라이언트는 링크 조회 전에는 promiseId를 모르므로 보낼 쿠키를 고를 수도 없다.

따라서 본인 복원은 다음 2단계로만 한다.

```txt
GET /api/v1/links/:inviteToken      → promiseId 확인 (쿠키 없음)
GET /api/v1/promises/:promiseId/me  → 본인·권한 확인 (쿠키 전달됨)
```

MEMBER-API-01 응답에 본인 정보를 담지 않는 이유가 이것이다.

### 5.2 세션 만료 규칙

| 시점 | 세션 만료(`expires_at`)와 쿠키 Max-Age | 근거 |
| --- | --- | --- |
| draft에서 발급 | 발급 시점 + 24시간 | 마감 시각이 아직 없음. **[제안 — 규칙 본문에 없음]** |
| 모집 시작(draft → collecting) | 해당 약속의 **모든** 세션을 `voting_deadline_at + 7일`로 갱신하고, 이후 요청의 응답에서 Set-Cookie로 쿠키 Max-Age도 갱신한다 | MEMBER-06-03 |
| 마감 연장·단축 | 동일하게 모든 세션을 새 `voting_deadline_at + 7일`로 갱신한다. 단축이어도 세션을 끊지 않는다 — 마감 후 조회는 허용되기 때문 | STATE-06-02 |
| 조기 마감 | 기준은 **실제 마감 처리 시각**이다. 설정돼 있던 `voting_deadline_at`이 아니라 `closed`로 전환된 시각 + 7일 | **[제안 — 규칙 본문에 없음]** |
| 탈퇴·내보내기 | 해당 참여자의 모든 세션 expires_at을 현재 시각으로 변경해 즉시 만료한다(행은 삭제하지 않음). 이후 그 쿠키는 401 | MEMBER-10-03 |
| draft 탈퇴, 10분 만료 | 세션 행 물리 삭제(약속과 함꼐 삭제됨) | ERD 10절 |

**만료 후 재로그인:** 마감 후 7일이 지나면 세션이 만료되고, **PIN 재인증도 거절한다**(MEMBER-API-04에서 410). 7일은 "로그인 유지 기간"이 아니라 "본인 입력에 접근할 수 있는 기간"으로 해석한다. 이 해석은 **[제안]** 이며 MEMBER-06-03 본문에 명시돼 있지 않다 — 확정 필요.

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
- 전 구간 HTTPS. PIN·세션 토큰은 어떤 로그에도 기록하지 않는다.
- PIN 분실 시 복구 수단을 제공하지 않는다. 분실한 참여자는 새 닉네임으로 재참여해야 하며 기존 입력은 이어받지 못한다.
