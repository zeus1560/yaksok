# MEMBER API 명세

> 원본: Notion 「API」 › api 명세서 DB (도메인 = MEMBER)
> 추출일: 2026-10-30
> 공통 규약은 [API_CONVENTIONS.md](../API_CONVENTIONS.md) 참고.
> 인증은 HttpOnly 세션 쿠키, URL 접두사는 `/api/v1`, 응답은 순수 JSON.

---

## MEMBER-API-01 — 초대 링크 조회

`GET /api/v1/links/:inviteToken`

링크 진입 시 약속 존재·상태 조회. 비참여자도 호출 가능하며 설정 중 화면의 폴링 대상.

> 2026-10-12 수정: `viewer` 삭제(쿠키 Path 문제), `nextAction` 확장, 잠금 규칙 수정.

> 2026-10-12 결정 반영: **비참여자에게는 약속 설정을 일절 공개하지 않는다.** `promise` 객체 전체 삭제.

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-01-02, MEMBER-01-03, MEMBER-01-04, MEMBER-03-01, MEMBER-03-02, MEMBER-08-01, MEMBER-08-02, STATE-01-01, STATE-02-01, STATE-02-02
- 관련 US: 링크로 약속에 진입한다
- 권한: **누구나** (링크만 가진 비참여자 포함, 인증 불필요)
- 허용 상태: 링크만 존재 / draft / collecting / closed / confirmed / cancelled — 전부
- 상태 전환: 없음. **초안 만료(STATE-02-02)는 계산만 하고 DB를 변경하지 않는다**
- 동시성: 잠금 없음 (읽기 전용). 만료 draft의 실제 삭제는 MEMBER-API-02가 잠금 후 수행한다 (MEMBER-API-00 4.1)

### 1. 기본 정보

- **목적:** 초대 링크를 연 사용자에게 **다음 화면을 고르는 데 필요한 최소 정보만** 준다.
- **HTTP Method:** GET
- **Endpoint:** `/api/v1/links/:inviteToken`
- **Authentication Required:** 아니요
- **Content Type:** `application/json`

#### 공개 범위 — 등록해야 보인다

**등록하지 않은 사람에게는 약속 내용을 공개하지 않는다.** 날짜·시간 범위, 소요 시간, 마감, 정원, 현재 인원, 확정 시각 모두 응답에 넣지 않는다. 참여자 명단과 개별 입력도 당연히 제외다 (MEMBER-08-02, MEMBER-08-03).

이 API가 주는 것은 **"이 링크가 지금 어떤 상태이고, 그래서 무엇을 해야 하는가"** 뿐이다.

> MEMBER-08-01 본문은 "설정 중에는 MEMBER-03-01을 따른다"까지만 적혀 있고 collecting 이후 범위가 비어 있었다. 이번 결정으로 **모든 상태에서 비참여자 비공개**로 채운다. 규칙 본문에도 반영이 필요하다.

이 결정의 부수 효과로 **`promises`에 약속 이름 컬럼을 추가할 필요가 없어졌다.** 공개할 내용 자체가 없기 때문이다.

#### 본인 정보가 없는 이유

쿠키 Path가 `/api/v1/promises/{promiseId}`이므로 `/api/v1/links/...`에는 세션 쿠키가 전달되지 않는다. 애초에 클라이언트는 이 호출 전에는 promiseId를 몰라 보낼 쿠키를 고를 수도 없다. 본인 확인은 응답의 `promiseId`로 **MEMBER-API-05(`/me`)를 이어서 호출**해 처리한다 (MEMBER-API-00 5.1).

### 요청

- 헤더: 없음 (쿠키를 보내도 서버는 사용하지 않는다)
- Path 파라미터

| 이름        | 타입   | 설명          | 필수 |
| ----------- | ------ | ------------- | ---- |
| inviteToken | string | 초대 URL 토큰 | O    |

- Request Body: 없음

### 응답

#### Status Code: 200 OK

| 이름          | 타입             | 설명                                                                                                                              |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| inviteToken   | string           | 요청한 토큰                                                                                                                       |
| promiseStatus | string           | unclaimed / draft / collecting / closed / confirmed / cancelled. unclaimed는 아직 아무도 방장 등록을 하지 않은 상태 (STATE-02-01) |
| promiseId     | string 또는 null | 약속 UUID. unclaimed이면 null. **이 값으로 `/me`를 호출해 본인 여부를 판정한다**                                                  |
| nextAction    | string           | 아래 「화면 분기」 표 참조                                                                                                        |
| pollAfterMs   | number 또는 null | draft일 때 재조회 권장 간격(ms). 그 외 null (MEMBER-03-02)                                                                        |
| draftExpired  | boolean          | GET 기준 draft 만료 여부. true이면 10분이 지난 draft를 unclaimed로 계산한 응답이다. GET은 DB를 변경하지 않음 (STATE-02-02)        |

**의도적으로 응답에 넣지 않는 값:** 약속 설정 일체(날짜·시간 범위, 소요 시간, 마감, 정원), 현재 참여 인원, 확정 시각, 참여자 명단, 본인 정보.

Response Body (draft — 설정 중)

```json
{
  "inviteToken": "k3Zq8vTb1mRa",
  "promiseStatus": "draft",
  "promiseId": "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42",
  "nextAction": "wait_setup",
  "pollAfterMs": 3000,
  "draftExpired": false
}
```

Response Body (collecting)

```json
{
  "inviteToken": "k3Zq8vTb1mRa",
  "promiseStatus": "collecting",
  "promiseId": "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42",
  "nextAction": "join",
  "pollAfterMs": null,
  "draftExpired": false
}
```

Response Body (아직 아무도 등록하지 않음)

```json
{
  "inviteToken": "k3Zq8vTb1mRa",
  "promiseStatus": "unclaimed",
  "promiseId": null,
  "nextAction": "register_host",
  "pollAfterMs": null,
  "draftExpired": false
}
```

Response Body (10분이 지난 draft — DB에는 draft가 남아 있지만 unclaimed로 계산)

```json
{
  "inviteToken": "k3Zq8vTb1mRa",
  "promiseStatus": "unclaimed",
  "promiseId": null,
  "nextAction": "register_host",
  "pollAfterMs": null,
  "draftExpired": true
}
```

### 에러

| HTTP 상태 | code           | 발생 원인                                                                                               | message 예시              |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------- | ------------------------- |
| 404       | LINK_NOT_FOUND | 존재하지 않는 초대 토큰. 발급 형식(base64url 22자)이 아닌 토큰은 DB를 조회하지 않고 같은 404로 응답한다 | 유효하지 않은 링크입니다. |
| 410       | LINK_EXPIRED   | 기준 시각 + 7일 경과 (MEMBER-01-02)                                                                     | 만료된 링크입니다.        |

챗봇을 채팅방에서 제거해도 이 API는 계속 동작한다 (MEMBER-01-03). 챗봇 재추가는 **새 링크**를 발급하며 기존 링크도 그대로 유효하다 (MEMBER-01-04).

### 처리 순서 / 비고

#### 화면 분기

`nextAction`은 **비참여자 기준 기본값**이다. 클라이언트는 `/me` 호출 결과로 최종 화면을 정한다.

| promiseStatus      | nextAction    | /me 결과                  | 실제 화면                                                     |
| ------------------ | ------------- | ------------------------- | ------------------------------------------------------------- |
| unclaimed          | register_host | 호출 불가(promiseId 없음) | 방장 등록                                                     |
| draft              | wait_setup    | 401                       | 설정 중 대기 + 폴링                                           |
| draft              | wait_setup    | 200, role=host            | **방장 설정 이어서 하기** (draftExpiresAt까지 남은 시간 표시) |
| collecting         | join          | 401                       | 등록 또는 재인증 선택 — 약속 내용은 이 단계에서 보이지 않는다 |
| collecting         | join          | 200, status=active        | **본인 가능 시간 입력 화면** (설정 값은 여기서 처음 받는다)   |
| closed / confirmed | view_result   | 401                       | "참여자만 결과를 볼 수 있습니다" + 재인증                     |
| closed / confirmed | view_result   | 200                       | 결과 화면 (방장이면 확정·재조율 버튼)                         |
| cancelled          | cancelled     | 무관                      | 취소 안내                                                     |

`nextAction` 허용값: `register_host` | `wait_setup` | `join` | `view_result` | `cancelled`

#### 처리 순서

1. `inviteToken`으로 `promise_links` 조회. 없으면 404.
2. 연결된 `promises` 행 조회.
3. 만료 판정: 기준 시각 + 7일 ≤ 판정 시각이면 410 (MEMBER-01-02). 기준 시각은 confirmed면 `confirmed_start_at`, 그 외 약속은 `voting_deadline_at`(재조율 시 새 마감 시각), 약속이 없거나 `voting_deadline_at`이 없는 draft면 링크 `created_at`.
4. 약속이 없으면 unclaimed + register_host 반환.
5. 상태가 draft이고 `created_at + 10분 ≤ 판정 시각`이면 **만료로 계산만 한다.** 잠금·삭제 없이 `promiseStatus=unclaimed`, `promiseId=null`, `nextAction=register_host`, `draftExpired=true`로 응답한다 (STATE-02-02).
   - DB의 draft·방장 참여 기록은 그대로 남는다. 실제 삭제는 새 방장 등록(MEMBER-API-02)이 링크 → 약속 순서로 잠근 뒤 수행한다.
   - 그 사이에 방장이 설정을 완료했다면 다음 조회부터 collecting으로 보인다. 설정 완료와 만료 삭제의 경쟁은 MEMBER-API-02의 잠금 후 재조회가 판정한다.
6. 그 외에는 상태에 맞는 `nextAction`만 반환한다.
7. 정원이 찼어도 `nextAction`은 join으로 둔다. 정원 정보를 공개하지 않으므로 거절은 MEMBER-API-03이 시도 시점에 판정한다.

#### 보안 정보

- 인증 없이 호출되므로 `invite_token`은 충분한 길이의 암호학적 난수를 사용한다.
- 존재하지 않는 토큰과 만료 토큰의 응답 지연을 비슷하게 유지한다.
- 응답에 약속 내용이 없으므로 토큰이 유출돼도 노출되는 정보는 "그 약속이 현재 어떤 단계인가" 뿐이다.
- 폴링 대상이므로 IP 기준 레이트 리밋을 둔다. **[제안]**
- 모든 응답(200·404·410·500)에 `Cache-Control: no-store`를 붙인다. 폴링 결과가 캐시되면 상태 전환을 놓친다.

---

## MEMBER-API-02 — 방장 등록 (약속 생성)

`POST /api/v1/links/:inviteToken/host`

닉네임·PIN으로 최초 등록에 성공한 사람을 방장으로 지정하고 draft 약속을 함께 생성.

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-02-01, MEMBER-04-01, MEMBER-05-01, MEMBER-05-05, MEMBER-06-01, MEMBER-06-03, STATE-02-01, STATE-02-02
- 권한: 누구나 (인증 불필요). 성공한 1명이 곧 방장
- 허용 상태: **링크만 존재(unclaimed)** 에서만 허용. 그 외 전부 409
- 상태 전환: 링크만 존재 → **draft** (약속·방장 동시 생성)
- 동시성: **필수.** `promise_links` 행을 FOR UPDATE로 잠그고 연결된 약속이 없음을 확인한 뒤 `promises` + `participants(host)`를 한 트랜잭션에서 생성한다. `promises.promise_link_id` UNIQUE가 2차 방어 (ERD 8.1)
- TBD: EXCEPTION-01-01, EXCEPTION-01-02, EXCEPTION-10-01 (본문 미작성)

### 1. 기본 정보

- **목적:** 링크를 선점해 약속 초안을 만들고 요청자를 방장으로 등록한다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/links/{inviteToken}/host`
- **Authentication Required:** 아니요 (성공 시 세션 발급)
- **Content Type:** `application/json`

**링크를 먼저 열었던 사람이 아니라 먼저 등록을 완료한 사람이 방장이다** (MEMBER-02-01). 약속 생성과 방장 등록은 한 번에 성공하거나 함께 취소된다.

### 요청

헤더

| Name         | Value            | 필수 |
| ------------ | ---------------- | ---- |
| Content-Type | application/json | O    |
| Origin       | 서비스 도메인    | O    |

Request Body

| 이름     | 타입   | 설명                                                                            | 필수 | 기본값 |
| -------- | ------ | ------------------------------------------------------------------------------- | ---- | ------ |
| nickname | string | 표시용 닉네임. 앞뒤 공백 제거 후 2~12자, 글자 수는 grapheme 단위 (MEMBER-05-01) | O    | -      |
| pin      | string | 숫자 4자리 (MEMBER-06-01). 원문은 저장하지 않는다                               | O    | -      |

요청 예시

```json
{ "nickname": "승주", "pin": "4827" }
```

#### 입력 검증

| 항목               | 규칙                                                                                                                                                                                                                                                                                                                                      | 근거                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 닉네임 길이        | trim 후 2자 이상 12자 이하. 사용자가 보는 글자(`Intl.Segmenter` grapheme) 단위로 센다. 결합 문자는 한 글자                                                                                                                                                                                                                                | MEMBER-05-01                          |
| 닉네임 이모지      | **비허용(확정, 2026-11-04).** `\p{Extended_Pictographic}`이 하나라도 있으면 422                                                                                                                                                                                                                                                           | MEMBER-05-01, DECISION_CONFLICTS R-10 |
| 닉네임 허용 문자   | 제한 없음 (모든 문자 허용)                                                                                                                                                                                                                                                                                                                | MEMBER-05-02                          |
| 연속 공백 처리     | 그대로 저장(trim만 적용, 중간 공백 보존)                                                                                                                                                                                                                                                                                                  | MEMBER-05-03                          |
| 대소문자 동일 취급 | 구분함 — normalized_nickname은 trim·NFC 정규화한 값을 그대로 저장                                                                                                                                                                                                                                                                         | MEMBER-05-04                          |
| Unicode 정규화     | **처리 순서: trim → NFC → 길이·이모지 검증.** `nickname`·`normalized_nickname` 모두 NFC 값으로 저장한다. 조합형으로 입력된 "가"(ᄀ+ᅡ)도 완성형 "가"로 저장되고 한 글자로 센다. NFKC는 쓰지 않는다(전각 문자 등 원문 보존·대소문자 구분과 충돌). MEMBER-API-03(중복 판정)·04(로그인)도 같은 정규화(`normalizeNickname`)를 거친 뒤 비교한다 | MEMBER-05-04, DECISION_CONFLICTS R-10 |
| PIN                | `^[0-9]{4}$`                                                                                                                                                                                                                                                                                                                              | MEMBER-06-01                          |

### 응답

#### Status Code: 201 Created

| 이름           | 타입              | 설명                                                                                                   |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| promiseId      | string (uuid)     | 생성된 약속 ID. 이후 모든 요청 경로에 사용                                                             |
| participantId  | string (uuid)     | 방장 참여자 ID                                                                                         |
| nickname       | string            | 정규화 전 표시용 닉네임                                                                                |
| role           | string            | 항상 host                                                                                              |
| promiseStatus  | string            | 항상 draft                                                                                             |
| draftExpiresAt | string (ISO 8601) | promises.created_at + 10분. 이 시각까지 설정을 마치지 않으면 약속과 방장 기록이 삭제된다 (STATE-02-02) |

응답 헤더

```
Set-Cookie: ys_session_7c1b2f40-...=<토큰>; HttpOnly; Secure; SameSite=Lax;
            Path=/api/v1/promises/7c1b2f40-...; Max-Age=86400
```

Response Body

```json
{
  "promiseId": "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42",
  "participantId": "b9a4c7e1-2f03-4a88-91ad-5c7e6b2d1f90",
  "nickname": "승주",
  "role": "host",
  "promiseStatus": "draft",
  "draftExpiresAt": "2026-10-11T12:10:00+09:00"
}
```

### 에러

| HTTP 상태 | code                    | 발생 원인                                                                               | message 예시                                                           |
| --------- | ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 400       | INVALID_REQUEST         | JSON 파싱 실패, `nickname`·`pin` 누락 또는 문자열이 아님                                | 요청 형식이 올바르지 않습니다.                                         |
| 403       | INVALID_ORIGIN          | `Origin` 헤더가 없거나 서비스 도메인과 다름. DB에 아무것도 쓰지 않는다                  | 허용되지 않은 요청 출처입니다.                                         |
| 404       | LINK_NOT_FOUND          | 존재하지 않는 토큰                                                                      | 유효하지 않은 링크입니다.                                              |
| 409       | HOST_ALREADY_REGISTERED | 이미 다른 사람이 선점 (MEMBER-02-01). 취소된 약속은 제외                                | 이미 다른 분이 약속을 만들었습니다. 본인이 등록했다면 로그인해 주세요. |
| 409       | PROMISE_CANCELLED       | 링크의 약속이 취소됨 (STATE-API-09 공통 처리 1, R-25. 2026-11-10 추가)                  | 취소된 약속입니다.                                                     |
| 410       | LINK_EXPIRED            | 기준 시각 + 7일 경과 (MEMBER-01-02)                                                     | 만료된 링크입니다.                                                     |
| 422       | VALIDATION_FAILED       | 닉네임 길이 위반, 닉네임 이모지, PIN 형식 위반. `details.field`에 `nickname` 또는 `pin` | 닉네임은 2자 이상 12자 이하여야 합니다.                                |

409를 받은 클라이언트는 **본인이 앞서 성공했는지 먼저 확인**해야 한다. 응답이 유실된 뒤 재시도한 경우에도 똑같은 409가 나기 때문이다 (MEMBER-API-00 6장).

1. "이미 등록하셨나요? 로그인" 분기를 보여주고 방금 입력한 닉네임·PIN으로 MEMBER-API-04를 호출한다.
2. 200 + `role = host`면 본인이 방장이므로 설정 화면으로 진행한다.
3. 401이면 남이 선점한 것이므로 **MEMBER-API-01을 폴링하는 "설정 중" 화면**으로 전환한다 (MEMBER-02-01, MEMBER-03-02).

구체적인 안내 문구는 EXCEPTION-01-02 미작성.

### 처리 순서 / 비고

#### 처리 순서 (단일 트랜잭션)

1. 입력 검증. 실패 시 422.
2. `SELECT ... FROM promise_links WHERE invite_token = $1 FOR UPDATE`. 없으면 404. 판정 시각은 잠금 후 `clock_timestamp()`로 읽는다. 연결된 약속이 있으면 **그 `promises` 행도 `FOR UPDATE`로 잠그고 status·created_at을 다시 읽는다** (MEMBER-API-00 4.1·4.2). 잠금 후 읽은 값으로 MEMBER-01-02 기준 시각 + 7일이 지났으면 410 (기준 시각 선택은 MEMBER-API-01 처리 순서 3번과 같다). 잠금 대기 중에 방장이 설정을 끝냈다면 재조회에서 status가 draft가 아니므로 만료 삭제하지 않는다 (STATE-02-02).
3. 연결된 `promises` 행 확인.
   - 있고 draft이며 10분 경과 → 세션 → 방장 참여자 → promise 순서로 삭제 후 계속 진행
   - 있고 cancelled → **409 PROMISE_CANCELLED** (아무것도 바꾸지 않음. 링크 만료 410이 먼저 — 링크 조회와 같은 순서)
   - 있고 그 외 → **409 HOST_ALREADY_REGISTERED**
4. `promises` 생성 (status = draft, 설정 컬럼은 전부 NULL). `created_at`은 잠금 후 읽은 판정 시각으로 넣어 draft 10분이 잠금 대기만큼 줄지 않게 한다. `promise_link_id` UNIQUE 위반(P2002)도 409로 응답한다.
5. `participants` 생성 (role = host, status = active, password_hash = hash(pin)).
6. 세션 토큰 생성 → `participant_sessions`에 해시 저장 → 쿠키 발급.
7. 커밋. 어느 단계든 실패하면 전부 롤백한다 (ERD 8.1).

#### 보안 정보

- PIN은 Node 내장 `crypto.scrypt`(N=2^15, r=8, p=1, maxmem 64MiB, PIN마다 16바이트 무작위 salt. 매개변수 근거는 DECISION_CONFLICTS R-10)로 해시해 `password_hash`에만 `scrypt$N$r$p$salt$hash` 형식으로 저장한다. 검증은 저장된 매개변수로 다시 계산해 `timingSafeEqual`로 비교한다 (MEMBER-API-04 재사용). 해시 계산은 잠금을 잡기 전에 한다.
- 세션 만료는 DB 시각 + 24시간, 쿠키 `Max-Age=86400` (MEMBER-API-00 5.2, 확정).
- 동일 링크에 대한 방장 등록 시도는 IP·토큰 기준 레이트 리밋을 둔다. **[제안]**
- 세션 토큰은 32바이트 이상 난수를 생성해 원본은 쿠키로만 내려주고 서버에는 해시만 저장한다.

---

## MEMBER-API-03 — 참여자 등록

`POST /api/v1/promises/:promiseId/participants`

모집 중인 약속에 닉네임·PIN으로 새 참여자를 등록하고 세션을 발급.

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-03-02, MEMBER-04-01, MEMBER-05-01, MEMBER-05-05, MEMBER-05-06, MEMBER-06-01, MEMBER-06-03, MEMBER-07-02, STATE-06-01
- 권한: 누구나 (링크를 아는 사람). 성공 시 member 역할
- 허용 상태: **collecting 이고 현재 시각 < 마감** 일 때만. cancelled 409 `PROMISE_CANCELLED`, draft 409 `PROMISE_NOT_OPEN`(10분 지났으면 410 `DRAFT_EXPIRED`), closed·confirmed 409 `INVALID_PROMISE_STATE`
- 상태 전환: 없음
- 동시성: **필수.** `promises` 행만 FOR UPDATE로 잠그고(삭제를 하지 않으므로 링크 잠금 불필요, MEMBER-API-00 4.1-3) 상태·마감·닉네임·정원을 검사한 뒤 참여자를 생성한다. 닉네임 경합은 `UNIQUE(promise_id, normalized_nickname)`가 최종 방어 (ERD 8.2)
- 결정 (2026-11-04, DECISION_CONFLICTS R-13): EXCEPTION-02-01(마지막 정원 경쟁)·03-01(동일 닉네임 경쟁)은 약속 행 잠금으로 직렬화되어 먼저 커밋한 요청이 이긴다. EXCEPTION-10-02(중복 참여 요청)는 아래 「중복 참여」

### 1. 기본 정보

- **목적:** 모집 중인 약속에 참여자를 등록하고 이후 가능 시간을 입력할 수 있는 세션을 발급한다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/participants`
- **Authentication Required:** 아니요 (성공 시 세션 발급)
- **Content Type:** `application/json`

방장이 설정을 끝내기 전(draft)에는 등록할 수 없고, "방장이 약속을 설정 중입니다" 화면만 보여준다 (MEMBER-03-02).

**등록에 성공해야 비로소 약속 내용을 볼 수 있다.** MEMBER-API-01은 상태만 주므로, 날짜·시간 범위·정원 같은 설정 값은 등록 후 받은 세션으로 호출하는 조회 API에서 내려간다 (MEMBER-08-01). 이 API의 201 응답에는 정원(`participantLimit`)과 현재 인원만 담는다.

#### 중복 참여 (EXCEPTION-10-02, 2026-11-04 결정)

- 같은 닉네임을 반복해 등록하면 409 `NICKNAME_TAKEN`을 받고 로그인(MEMBER-API-04)으로 복구한다.
- 이 약속의 **유효한 세션을 가진 브라우저**(세션 미만료 + active 참여자)가 다른 닉네임으로 등록하면 409 `ALREADY_PARTICIPANT`. 쿠키가 없거나 무효·만료·cancelled 참여자의 세션이면 401을 내지 않고 등록을 진행한다.
- 한 브라우저를 여러 사람이 쓰는 경우는 다른 브라우저로 등록하는 것으로 감수한다.
- 다른 기기·브라우저에서 다른 닉네임으로 재가입하는 것은 비회원 구조의 한계로 막지 않는다 (ERD 9).

#### 재참여는 허용하지 않는다

탈퇴했거나 내보내진 사람은 **자진 탈퇴·강제 제외를 가리지 않고 모두** 같은 약속에 다시 등록할 수 없다 (MEMBER-11-01, MEMBER-11-02). 이전 입력·제출 상태도 복구하지 않는다 (MEMBER-11-03).

구현상 이 제한은 별도 플래그 없이 닉네임 중복 검사로 걸린다. 탈퇴자 행을 `cancelled`로 남기고(MEMBER-10-03) `UNIQUE(promise_id, normalized_nickname)`가 살아 있기 때문이다 (MEMBER-05-06). 따라서 **`participants.status`를 `left`/`removed`로 쪼개는 분리할 필요가 없다.**

다른 닉네임으로 재가입하는 것까지는 비회원 구조상 막지 못한다 (ERD 9).

### 요청

- 헤더: `Content-Type: application/json`, `Origin` 필수
- Request Body

| 이름     | 타입   | 설명                                              | 필수 | 기본값 |
| -------- | ------ | ------------------------------------------------- | ---- | ------ |
| nickname | string | 2~12자. 같은 약속 안에서 중복 불가 (MEMBER-05-05) | O    | -      |
| pin      | string | 숫자 4자리                                        | O    | -      |

요청 예시

```json
{ "nickname": "혜승", "pin": "1357" }
```

### 응답

#### Status Code: 201 Created

| 이름                    | 타입          | 설명                                                                      |
| ----------------------- | ------------- | ------------------------------------------------------------------------- |
| participantId           | string (uuid) | 생성된 참여자 ID                                                          |
| nickname                | string        | 표시용 닉네임                                                             |
| role                    | string        | 항상 member                                                               |
| status                  | string        | 항상 active                                                               |
| availabilitySubmittedAt | null          | 등록 직후에는 미제출                                                      |
| currentParticipantCount | number        | 등록 후 active 참여자 수 (방장·미제출자 포함, 탈퇴자 제외 — MEMBER-07-02) |
| participantLimit        | number        | 방장 포함 정원                                                            |

응답 헤더: `Set-Cookie: ys_session_{promiseId}=...` (MEMBER-API-00 쿠키 규약 동일, `sessionCookie` 모듈). 세션 `expires_at`은 `linkExpiryBase + 7일`(collecting이므로 `voting_deadline_at + 7일`), `Max-Age`는 잠금 후 판정 시각 기준 `expires_at`까지 남은 초(내림)다 (MEMBER-API-00 5.2). 모든 응답에 `Cache-Control: no-store`.

Response Body

```json
{
  "participantId": "2d81c6b7-7f54-4a19-b0c8-3e5a1f9d4b22",
  "nickname": "혜승",
  "role": "member",
  "status": "active",
  "availabilitySubmittedAt": null,
  "currentParticipantCount": 4,
  "participantLimit": 6
}
```

### 에러

| HTTP 상태 | code                  | 발생 원인                                                                                                                                                    | message 예시                                                    |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 400       | INVALID_REQUEST       | JSON 파싱 실패, `nickname`·`pin` 누락 또는 문자열이 아님, promiseId가 UUID 형식이 아님 (R-12)                                                                | 요청 형식이 올바르지 않습니다.                                  |
| 403       | INVALID_ORIGIN        | `Origin` 헤더 없음 또는 서비스 도메인과 다름 (MEMBER-API-00 7절). DB에 아무것도 쓰지 않는다                                                                  | 허용되지 않은 요청 출처입니다.                                  |
| 404       | PROMISE_NOT_FOUND     | 존재하지 않는 promiseId                                                                                                                                      | 약속을 찾을 수 없습니다.                                        |
| 409       | PROMISE_CANCELLED     | 취소된 약속 (STATE-10-01)                                                                                                                                    | 취소된 약속입니다.                                              |
| 409       | ALREADY_PARTICIPANT   | 이 약속의 유효한 세션(active 참여자)을 가진 브라우저의 등록 (EXCEPTION-10-02, R-13)                                                                          | 이 브라우저는 이미 이 약속에 참여 중입니다.                     |
| 409       | PROMISE_NOT_OPEN      | 생성 후 10분 이내 draft — 방장이 아직 설정 중 (MEMBER-03-02)                                                                                                 | 방장이 약속을 설정 중입니다.                                    |
| 409       | INVALID_PROMISE_STATE | closed·confirmed에서의 신규 참여. 방장이 재조율을 시작하고 정원을 늘려야 허용된다 (STATE-06-01). `details`: `promiseStatus`, `allowedStates: ["collecting"]` | 현재 약속 상태에서는 요청할 수 없습니다.                        |
| 409       | DEADLINE_PASSED       | 상태는 collecting이지만 판정 시각 ≥ 마감. 상태는 바꾸지 않는다                                                                                               | 응답 마감이 지났습니다.                                         |
| 409       | NICKNAME_TAKEN        | 같은 약속에 동일 정규화 닉네임 존재. 탈퇴·내보내진 행도 포함한다 (MEMBER-05-05, 05-06, 11-01, 11-02). `details.field = "nickname"`                           | 이미 사용 중인 닉네임입니다. 본인이 등록했다면 로그인해 주세요. |
| 409       | PROMISE_FULL          | active 참여자 수가 정원에 도달                                                                                                                               | 참여 정원이 모두 찼습니다.                                      |
| 410       | DRAFT_EXPIRED         | 생성 후 10분 지난 draft (STATE-02-02). 이 API는 링크를 잠그지 않으므로 삭제하지 않는다 (R-12)                                                                | 설정 시간이 지나 약속이 만료되었습니다.                         |
| 422       | VALIDATION_FAILED     | 닉네임(trim → NFC, 2~12자, 이모지 불가)·PIN(숫자 4자리) 형식 위반. `details.field`                                                                           | PIN은 숫자 4자리여야 합니다.                                    |

### 처리 순서 / 비고

#### 처리 순서 (2026-11-04 변경, DECISION_CONFLICTS R-13)

요청 단계 (DB 잠금 전)

1. `Origin` 검증 → 실패 시 403 `INVALID_ORIGIN`.
2. 본문 파싱·필드 확인 → 400. 닉네임은 `normalizeNickname`(trim → NFC) 후 등록 규칙으로, PIN은 형식으로 검증 → 위반 시 422.
3. promiseId가 UUID 형식이 아니면 400 `INVALID_REQUEST`, 약속이 없으면 404, cancelled면 409 `PROMISE_CANCELLED`.
4. **기존 참여 확인 (EXCEPTION-10-02).** `ys_session_{promiseId}` 쿠키가 있고 그 세션이 미만료이며 active 참여자의 것이면 409 `ALREADY_PARTICIPANT`. 쿠키가 없거나 무효·만료·cancelled 참여자면 401을 내지 않고 진행한다 (`session-auth.ts`의 선택적 확인 `findActivePromiseSession`, 판정 시각은 DB `clock_timestamp()`).
5. PIN 해시를 계산한다 (잠금 전).

트랜잭션

6. `SELECT ... FROM promises WHERE id = $1 FOR UPDATE` (링크 행은 잠그지 않음). 판정 시각은 **잠금 후 `clock_timestamp()`**.
7. cancelled → 409 `PROMISE_CANCELLED`.
8. draft: `created_at + 10분 ≤ 판정 시각`이면 410 `DRAFT_EXPIRED`(삭제 없음), 아니면 409 `PROMISE_NOT_OPEN` (MEMBER-03-02).
9. closed·confirmed → 409 `INVALID_PROMISE_STATE`.
10. 판정 시각 ≥ `voting_deadline_at` → 409 `DEADLINE_PASSED` (경계값 거절, 상태 변경 없음 — ERD 8.2, STATE-06-01).
11. `normalized_nickname`이 같은 참여자가 **상태와 관계없이(cancelled 포함)** 있으면 409 `NICKNAME_TAKEN` (MEMBER-05-06).
12. active 참여자 수 ≥ `participant_limit` → 409 `PROMISE_FULL`.
13. `participants`(role = member, status = active) 생성 → 세션 발급 → 커밋. 생성 중 UNIQUE 위반(P2002)도 409 `NICKNAME_TAKEN`.

**닉네임 검사를 정원 검사보다 먼저 하는 이유:** 마지막 자리를 차지한 사람이 응답을 받지 못하고 같은 닉네임으로 재시도하면, 정원을 먼저 볼 경우 `PROMISE_FULL`을 받아 본인이 이미 등록됐다는 사실을 알 수 없다. 닉네임을 먼저 보면 `NICKNAME_TAKEN`을 받아 로그인 복구(MEMBER-API-04, MEMBER-API-00 6절)로 넘어갈 수 있다. 정원이 찬 약속에서 남의 닉네임과 겹친 신규 사용자도 `NICKNAME_TAKEN`을 받지만, 어느 쪽이든 등록은 거절되므로 결과는 같다.

#### 보안 정보

- **응답 유실 복구:** `NICKNAME_TAKEN`은 남이 썰 경우와 본인이 이미 등록해 놓고 응답만 못 받은 경우를 구분할 수 없다. 클라이언트는 같은 닉네임·PIN으로 MEMBER-API-04를 호출해 본인 여부를 판별한다 (MEMBER-API-00 6장).
- 등록과 로그인은 별도 엔드포인트다. 이미 존재하는 닉네임으로 등록을 시도해도 **PIN을 검증해 로그인시키지 않는다.** 그렇게 하면 등록 폼이 PIN 대입 공격 경로가 된다. 닉네임 중복 시 로그인 화면(MEMBER-API-04)으로 안내한다.
- PIN·세션 토큰 원문은 로그와 응답 본문 어디에도 남기지 않는다. 세션 토큰은 쿠키로만 내려준다.
- 등록 요청도 IP 기준 레이트 리밋을 둔다. **[제안]**
- 참여 제외만으로는 동일인이 새 닉네임으로 재가입하는 것을 막지 못한다. 비회원 구조의 한계로 명시된 사항이다 (ERD 9).

---

## MEMBER-API-04 — 참여자 재인증 (로그인)

`POST /api/v1/promises/:promiseId/auth/session`

다른 기기·브라우저에서 닉네임·PIN으로 기존 참여자로 다시 로그인.

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-04-01, MEMBER-04-02, MEMBER-06-01, MEMBER-06-03, MEMBER-06-04(미정), MEMBER-06-02(미정)
- 권한: 누구나 (닉네임·PIN을 아는 사람)
- 허용 상태: draft(생성 후 10분 이내) / collecting / closed / confirmed — 조회는 마감 후에도 가능해야 하므로 로그인 자체는 막지 않는다 (STATE-06-02: 조회 가능, 수정 불가). cancelled는 409 `PROMISE_CANCELLED`, 10분 지난 draft는 410 `DRAFT_EXPIRED`(삭제 없음)
- 상태 전환: 없음
- 동시성: 약속 잠금 불필요 (읽기 + 세션 생성만). 판정 시각은 DB `clock_timestamp()`
- TBD: **MEMBER-06-04 (PIN 반복 실패 제한 정책)**, **MEMBER-06-02 (PIN 분실 복구)** — 둘 다 본문 미작성이라 아래 제한값은 제안안

### 1. 기본 정보

- **목적:** 이미 등록된 참여자가 다른 기기·브라우저에서 닉네임·PIN으로 본인임을 확인하고 세션을 받는다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/auth/session`
- **Authentication Required:** 아니요 (이 요청이 인증 요청)
- **Content Type:** `application/json`

기기별 로그인 상태는 따로 유지되며 **여러 기기 동시 로그인을 허용**한다 (MEMBER-04-02, ERD 3.5).

### 요청

- 헤더: `Content-Type: application/json`, `Origin` 필수
- Request Body

| 이름     | 타입   | 설명                                           | 필수 |
| -------- | ------ | ---------------------------------------------- | ---- |
| nickname | string | 등록 때와 동일한 정규화 규칙을 적용해 조회한다 | O    |
| pin      | string | 숫자 4자리                                     | O    |

요청 예시

```json
{ "nickname": "혜승", "pin": "1357" }
```

### 응답

#### Status Code: 200 OK

| 이름             | 타입              | 설명                                                                                                              |
| ---------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| participantId    | string (uuid)     | 본인 참여자 ID                                                                                                    |
| nickname         | string            | 표시용 닉네임                                                                                                     |
| role             | string            | host \| member                                                                                                    |
| status           | string            | active \| cancelled                                                                                               |
| promiseStatus    | string            | 로그인 직후 클라이언트가 화면을 고를 수 있도록 함께 반환                                                          |
| sessionExpiresAt | string (ISO 8601) | 세션 만료 시각. draft면 발급 시각 + 24시간, 그 외에는 링크 만료 기준 시각 + 7일 (MEMBER-06-03, MEMBER-API-00 5.2) |

응답 헤더: `Set-Cookie: ys_session_{promiseId}=...`

Response Body

```json
{
  "participantId": "2d81c6b7-7f54-4a19-b0c8-3e5a1f9d4b22",
  "nickname": "혜승",
  "role": "member",
  "status": "active",
  "promiseStatus": "collecting",
  "sessionExpiresAt": "2026-10-26T23:00:00+09:00"
}
```

### 에러

| HTTP 상태 | code                  | 발생 원인                                                                           | message 예시                            |
| --------- | --------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| 400       | INVALID_REQUEST       | JSON 파싱 실패, 필드 누락·문자열 아님, promiseId가 UUID 형식이 아님                 | 요청 형식이 올바르지 않습니다.          |
| 401       | INVALID_CREDENTIALS   | 닉네임 없음 또는 PIN 불일치 (구분 없음)                                             | 닉네임 또는 PIN이 올바르지 않습니다.    |
| 403       | INVALID_ORIGIN        | `Origin` 헤더 없음 또는 서비스 도메인과 다름 (MEMBER-API-00 7절)                    | 허용되지 않은 요청 출처입니다.          |
| 403       | PARTICIPANT_CANCELLED | 탈퇴했거나 내보내진 참여자 (PIN 인증 성공 후 판정)                                  | 참여가 종료된 계정입니다.               |
| 404       | PROMISE_NOT_FOUND     | 존재하지 않는 약속                                                                  | 약속을 찾을 수 없습니다.                |
| 409       | PROMISE_CANCELLED     | cancelled 약속 (STATE-10-01)                                                        | 취소된 약속입니다.                      |
| 410       | DRAFT_EXPIRED         | 생성 후 10분 지난 draft (STATE-02-02). 약속 기준 API 공통 코드, 삭제는 하지 않음    | 설정 시간이 지나 약속이 만료되었습니다. |
| 410       | ACCESS_PERIOD_EXPIRED | 링크 만료 기준 시각 + 7일 ≤ 판정 시각 (draft 제외)                                  | 접근 기간이 지난 약속입니다.            |
| 422       | VALIDATION_FAILED     | 닉네임(등록과 같은 규칙: trim → NFC, 2~12자, 이모지 불가)·PIN(숫자 4자리) 형식 위반 | 닉네임은 2자 이상 12자 이하여야 합니다. |

429는 반환하지 않는다 (아래 보안 정보, 2026-10-12 결정).

### 처리 순서 / 비고

#### 처리 순서

1. `Origin` 검증 → 실패 시 403 `INVALID_ORIGIN`.
2. 본문 파싱·필드 확인 → 400. 닉네임은 `normalizeNickname`(trim → NFC)을 거쳐 등록과 같은 규칙으로 검증하고, PIN 형식과 함께 위반 시 422.
3. promiseId가 UUID 형식이 아니면 400 `INVALID_REQUEST`(2026-11-04 변경, 이전 404 — 약속 기준 API는 STATE 명세와 같이 400, R-12), 약속이 없으면 404 `PROMISE_NOT_FOUND`.
4. **약속 상태 판정 (PIN 검증보다 먼저, 약속 잠금 없음, 판정 시각은 DB `clock_timestamp()`).**
   - cancelled → 409 `PROMISE_CANCELLED`
   - draft이고 `created_at + 10분 ≤ 판정 시각` → 410 `DRAFT_EXPIRED`(2026-11-04 변경, 이전 404). 이 API는 잠그지 않으므로 삭제는 하지 않는다 (삭제는 잠금을 잡는 MEMBER-API-02·STATE-API-02 몫)
   - draft가 아니면 `linkExpiryBase + 7일 ≤ 판정 시각` → 410 `ACCESS_PERIOD_EXPIRED` (아래 "로그인 가능 기간")
5. `participants`에서 `(promise_id, normalized_nickname)`로 조회.
6. 행이 없거나 PIN 해시 불일치면 **둘 다 동일하게 401 INVALID_CREDENTIALS**. 어느 쪽이 틀렸는지 구분해 알려주지 않는다 (ERD 9). 행이 없을 때도 같은 scrypt 매개변수의 더미 해시와 비교해 응답 시간을 비슷하게 유지한다. 실패 반환 지점은 한 곳이다.
7. `status = cancelled`이면 403 `PARTICIPANT_CANCELLED`.
8. 새 세션 행을 생성하고 쿠키를 발급한다. 기존 기기의 세션은 그대로 둔다 (MEMBER-04-02). 판정 직후 약속이 삭제되어 세션 저장이 외래 키 오류(P2003)로 실패하면 404 `PROMISE_NOT_FOUND`.

#### 세션 만료

| 약속 상태                   | `expires_at`                  | 쿠키 Max-Age                   |
| --------------------------- | ----------------------------- | ------------------------------ |
| draft (10분 이내)           | 발급 시각(판정 시각) + 24시간 | 86400                          |
| collecting·closed·confirmed | `linkExpiryBase + 7일`        | `expires_at`까지 남은 초(내림) |

쿠키 속성은 MEMBER-API-02와 같은 모듈(`sessionCookie`)로 만든다.

#### 로그인 가능 기간 = 링크 유효 기간

closed·confirmed에서도 로그인을 허용하지만, 세션 만료가 이미 지난 시각으로 발급되면 로그인 성공 즉시 만료된 세션이 된다. 그래서 **로그인 가능 기간을 링크 유효 기간과 같게 둔다**: 판정 시각이 `linkExpiryBase + 7일` 이후면 인증 자체를 **410 `ACCESS_PERIOD_EXPIRED`** 로 거절한다. 기준 시각은 MEMBER-API-01과 같은 함수(`linkExpiryBase`)로 고른다 — confirmed는 `confirmed_start_at`, 그 외는 `voting_deadline_at`(재조율 중이면 새 마감). 따라서 확정된 약속은 마감 + 7일이 지나도 `confirmed_start_at + 7일` 전이면 로그인할 수 있다.

이는 7일을 "로그인 유지 기간"이 아니라 "본인 입력에 접근할 수 있는 기간"으로 해석한 결과다. **확정 (2026-11-04, DECISION_CONFLICTS R-11).** 확정 시 기존 세션 갱신과 조기 마감 기준 차이는 미결로 남아 있다 (R-11).

#### 보안 정보

- **4자리 PIN은 1만 가지뿐이다.** 해시는 원문 저장을 피하는 수단이지 짧은 PIN을 강하게 만드는 수단이 아니다. **시도 제한이 없으면 사실상 무방비 상태**다 (ERD 9).
- **2026-10-12 결정: MVP에서는 시도 제한을 구현하지 않는다.** 따라서 이 API는 429를 반환하지 않는다.
- **남아 있는 위험:** 제한이 없으면 공격자가 한 닉네임에 대해 0000~9999를 순차 시도해 **평균 5천회 안에 로그인할 수 있다.** 성공하면 타인의 가능 시간을 수정하거나, 그 사람이 방장이면 약속 확정·취소까지 가능하다. 링크가 단추방에 공개된다는 점을 감안하면 실제 공격 난이도는 낮다.
- **공개 배포 전 필수 재검토 항목으로 남긴다** (DECISION_CONFLICTS R-11). 나중에 넣는다면 서버 코드 변경 없이 미들웨어만 추가하면 되도록, 이 엔드포인트의 실패 응답 경로를 한 곳으로 모아둔다. 제한을 도입할 때의 제안값은 참여자 5회/15분, IP 1분 10회이다 (MEMBER-06-04 미정).
- 실패 메시지는 항상 동일하게 유지해 닉네임 존재 여부가 드러나지 않게 한다.
- PIN·세션 토큰은 로그에 남기지 않는다.
- **PIN 분실 복구 수단은 없다(MEMBER-06-02 미정).** 닉네임만으로 초기화해주거나 방장 권한을 넘겨주는 우회로를 만들어서는 안 된다 (ERD 9).

---

## MEMBER-API-05 — 내 참여 정보 조회

`GET /api/v1/promises/:promiseId/me`

세션 쿠키로 본인의 참여자 정보·권한·제출 상태를 확인.

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-04-02, MEMBER-06-03, STATE-01-01, STATE-06-02
- 권한: **본인 세션** 필요
- 허용 상태: 전체 (cancelled 포함 — 취소 안내 화면에도 본인 정보가 필요). 단 **탈퇴한 본인은 세션이 삭제되므로 401**
- 상태 전환: 없음
- 동시성: 잠금 불필요 (읽기 전용)
- TBD: 없음

### 1. 기본 정보

- **목적:** 페이지 진입 시 내가 누구인지, 방장인지, 제출을 끝냈는지, 지금 무엇을 할 수 있는지를 한 번에 확인한다.
- **HTTP Method:** GET
- **Endpoint:** `/api/v1/promises/{promiseId}/me`
- **Authentication Required:** 예 (세션 쿠키)
- **Content Type:** `application/json`

### 요청

헤더

| Name   | Value                      | 필수 |
| ------ | -------------------------- | ---- |
| Cookie | ys_session_{promiseId}=... | O    |

Request Body: 없음

### 응답

#### Status Code: 200 OK

| 이름                    | 타입              | 설명                                                                                           |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| participantId           | string (uuid)     | 본인 참여자 ID                                                                                 |
| nickname                | string            | 표시용 닉네임                                                                                  |
| role                    | string            | host \| member. **클라이언트는 이 값을 표시용으로만 쓴다.** 권한 판정은 항상 서버가 다시 한다  |
| status                  | string            | active \| cancelled                                                                            |
| availabilitySubmittedAt | string \| null    | 제출 완료 시각. null이면 미제출 (ERD 3.3)                                                      |
| promiseStatus           | string            | draft \| collecting \| closed \| confirmed \| cancelled                                        |
| deadlinePassed          | boolean           | 서버 현재 시각 기준 마감 경과 여부. 상태가 아직 collecting이더라도 true일 수 있다 (TIME-15-04) |
| permissions             | object            | 화면 제어용 헌트. canEditAvailability / canSubmit / canManagePromise / canLeave                |
| sessionExpiresAt        | string (ISO 8601) | 현재 세션 만료 시각                                                                            |

Response Body

```json
{
  "participantId": "2d81c6b7-7f54-4a19-b0c8-3e5a1f9d4b22",
  "nickname": "혜승",
  "role": "member",
  "status": "active",
  "availabilitySubmittedAt": null,
  "promiseStatus": "collecting",
  "deadlinePassed": false,
  "permissions": {
    "canEditAvailability": true,
    "canSubmit": true,
    "canManagePromise": false,
    "canLeave": true
  },
  "sessionExpiresAt": "2026-10-26T23:00:00+09:00"
}
```

#### permissions 산정 규칙

| 헌트                | true 조건                                                                                                       | 근거                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| canEditAvailability | status=active 그리고 promiseStatus=collecting 그리고 마감 전                                                    | STATE-06-02                             |
| canSubmit           | canEditAvailability와 동일                                                                                      | STATE-06-02                             |
| canManagePromise    | role=host 그리고 status=active 그리고 promiseStatus≠cancelled                                                   | STATE-10-01                             |
| canLeave            | status=active 그리고 promiseStatus≠cancelled. 마감 후에도 본인 탈퇴는 가능하며, 방장도 true (자동 승계 후 탈퇴) | STATE-06-01, MEMBER-12-01, MEMBER-12-03 |

**방장도 `canLeave`는 true다.** 방장이 탈퇴하면 방장 권한은 **방장을 제외한 active 참여자 중 `participants.created_at`이 가장 이른 사람에게 자동으로 넘어간 뒤** 탈퇴가 처리된다 (MEMBER-12-01, MEMBER-12-03). 방장이 대상을 직접 고르지 않으므로 **수동 위임 API는 만들지 않는다.**

승계 규칙 요약 (MEMBER-12-01)

- 대상: active 참여자만. 탈퇴·내보내진 사람은 제외하며 **제출 여부는 무관**하다.
- 정렬: `created_at` 오름차순, 같으면 `participants.id` 순.
- 대상이 한 명도 없으면 **약속을 취소**한다 (MEMBER-12-04).
- 기존 host를 member로 내리고 새 host를 올리는 것을 **한 트랜잭션**으로 처리하고, `role = 'host'`에 대한 부분 UNIQUE 인덱스로 방장 중복을 막는다 (ERD 4.1).
- 새 방장에게 권한 이전 사실을 화면에서 알린다. 폴링 응답에 `role`을 포함하므로 새로고침 없이 관리 버튼이 나타난다.

실제 탈퇴 엔드포인트는 아직 명세하지 않았다 — 후속 작업.

### 에러

| HTTP 상태 | code              | 발생 원인                                                                | message 예시             |
| --------- | ----------------- | ------------------------------------------------------------------------ | ------------------------ |
| 401       | UNAUTHENTICATED   | 쿠키 없음·만료·해시 불일치, 또는 탈퇴·내보내기로 서버 세션이 삭제된 경우 | 로그인이 필요합니다.     |
| 403       | FORBIDDEN         | 세션의 참여자가 이 약속 소속이 아님                                      | 접근 권한이 없습니다.    |
| 404       | PROMISE_NOT_FOUND | 존재하지 않는 promiseId                                                  | 약속을 찾을 수 없습니다. |

### 처리 순서 / 비고

#### 보안 정보

- 쿠키가 유효해도 **매 요청마다** 세션 만료, 참여자 status, 약속 상태를 다시 읽는다 (ERD 3.5).
- **탈퇴·내보내기 시 서버 세션을 전부 즉시 만료하므로(MEMBER-10-03, ERD 3.5 — 행은 남기고 `expires_at`을 현재 시각으로 변경, 2026-11-10 문구 정리 R-31) 브라우저에 쿠키가 남아 있어도 유효한 인증이 아니다. 탈퇴자의 `/me`는 401로 응답한다.** 탈퇴 완료 안내는 탈퇴 API의 응답과 화면에서 처리하고, `/me`가 탈퇴자를 조회해주는 경로는 두지 않는다.
- 따라서 응답의 `status` 필드는 사실상 항상 active다. cancelled는 세션이 살아있는 경계 상황(예: 삭제 직전 동시 요청)에서만 잠시 나타나며, 그 경우에도 모든 permissions는 false다.
- 다른 약속의 쿠키로 접근하는 것을 막기 위해 쿠키 Path를 약속별로 제한하고, 서버도 `participants.promise_id`와 경로의 promiseId를 대조한다.

---

## MEMBER-API-06 — 참여자 명단 조회

`GET /api/v1/promises/:promiseId/participants`

등록한 참여자에게 정원과 참여자 명단을 공개. 제출 여부는 표시하지 않는다.

> 2026-10-12 1차 리뷰 반영: `includeCancelled` 파라미터 삭제(근거 규칙 없음, API Ticket과도 불일치).

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-07-02, MEMBER-08-01, MEMBER-08-02, MEMBER-08-03, MEMBER-03-01
- 권한: **등록한 참여자만** (세션 필요). 링크만 가진 비참여자는 볼 수 없다 (MEMBER-08-01)
- 허용 상태: collecting / closed / confirmed. draft는 403(방장 포함), cancelled는 409 `PROMISE_CANCELLED`(세션보다 우선)
- 상태 전환: 없음
- 동시성: 잠금 불필요 (읽기 전용)
- TBD: MEMBER-08-01 — collecting 이후 비참여자 공개 범위가 본문 미작성. 여기서는 **비참여자 비공개**로 두었다

### 1. 기본 정보

- **목적:** 등록한 참여자가 누가 함께하는지와 정원 현황을 확인한다.
- **HTTP Method:** GET
- **Endpoint:** `/api/v1/promises/:promiseId/participants`
- **Authentication Required:** 예 (세션 쿠키)
- **Content Type:** `application/json`

**제출 여부를 명단에 표시하지 않는다.** 제출하지 않은 참여자는 시간표에서 모든 시간에 불가능으로 보일 뿐이다 (MEMBER-08-02).

**active 참여자만 반환한다.** 탈퇴·내보내진(cancelled) 참여자는 명단에 포함하지 않고, 그들의 입력도 다른 사람에게 보이지 않는다 (MEMBER-08-03). 탈퇴 기록 조회가 필요하다면 누가 어떤 목적으로 보는지를 별도 요구사항으로 먼저 정한다.

### 요청

헤더

| Name   | Value                      | 필수 |
| ------ | -------------------------- | ---- |
| Cookie | ys_session_{promiseId}=... | O    |

- Query 파라미터: 없음
- Request Body: 없음

### 응답

#### Status Code: 200 OK

| 이름                         | 타입          | 설명                                                                                                               |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| participantLimit             | number        | 방장 포함 정원 (ERD promises.participant_limit)                                                                    |
| currentParticipantCount      | number        | active 참여자 수. 방장·미제출자 포함, 탈퇴·내보내진 사람 제외 (MEMBER-07-02). `participants` 배열 길이와 항상 같다 |
| participants                 | array         | 등록순(created_at 오름차순). active만 포함                                                                         |
| participants[].participantId | string (uuid) | 참여자 ID                                                                                                          |
| participants[].nickname      | string        | 표시용 닉네임                                                                                                      |
| participants[].role          | string        | host 또는 member                                                                                                   |
| participants[].isMe          | boolean       | 요청한 본인 여부                                                                                                   |

**응답에 포함하지 않는 값**

- `availabilitySubmittedAt` / 제출 여부 — MEMBER-08-02에 따라 비공개
- `status` — active만 반환하므로 의미가 없다
- PIN 해시, 세션 정보, 정규화 닉네임

Response Body

```json
{
  "participantLimit": 6,
  "currentParticipantCount": 4,
  "participants": [
    { "participantId": "b9a4c7e1-...", "nickname": "승주", "role": "host", "isMe": false },
    { "participantId": "2d81c6b7-...", "nickname": "혜승", "role": "member", "isMe": true },
    { "participantId": "7f20a3dd-...", "nickname": "철수", "role": "member", "isMe": false },
    { "participantId": "c4e9b812-...", "nickname": "영희", "role": "member", "isMe": false }
  ]
}
```

### 에러

| HTTP 상태 | code              | 발생 원인                                                                                                | message 예시                   |
| --------- | ----------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 400       | INVALID_REQUEST   | promiseId 형식 오류                                                                                      | 요청 형식이 올바르지 않습니다. |
| 401       | UNAUTHENTICATED   | 등록하지 않은 사람의 요청(쿠키 없음·위조·만료), 또는 탈퇴로 세션이 즉시 만료된 경우 (MEMBER-08-01, C-07) | 참여 등록 후 볼 수 있습니다.   |
| 403       | FORBIDDEN         | draft 상태(방장 포함, MEMBER-03-01), 또는 다른 약속의 세션                                               | 방장이 약속을 설정 중입니다.   |
| 404       | PROMISE_NOT_FOUND | 존재하지 않는 promiseId                                                                                  | 약속을 찾을 수 없습니다.       |
| 409       | PROMISE_CANCELLED | cancelled 약속 (STATE-10-01). 세션 검사보다 먼저 판정한다                                                | 취소된 약속입니다.             |

> 2026-11-09 구현 반영(R-29): 409 코드를 `INVALID_PROMISE_STATE`에서 다른 세션 API와 같은 `PROMISE_CANCELLED`로 바꿨다(R-11). draft는 방장도 403이다.

### 처리 순서 / 비고

#### **구현 결정 (2026-11-09, DECISION_CONFLICTS R-29)**

- 검사 순서: promiseId 400 → 404 → 409 `PROMISE_CANCELLED`(세션보다 우선) → 401 → 403(다른 약속) → 트랜잭션 안 약속 재확인(사라짐 404·cancelled 409) → 세션·참여자 재확인 401 → draft 403. 공통 인증 모듈 `session-auth.ts` 순서를 따른다.
- REPEATABLE READ 읽기 트랜잭션 하나에서 약속·세션·참여자를 읽고 잠그지 않는다. DB를 바꾸지 않는다. 마감 지난 collecting은 다른 GET처럼 closed로 볼 수 있지만, 두 상태 모두 허용이고 응답에 상태가 없어 따로 계산하지 않는다.
- 명단: `status='active'`만, `created_at ASC, id ASC`. `role`은 트랜잭션에서 읽은 최신 값이라 방장 승계가 반영된다. `currentParticipantCount`는 배열 길이다.
- draft는 10분 경과와 관계없이 방장을 포함해 403 `FORBIDDEN`이며 삭제하지 않는다. 방장의 draft 정보는 STATE-API-01로 본다.
- 인증 성공 뒤 모든 응답에 쿠키를 다시 보낸다(인증 뒤 세션이 사라지면 Max-Age=0). 모든 응답 `Cache-Control: no-store`. GET이라 Origin을 검사하지 않는다.

#### 보안 정보

- 명단은 개인을 식별할 수 있는 정보다. 등록하지 않은 사람에게는 공개하지 않는다.
- 참여자별 가능 시간은 등록한 참여자에게 모두 공개되며(MEMBER-08-03), 이는 TIME 도메인 API에서 다룬다.
- 세션의 참여자가 경로의 promiseId에 속하는지 매 요청 확인한다.

---

## MEMBER-API-07 — 로그아웃

`DELETE /api/v1/promises/:promiseId/auth/session`

현재 기기의 세션만 종료. 참여 자체는 유지된다 (탈퇴 아님).

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-04-02, MEMBER-06-03
- 권한: 본인 세션
- 허용 상태: 전체
- 상태 전환: 없음 (참여자 status 변경 없음)
- 동시성: 잠금 불필요
- TBD: 없음

### 1. 기본 정보

- **목적:** 공용 PC 등에서 현재 기기의 로그인 상태만 끊는다.
- **HTTP Method:** DELETE
- **Endpoint:** `/api/v1/promises/{promiseId}/auth/session`
- **Authentication Required:** 예 (세션 쿠키)
- **Content Type:** 없음 (본문 없음)

**로그아웃은 탈퇴가 아니다.** 참여자 행·입력한 가능 시간·제출 상태는 그대로 남으며, 닉네임·PIN으로 다시 로그인할 수 있다 (MEMBER-04-02). 탈퇴는 별도 API(MEMBER-10-xx 범위)다.

### 요청

헤더

| Name   | Value                      | 필수 |
| ------ | -------------------------- | ---- |
| Cookie | ys_session_{promiseId}=... | O    |
| Origin | 서비스 도메인              | O    |

Query 파라미터

| 이름       | 타입    | 설명                                                              | 필수 | 기본값 |
| ---------- | ------- | ----------------------------------------------------------------- | ---- | ------ |
| allDevices | boolean | true면 해당 참여자의 모든 세션을 삭제한다 (ERD 3.5 전체 로그아웃) | X    | false  |

Request Body: 없음

### 응답

#### Status Code: 204 No Content

응답 본문은 없다. 만료 쿠키를 내려 브라우저 측 쿠키를 제거한다.

```
Set-Cookie: ys_session_{promiseId}=; HttpOnly; Secure; SameSite=Lax;
            Path=/api/v1/promises/{promiseId}; Max-Age=0
```

### 에러

| HTTP 상태 | code              | 발생 원인                                                                                      | message 예시                      |
| --------- | ----------------- | ---------------------------------------------------------------------------------------------- | --------------------------------- |
| 400       | INVALID_REQUEST   | promiseId 형식 오류, 또는 allDevices가 `true`·`false` 한 개가 아님(`1`·`TRUE`·빈 값·반복 포함) | 요청 형식이 올바르지 않습니다.    |
| 401       | UNAUTHENTICATED   | 이 약속의 세션 쿠키가 아예 없는 경우. 이미 만료된 쿠키·행이 없는 쿠키는 204로 처리한다         | 다시 로그인해 주세요.             |
| 403       | FORBIDDEN         | 쿠키의 세션이 다른 약속 소속. 그 세션은 지우지 않는다                                          | 이 작업을 수행할 권한이 없습니다. |
| 403       | INVALID_ORIGIN    | Origin 없음·불일치                                                                             | 허용되지 않은 요청 출처입니다.    |
| 404       | PROMISE_NOT_FOUND | 존재하지 않는 promiseId                                                                        | 약속을 찾을 수 없습니다.          |

> 2026-11-10 구현 반영(R-31): 400·403 두 종류를 추가했다. 401 메시지는 다른 세션 API와 같은 공통 헬퍼 문구다. 취소된 약속도 409가 아니라 204다(아래 구현 결정).

### 처리 순서 / 비고

#### 처리 순서

1. 쿠키에서 세션 토큰을 꺼내 해시로 `participant_sessions` 행을 찾는다.
2. allDevices=false면 해당 행만, true면 같은 `participant_id`의 모든 행을 삭제한다.
3. 행이 이미 없거나 만료되었어도 **204를 반환**한다 (멱등성). 쿠키는 같은 방식으로 만료시킨다.

#### 보안 정보

- 세션 행을 실제로 삭제한다. 쿠키만 지우고 서버 세션을 남기면 탈취된 토큰이 계속 유효해진다.
- ~~참여자가 내보내지거나 탈퇴할 때는 서버가 해당 참여자의 세션을 **전부** 삭제한다 (ERD 3.5).~~ → 탈퇴·내보내기는 세션 행을 **삭제하지 않고** `expires_at`을 현재 시각으로 바꿔 즉시 만료한다(ERD 3.5, API_CONVENTIONS 5.2, R-28·R-30). 행 삭제는 명시적 로그아웃(이 API)과 draft 폐기뿐이다(2026-11-10 정리, R-31).
- PIN 변경 시 기존 세션 폐기 정책은 **MEMBER-09-01 미정**이라 이번 범위에서 제외했다.

#### **구현 결정 (2026-11-10, DECISION_CONFLICTS R-31)**

- 검사 순서: Origin 403 `INVALID_ORIGIN` → promiseId 형식 400 → allDevices 형식 400 → 약속 존재 404 → `ys_session_{promiseId}` 쿠키 없음 401 → 토큰 해시로 세션·참여자를 `clock_timestamp()`와 한 문장으로 읽음 → 행 없음 204 → 다른 약속 소속 403 `FORBIDDEN`(삭제 없음) → 삭제 → 204.
- 공통 세션 인증(`session-auth.ts`)을 쓰지 않는다. 로그아웃은 브라우저 쿠키를 정리하는 동작이라 **취소된 약속도 409 `PROMISE_CANCELLED`가 아니라 204와 쿠키 제거**다(R-11 예외). 만료 세션·탈퇴·내보내진 참여자의 남은 쿠키도 204로 자기 행을 지운다.
- **allDevices=true는 아직 유효한 세션(만료 전·active 참여자)으로만 한다.** 만료된 쿠키나 cancelled 참여자의 쿠키는 allDevices=true여도 자기 행만 지운다 — 유출된 옛 토큰으로 다른 기기의 로그인을 끊지 못하게 한다. 응답은 똑같이 204다. 만료 경계는 다른 세션 API와 같다(`expires_at ≤ 판정 시각`이면 만료).
- 잠금을 잡지 않는다(명세 「동시성: 잠금 불필요」). 다른 세션 API는 인증 뒤 행이 사라지면 잠금 후(또는 읽기 트랜잭션 안) 재확인에서 401·쿠키 Max-Age=0으로 응답한다. 재확인 없이 끝나는 요청(설정 완료·본문 형식 400 등)이 로그아웃과 겹치면 그 응답이 지워진 토큰으로 쿠키를 다시 심을 수 있으나, 행이 없으므로 다음 요청은 401이다.
- 쿠키: 204만 `Max-Age=0`. 400·401·403·404는 쿠키를 건드리지 않는다(세션 인증에 성공한 요청이 아니다). 쿠키 이름·Path는 DB의 약속 id(소문자)로 만든다.
- 데이터: 참여자 행·슬롯·제출 시각·버전·role은 그대로다. 같은 닉네임·PIN으로 다시 로그인(MEMBER-API-04)하면 새 세션이 생긴다.

---

## MEMBER-API-08 — 참여자 내보내기

`DELETE /api/v1/promises/{promiseId}/participants/{participantId}`

방장이 다른 참여자를 약속에서 제외한다. 데이터는 물리 삭제하지 않는다.

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-10-03, MEMBER-11-02, STATE-06-01, ERD 6.2
- 권한: **해당 약속의 active 방장만**
- 허용 상태: **collecting이고 현재 시각 < 마감일 때만.** draft·closed·confirmed·cancelled는 409
- 상태 전환: 약속 상태는 변하지 않음
- 동시성: 필수. `promises` 행을 FOR UPDATE로 잠근 뒤 권한·상태·마감·대상을 재검사

### 1. 기본 정보

- **목적:** 방장이 다른 참여자를 약속에서 제외한다. 데이터는 물리 삭제하지 않는다.
- **Method:** DELETE
- **Endpoint:** `/api/v1/promises/{promiseId}/participants/{participantId}`
- **Authentication Required:** 예

### 요청

헤더

| Name   | Value                      | 필수 |
| ------ | -------------------------- | ---- |
| Cookie | ys_session_{promiseId}=... | O    |
| Origin | 서비스 도메인              | O    |

본문 없음(보내도 읽지 않는다).

대상은 경로의 `participantId`로만 지정

### 응답

Response Body (`200 OK`)

```json
{
  "participantId": "7f20a3dd-...",
  "participantStatus": "cancelled",
  "currentParticipantCount": 3,
  "participantLimit": 6
}
```

### 에러

요청이 실패하면 해당 **HTTP 상태 코드**와 함께 아래 형태의 JSON이 반환됩니다. error 필드는 상황에 따라 생략될 수 있습니다.

| HTTP 상태 | code                  | 발생 원인                                                                                               | message 예시                                              |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 400       | INVALID_REQUEST       | promiseId 또는 participantId 형식 오류                                                                  | 요청 형식이 올바르지 않습니다.                            |
| 401       | UNAUTHENTICATED       | 세션 없음·위조·만료, 또는 요청자가 cancelled(탈퇴·승계로 세션 만료)                                     | 다시 로그인해 주세요.                                     |
| 403       | FORBIDDEN             | 잠금 후 다시 읽은 role이 host가 아님, 또는 다른 약속의 세션                                             | 이 작업을 수행할 권한이 없습니다.                         |
| 403       | INVALID_ORIGIN        | Origin 없음·불일치                                                                                      | 허용되지 않은 요청 출처입니다.                            |
| 404       | PROMISE_NOT_FOUND     | 존재하지 않는 promiseId                                                                                 | 약속을 찾을 수 없습니다.                                  |
| 404       | PARTICIPANT_NOT_FOUND | 대상이 없거나 다른 약속 소속(구분하지 않음)                                                             | 참여자를 찾을 수 없습니다.                                |
| 409       | PROMISE_CANCELLED     | cancelled 약속. 세션 검사보다 먼저 판정한다(R-11)                                                       | 취소된 약속입니다.                                        |
| 409       | INVALID_PROMISE_STATE | draft·closed·confirmed. details `{ promiseStatus, allowedStates: ["collecting"] }`. 재조율 후 처리 안내 | 현재 약속 상태에서는 요청할 수 없습니다.                  |
| 409       | DEADLINE_PASSED       | collecting이지만 판정 시각 ≥ 마감. 상태는 바꾸지 않는다                                                 | 응답 마감이 지났습니다.                                   |
| 409       | CANNOT_REMOVE_SELF    | 방장이 자신을 지정. 탈퇴 API로 안내                                                                     | 방장은 스스로를 내보낼 수 없습니다. 탈퇴를 이용해 주세요. |

> 2026-11-09 구현 반영(R-30): 에러 표를 다른 페이지와 같은 열 순서로 바꾸고 400·403 `INVALID_ORIGIN`·404 `PROMISE_NOT_FOUND`를 추가했다. cancelled는 `INVALID_PROMISE_STATE`가 아니라 `PROMISE_CANCELLED`다. 2번의 "아니면 403"은 요청자가 active가 아닌 경우 401이다(세션 인증 공통 기준).

```json
{
  "code": "CANNOT_REMOVE_SELF",
  "message": "방장은 스스로를 내보낼 수 없습니다. 탈퇴를 이용해 주세요."
}
```

### 처리 순서 / 비고

#### 처리 순서 (단일 트랜잭션)

1. `SELECT ... FROM promises WHERE id = $1 FOR UPDATE`
2. 세션 참여자의 최신 `role = 'host'`, `status = 'active'` 재확인. 아니면 403
3. 상태가 `collecting`이 아니면 409 `INVALID_PROMISE_STATE`
4. 잠금 후 `clock_timestamp()`가 `voting_deadline_at` 이상이면 409 `DEADLINE_PASSED`
5. 대상이 같은 약속 소속인지 확인. 아니면 404
6. 대상이 본인이면 409 `CANNOT_REMOVE_SELF`
7. 대상이 이미 `cancelled`면 데이터를 바꾸지 않고 현재 상태를 200으로 반환 (멱등)
8. 대상 `participants.status = 'cancelled'`, `cancelled_at = clock_timestamp()` **슬롯·제출 시각·닉네임·PIN 해시는 보존**하고 모든 active 집계에서만 제외
   내보낸 참여자의 슬롯은 보존하지만 `status != 'active'`이므로 후보 계산(ERD 7.1)과 히트맵 집계에서 제외된다.
9. 대상의 모든 세션은 **행 삭제 없이** `expires_at`을 현재 시각으로 변경
10. 커밋

#### **구현 결정 (2026-11-09, DECISION_CONFLICTS R-30)**

- 검사 순서: Origin 403 → promiseId·participantId 형식 400 → 404 → 409 `PROMISE_CANCELLED`(세션보다 우선) → 401 → 403(다른 약속 세션) → `promises` 행 `FOR UPDATE` → 잠금 후 `clock_timestamp()` → 사라짐 404·cancelled 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403 → 상태 409 → 마감 409 → 대상 404 → 본인 409 → 이미 cancelled면 변경 없이 200 → 저장. 잠금·재확인은 설정 변경·재조율과 같은 `lockPromiseAsHost`다.
- draft를 지우지 않으므로 `promises`만 잠근다(API_CONVENTIONS 4.1-3). 10분 지난 draft도 409 `INVALID_PROMISE_STATE`이고 삭제하지 않는다.
- 마감 경과: 참여자 등록(MEMBER-API-03, R-13)과 같이 **DB 상태를 closed로 바꾸지 않고** 409 `DEADLINE_PASSED`를 낸다. 경계는 판정 시각 = 마감이면 지난 것.
- 저장: 대상 `status='cancelled'`·`cancelled_at`=판정 시각, 대상의 아직 유효한 세션만 `expires_at`=판정 시각. 본인 탈퇴(STATE-API-08)의 일반 참여자 분기와 같은 함수(`cancelParticipant`)다. 슬롯·제출 시각·버전·닉네임·PIN 해시·role은 보존한다.
- 멱등: 대상이 이미 cancelled(먼저 내보냄·본인 탈퇴)면 `cancelled_at`·세션을 다시 쓰지 않고 현재 인원으로 200.
- 응답: `participantId`는 DB 값(소문자 UUID), `currentParticipantCount`는 저장 뒤 active 인원. 요청한 방장의 쿠키는 잠금 후 다시 읽은 세션 기준으로 모든 응답에서 갱신한다. 모든 응답 `Cache-Control: no-store`.
- 경로: 같은 위치의 정적 경로 `participants/me`(STATE-API-08)가 먼저 매칭되므로 `participantId`가 `me`인 요청은 이 API로 오지 않는다.

#### 보안 정보

- 요청의 `role`·`isHost`를 믿지 않고 잠금 후 DB에서 다시 읽는다
- 내보낸 사람은 닉네임 UNIQUE가 살아 있어 같은 닉네임으로 재참여할 수 없다 (MEMBER-API-03 6번과 동일 메커니즘). 다른 닉네임 재가입은 비회원 구조상 막지 못한다
- 응답에 다른 참여자의 PIN 해시·세션·슬롯을 포함하지 않는다
- `Cache-Control: no-store`

---

## MEMBER-API-09 — 초대 링크 발급 (웹)

`POST /api/v1/links`

웹 「새 약속 만들기」에서 초대 링크만 발급한다. 약속과 참여자는 만들지 않는다.

### 0. 규칙 연결

- 도메인: MEMBER
- 관련 규칙: MEMBER-01-01, MEMBER-02-01, STATE-02-01
- 관련 US: US-CREAT-04 약속 생성 및 초대 링크 발급
- 권한: **누구나** (인증 불필요)
- 허용 상태: 해당 없음 (약속이 생기기 전 단계)
- 상태 전환: 없음. 링크만 생성되고 약속은 MEMBER-API-02 성공 시 생성된다 (STATE-02-01)
- 동시성: 잠금 없음. `invite_token` UNIQUE 제약으로 중복을 막는다

### 1. 기본 정보

- **목적:** 웹에서 새 약속 링크를 발급하고 발급자를 방장 등록 화면으로 보낸다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/links`
- **Authentication Required:** 아니요
- **Content Type:** `application/json` (응답)

**링크만 발급한다.** 발급자는 응답의 `inviteUrl`(`/p/{inviteToken}`)로 곧바로 이동한다. 이동한 화면에서 MEMBER-API-01이 `unclaimed` + `register_host`를 돌려주면 MEMBER-API-02로 방장 등록을 한다. 링크를 발급한 사람이라도 다른 사람이 먼저 등록을 완료하면 그 사람이 방장이다 (MEMBER-02-01).

**챗봇 발급은 이 API를 호출하지 않는다.** 챗봇 스킬 서버 라우트가 같은 내부 발급 함수를 `source='kakao'`로 호출한다. 이 API는 항상 `source='web'`으로 저장한다.

### 요청

헤더

| Name   | Value         | 필수 |
| ------ | ------------- | ---- |
| Origin | 서비스 도메인 | O    |

Request Body: 없음. 본문을 보내도 무시한다. `source` 등 어떤 필드도 반영하지 않는다.

### 응답

#### Status Code: 201 Created

| 이름        | 타입   | 설명                                                                     |
| ----------- | ------ | ------------------------------------------------------------------------ |
| inviteToken | string | 발급된 초대 토큰                                                         |
| inviteUrl   | string | 서버가 `NEXT_PUBLIC_BASE_URL + "/p/" + inviteToken`으로 조립한 초대 주소 |
| nextAction  | string | 항상 `register_host`                                                     |

`promiseId`는 넣지 않는다. 아직 약속이 없기 때문이다.

Response Body

```json
{
  "inviteToken": "k3Zq8vTb1mRa",
  "inviteUrl": "http://localhost:3000/p/k3Zq8vTb1mRa",
  "nextAction": "register_host"
}
```

### 에러

| HTTP 상태 | code           | 발생 원인                                                                  | message 예시                   |
| --------- | -------------- | -------------------------------------------------------------------------- | ------------------------------ |
| 403       | INVALID_ORIGIN | `Origin` 헤더가 없거나 서비스 도메인과 다름. DB에 아무것도 저장하지 않는다 | 허용되지 않은 요청 출처입니다. |
| 500       | INTERNAL_ERROR | 토큰 중복으로 재시도까지 실패, 그 밖의 서버 오류                           | 처리 중 오류가 발생했습니다.   |

### 처리 순서 / 비고

#### 처리 순서

1. 암호학적 난수로 `inviteToken`을 생성한다.
2. `promise_links`에 `(invite_token, source='web')`을 삽입한다.
3. `invite_token` UNIQUE 위반이면 새 토큰으로 1회 재시도한다. 다시 실패하면 500 `INTERNAL_ERROR`.
4. 201로 응답한다.

잠금은 사용하지 않는다.

#### 내부 발급 함수

- 웹 라우트(이 API)와 챗봇 스킬 서버 라우트가 같은 내부 발급 함수를 쓴다. 웹은 `source='web'`, 챗봇은 `source='kakao'`를 서버 코드에서 고정값으로 넘긴다.
- `source`는 클라이언트 입력을 받지 않는다. 발급 출처 지표를 위조할 수 없게 하기 위해서다.

#### 보안 정보

- 토큰 기준은 MEMBER-API-01과 같다. 충분한 길이의 암호학적 난수를 사용한다.
- IP 기준 레이트 리밋을 둔다. **[제안]** 인증 없는 쓰기 API이므로 공개 배포 전 도입 여부를 다시 판단한다.
