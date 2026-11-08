# **STATE API 명세**

> 원본: Notion 「약속잡기」 › api 명세서 (2) (도메인 = STATE)
>
> 추출일: 2026-10-30
>
> 공통 규약은 이 문서의 STATE-API-00 참고. STATE-API-09는 내부 공통 가드이며 외부 호출 API가 아니다.
>
> 인증은 HttpOnly 세션 쿠키, URL 접두사는 `/api/v1`, 응답은 순수 JSON.

---

## **STATE-API-00 — 작성 가능한 STATE 공통 규약**

공통 규약 — 외부 호출 대상 아님

추가 결정 없이 작성 가능한 STATE API의 응답·권한·마감·후보 계산·ERD 매핑을 통일한다.

> 원문: [STATE-API-00](https://app.notion.com/p/STATE-API-00-3f87085f31828013ab20dcd75b849ed2?pvs=21)

### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-01-01, STATE-01-02, STATE-05-01, STATE-05-03, STATE-08-01
- 근거: 제공한 ERD 설명서 3·4·7·8절 및 위 Notion 규칙
- 권한: 각 API에 정의
- 허용 상태: 각 API에 정의
- 상태 전환: 다섯 상태 enum과 기존 허용 전환을 유지
- 동시성: 동일 약속의 변경은 promises 행을 먼저 잠금. 링크 경로에서는 기존 MEMBER의 promise_links → promises 잠금 순서 유지.
- TBD: 없음. 종료 시각 `24:00`은 API에서 허용하며 DB에는 `daily_end_minute=1440`으로 저장한다
- REVIEW-01~17에서 결정된 STATE 정책은 모두 반영
- 기존 공통 규약: [Notion 참고 문서](https://app.notion.com/p/MEMBER-API-00-3f67085f31828163a34ff6da7b3180a6?pvs=21)

### **1. 기본 정보**

- **목적:** 추가 결정 없이 작성 가능한 STATE API의 응답·권한·마감·후보 계산·ERD 매핑을 통일한다.
- **HTTP Method:** 없음 — 공통 계약 문서
- **Endpoint:** 없음 — 외부 호출 대상 아님
- **Authentication Required:** 해당 API의 약속별 세션
- **Content Type:** application/json; charset=utf-8

#### **작성 범위**

STATE-API-01~10을 작성했다. 01 조회, 02 모집 시작, 03 모집 중 설정 변경, 04 마감, 05 확정, 06 재조율, 07 취소, 08 본인 탈퇴·자동 승계, 09 MEMBER·TIME 공통 상태 가드, 10 공식 후보 조회로 구성한다. REVIEW-01~17과 기존 MEMBER 계약을 대조해 충돌을 해소했다. 기존 ERD에 없는 변경 이력·후보 캐시·host_participant_id는 임의로 추가하지 않는다.

설명서와 Notion 규칙이 충돌한 항목은 검토 DB의 확정 결정과 기존 MEMBER 계약을 적용한다.

### **요청**

- promiseId는 UUID이며 권한을 의미하지 않는다.
- 요청자 참여자 ID는 서버 세션에서 얻는다. body의 participantId·isHost·role을 신뢰하지 않는다.
- 모든 시각은 오프셋 포함 ISO 8601, 날짜 경계와 반복 하루 시각은 Asia/Seoul을 사용한다.
- 상세 요청 형식은 각 API의 「요청」 절에 정의한다.

### **응답**

성공은 래퍼 없는 객체, 오류는 code·message·선택적 details를 반환한다.

```json
{
  "code": "INVALID_PROMISE_STATE",
  "message": "현재 약속 상태에서는 요청할 수 없습니다.",
  "details": {
    "promiseStatus": "collecting",
    "allowedStates": [
      "closed"
    ]
  }
}
```

#### **ERD 대응**

| API 데이터 | DB 또는 계산 기준 |
| --- | --- |
| promiseStatus | GET 응답은 현재 시각을 반영한 effectiveStatus, 쓰기 응답은 트랜잭션 완료 후 promises.status |
| participantLimit | promises.participant_limit — 방장 포함 2~30명 |
| settings.dateRange | promises.date_range_start, date_range_end |
| settings.dailyTimeRange | promises.daily_start_minute, daily_end_minute을 HH:mm으로 변환. 종료에는 24:00 허용 |
| settings.durationMinutes | promises.duration_minutes |
| settings.votingDeadlineAt | promises.voting_deadline_at |
| 방장 판정 | 세션 참여자의 participants.role=host 및 status=active |
| 본인 제출 여부 | participants.availability_submitted_at — NULL이면 미제출; 기존 MEMBER-API-05가 조회 |
| currentConfirmation.startAt | promises.confirmed_start_at |
| currentConfirmation.endAt | confirmed_start_at + duration_minutes |
| 후보 인원·순위 | participant_available_slots와 제출 완료 active 참여자로 계산; 후보 테이블 없음 |

현재 ERD에 없는 host_participant_id·dateRangeLimitMonths·closedAt·closeReason·변경 이력·설정 전용 버전 필드를 기존 컬럼으로 가정하지 않는다. 설정 변경은 STATE-API-01의 settings 전체를 주기적으로 조회해 이전 값과 비교하여 감지한다.

#### **상태값**

| 상태 | 의미 |
| --- | --- |
| draft | 방장 설정 미완료 |
| collecting | 가능 시간 수집 |
| closed | 마감·일정 미확정 |
| confirmed | 일정 확정 |
| cancelled | 약속 취소 |

participants.status의 active·cancelled는 약속 상태 enum과 다른 값이다. 탈퇴 상태로 left를 추가하지 않는다.

#### **effectiveStatus**

`effectiveStatus`는 DB 컬럼이 아니라 현재 시각을 반영하여 계산하는 상태다.

- DB `status=collecting`이고 현재 시각이 `voting_deadline_at` 이상이면 `closed`
- 그 외에는 DB status와 동일
- GET 요청은 effectiveStatus만 계산하고 DB status를 변경하지 않음
- 쓰기 요청이 실제 status를 closed로 변경함
- GET 응답의 `promiseStatus`에는 effectiveStatus를 반환함

### **에러**

#### **취소 상태 오류**

약속이 `cancelled`이면 모든 일반 STATE API는 세션 인증 결과보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 응답에는 취소 사실 외의 설정·참여자·가능 시간·제출 기록·확정 결과를 포함하지 않는다.

```json
{
  "code": "PROMISE_CANCELLED",
  "message": "취소된 약속입니다."
}
```

### **처리 순서 / 비고**

#### **미완성 draft 만료**

draft는 `promises.created_at+10분`에 만료된다. GET 요청은 만료 여부와 만료 시각만 계산하고 DB를 변경하지 않는다. 기존 방장 또는 새 방장의 쓰기 요청이 만료 draft를 발견하면 promise_link와 관련 행을 정해진 순서로 잠근 뒤 세션 → 방장 참여자 → promise 순서로 명시적으로 삭제하고 promise_link는 보존한다. 만료와 모집 시작이 경쟁하면 잠금 획득 후 서버 시각을 기준으로 먼저 유효하게 처리된 요청을 적용한다.

#### **요청 시 상태·마감 판정**

1. `promiseId` 형식을 검사하고 약속 존재 여부와 취소 상태를 확인한다.
2. 약속이 `cancelled`이면 세션 인증 결과보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다.
3. 취소 상태가 아니면 세션을 인증하고 요청자의 약속 소속과 `participants.status=active` 여부를 확인한다.
4. GET 요청은 DB 상태를 변경하지 않는다. `status=collecting`이고 현재 시각이 `voting_deadline_at` 이상이면 `effectiveStatus=closed`로 계산하여 응답과 상태 검증에 사용한다.
5. 쓰기 요청은 `promises` 행을 `FOR UPDATE`로 잠근 뒤 취소 상태·참여 상태·권한·마감 시각을 다시 확인한다.
6. 쓰기 요청에서 `status=collecting`이고 잠금 후 `clock_timestamp() >= voting_deadline_at`이면 `promises.status=closed`로 변경한다.
7. 상태 변경 후 해당 API의 허용 상태를 검사하고 요청을 계속 처리하거나 거절한다.
8. 인증 자체가 실패한 요청은 약속의 DB 상태를 변경하지 않는다.
9. 전원 제출은 자동 마감 조건이 아니다. 응답자가 0명 또는 1명이어도 마감 시각에 도달하면 GET에서는 `effectiveStatus=closed`, 쓰기 요청에서는 실제 DB 상태를 `closed`로 처리한다.

조회와 확정 사이에 시간이 지나거나 참여 데이터가 변경될 수 있으므로 확정 요청에서는 후보를 다시 계산·검증한다. 모든 슬롯·참여 변경 경로는 동일한 약속 잠금 규칙을 따라야 한다.

#### **후보 계산 계약**

1. participants.status=active이고 availability_submitted_at이 있는 참여자만 집계한다.
2. 한국 기준 30분 경계의 미래 시각을 후보 시작점으로 한다. 전체 선택 날짜 범위를 대상으로 한다.
3. 약속의 duration_minutes는 30 이상·30의 배수이고 전체 구간이 해당 날짜의 하루 선택 범위 안에 있어야 한다.
4. 해당 구간의 모든 연속 슬롯에 가능한 동일 참여자를 집계한다. 슬롯별 인원수 합이나 최솟값으로 대신하지 않는다.
5. 공통 가능 인원이 2명 이상인 후보만 반환한다. 방장을 한 명으로 포함하지만 방장 참석 자체는 필수 조건이 아니다.
6. 공통 가능 인원 내림차순·시작 시각 오름차순 정렬. 기본 5개 표시, 나머지는 추가 조회한다.
7. 방장은 유효 후보 중 하나를 확정할 수 있다. 1순위나 최초 5개 안에서만 선택하도록 제한하지 않는다.
8. 후보가 없으면 closed를 유지한다. 화면은 STATE-API-06 재조율 또는 STATE-API-07 취소를 안내한다.

#### **세션·보존 공통 계약**

- collecting 세션은 `voting_deadline_at+7일`까지 유지한다. 세션·링크 만료는 `voting_deadline_at+7일`을 유지하며 조기 마감 때 갱신하지 않는다(DECISION_CONFLICTS C-11 잠정, 팀 확정 필요).
- 최종 일정 확정 때는 세션 만료를 `confirmed_start_at+7일`로 갱신한다(STATE-API-05, DECISION_CONFLICTS C-10 잠정, 팀 확정 필요).
- 마감·재조율·확정에 따라 만료 시각을 바꿀 때는 `status=active`인 참여자의 현재 유효한 세션만 갱신한다. 이미 만료됐거나 `status=cancelled`인 참여자의 세션은 다시 활성화하지 않는다.
- 세션 만료 후에도 링크 접근 기간이 남아 있고 약속이 cancelled가 아니면 닉네임·PIN으로 재로그인할 수 있다.
- 약속 취소는 `promises.status`와 `promises.cancelled_at`을 변경하며 참여자의 `role`, `status`, `cancelled_at`은 보존한다. 참여자 탈퇴가 완료된 경우에는 해당 참여자의 `status=cancelled`, `cancelled_at=현재 시각`을 기록한다. 단, 후임자가 없는 마지막 방장의 요청은 참여자 탈퇴를 완료하지 않고 약속 취소로 전환한다.
- 세션도 행 삭제 대신 `expires_at`을 현재 시각으로 바꿔 즉시 만료한다.
- cancelled 참여자의 보존된 슬롯·제출 기록은 후보·정원·참석자 집계에서 제외한다.

#### **보안 정보**

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

---

## **STATE-API-01 — 약속 상태와 설정 조회**

`GET /api/v1/promises/{promiseId}`

활성 참여자에게 현재 약속 상태·설정·현재 확정 일정을 반환한다. 기한이 지나면 closed 판정을 반영한다.



### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-01-01, STATE-05-01, STATE-08-01
- 관련 US: 현재 원본에 연결된 US ID 없음
- 근거: 제공한 시간 조율 ERD 설명서 3.2·3.3·6.1·8.2절 및 해당 Notion 상태 규칙
- 권한: 해당 약속의 active 참여자. draft는 현재 host만
- 허용 상태: draft / collecting / closed / confirmed
- 상태 전환: 없음. 기한이 지났다면 effectiveStatus만 closed로 계산
- 동시성: DB 상태는 변경하지 않으며 일관된 읽기 기준으로 최신 설정과 effectiveStatus를 구성
- TBD: 없음. 취소된 약속은 세션 만료 여부와 관계없이 409 PROMISE_CANCELLED를 반환하며, 인증 없는 초대 링크 조회에서도 취소 안내만 제공한다.
- 기존 공통 규약: [Notion 참고 문서](https://app.notion.com/p/MEMBER-API-00-3f67085f31828163a34ff6da7b3180a6?pvs=21)

### **1. 기본 정보**

- **목적:** 활성 참여자에게 현재 약속 상태·설정·현재 확정 일정을 반환한다. 기한이 지나면 closed 판정을 반영한다.
- **HTTP Method:** GET
- **Endpoint:** `/api/v1/promises/{promiseId}`
- **Authentication Required:** 예 — 약속별 세션 쿠키
- **Content Type:** application/json; charset=utf-8
- 성공 응답은 기존 MEMBER와 같은 래퍼 없는 JSON이다. 필드·URI·조회 페이지 크기 등 기술 계약은 아래와 같이 정하며 새로운 제품 정책을 추가하지 않는다.

### **요청**

#### **헤더**

| Name | Value | 필수 |
| --- | --- | --- |
| Cookie | ys_session_{promiseId}=… | 예 |
| Accept | application/json | 권장 |

#### **Path Parameter**

| 이름 | 타입 | 설명 | 필수 |
| --- | --- | --- | --- |
| promiseId | string(UUID) | 초대 링크 조회나 방장 등록으로 받은 약속 ID | 예 |

#### **Request Body**

본문 없음. 요청자 ID·역할은 세션과 DB에서 확인한다.

### **응답**

#### **Status Code: 200 OK**

| 이름 | 타입 | 설명 |
| --- | --- | --- |
| promiseId | string(UUID) | 약속 ID |
| promiseStatus | enum | draft / collecting / closed / confirmed |
| settings | object | draft 미설정 값은 각 필드 NULL |
| settings.participantLimit | integer 또는 null | 방장 포함 2~30명 정원 |
| settings.dateRange.startDate / endDate | string(date) 또는 null | 선택 시작·종료 날짜, 양끝 포함 |
| settings.dailyTimeRange.startTime / endTime | string(time) 또는 null | 분 단위 DB 값을 HH:mm으로 변환. 종료에는 24:00 허용 |
| settings.durationMinutes | integer 또는 null | 30분 배수 소요 시간 |
| settings.votingDeadlineAt | string(date-time) 또는 null | 응답 마감 시각 |
| draftExpiresAt | string(date-time) 또는 null | draft이면 created_at+10분, 그 외 null |
| draftExpired | boolean | GET 기준 draft 만료 여부. GET은 DB를 변경하지 않음 |
| currentConfirmation | object 또는 null | confirmed일 때만 현재 확정 일정 |
| currentConfirmation.startAt / endAt | string(date-time) | 확정 시작 / 시작+현재 소요 시간 |
| currentConfirmation.availableParticipantCount | integer | 현재 active·제출 완료 참여자 중 확정 시간 전체에 가능한 인원 |
| currentConfirmation.hostActionRequired | boolean | 요청자가 host이고 참석 가능 인원이 2명 미만이면 true |

#### **Response Body**

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "collecting",
  "draftExpiresAt": null,
  "draftExpired": false,
  "settings": {
    "participantLimit": 8,
    "dateRange": {
      "startDate": "2026-10-20",
      "endDate": "2026-10-31"
    },
    "dailyTimeRange": {
      "startTime": "09:00",
      "endTime": "18:00"
    },
    "durationMinutes": 60,
    "votingDeadlineAt": "2026-10-19T18:00:00+09:00"
  },
  "currentConfirmation": null
}
```

#### **확정 상태 응답 예제**

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "confirmed",
  "draftExpiresAt": null,
  "draftExpired": false,
  "settings": {
    "participantLimit": 8,
    "dateRange": {
      "startDate": "2026-10-20",
      "endDate": "2026-10-31"
    },
    "dailyTimeRange": {
      "startTime": "09:00",
      "endTime": "18:00"
    },
    "durationMinutes": 60,
    "votingDeadlineAt": "2026-10-19T18:00:00+09:00"
  },
  "currentConfirmation": {
    "startAt": "2026-10-20T14:00:00+09:00",
    "endAt": "2026-10-20T15:00:00+09:00",
    "availableParticipantCount": 1,
    "hostActionRequired": true
  }
}
```

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·쿼리·필수값 형식 오류 | 요청 형식을 확인해 주세요. |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | 다시 로그인해 주세요. |
| 403 | FORBIDDEN | 다른 약속 소속 또는 방장 권한 부족 | 이 작업을 수행할 권한이 없습니다. |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | 약속을 찾을 수 없습니다. |
| 409 | PROMISE_CANCELLED | 약속이 취소됨 | 취소된 약속입니다. |
| 409 | INVALID_PROMISE_STATE | 이 API에서 허용하지 않는 약속 상태 | 현재 약속 상태에서는 요청할 수 없습니다. |
| 500 | INTERNAL_ERROR | 서버 오류 | 처리 중 오류가 발생했습니다. |

#### **오류 응답 예제**

```json
{
  "code": "UNAUTHENTICATED",
  "message": "다시 로그인해 주세요."
}
```

### **처리 순서 / 비고**

#### **처리 순서와 ERD 대응**

1. `promiseId` 형식과 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다.
2. 세션·약속 소속과 active 상태를 확인한다. draft는 현재 host만 허용한다.
3. 이 API는 GET이므로 DB 상태를 변경하지 않는다. draft이면 `draftExpiresAt=created_at+10분`과 현재 시각을 비교해 `draftExpired`를 계산한다. DB `status=collecting`이고 현재 시각이 마감 이상이면 `effectiveStatus=closed`로 계산하고 응답의 `promiseStatus`에 반환한다.
4. promises 설정 컬럼을 settings에 매핑한다. `daily_start_minute`와 `daily_end_minute`은 HH:mm으로 변환하며 종료 값 1440은 24:00으로 반환한다. draft의 미설정 값은 null이다.
5. confirmed이면 `confirmed_start_at`과 계산한 종료 시각을 반환한다. 현재 active·제출 완료 참여자 중 확정 시간 전체에 가능한 인원을 다시 계산해 `availableParticipantCount`에 반환한다.
6. 요청자가 host이고 확정 시간 참석 가능 인원이 2명 미만이면 `hostActionRequired=true`를 반환한다. 확정 상태와 `confirmed_start_at`은 변경하지 않는다.
7. 본인의 role·제출 시각·세션 만료는 기존 MEMBER-API-05로 확인한다. 다른 참여자의 개별 슬롯은 포함하지 않는다.

#### **구현 결정 (2026-11-06, DECISION_CONFLICTS R-21)**

- 검사 순서: promiseId 400 → 404 → 409 `PROMISE_CANCELLED` → 401 → 403(다른 약속) → 트랜잭션 안 세션·참여자 재확인 401 → draft에서 현재 역할이 host가 아니면 403 `FORBIDDEN`.
- 10분이 지난 draft도 방장에게 200과 `draftExpired: true`를 준다. 410 `DRAFT_EXPIRED`를 내지 않고 DB를 바꾸지 않는다.
- 허용 상태가 cancelled 외 전부라 `409 INVALID_PROMISE_STATE`가 나가는 경로는 없다(알 수 없는 상태값은 500).
- 판정 시각은 읽기 트랜잭션(REPEATABLE READ, 잠금 없음)의 `now()` 하나다. 시각 표기는 모두 초 단위 `+09:00`이다.
- 확정 구간 인원은 `lib/state/candidates.ts`의 `countAvailableParticipants`로 후보 계산과 같은 기준으로 센다. 미래·날짜 범위·하루 범위 검사는 하지 않는다.
8. 화면이 열려 있는 동안 이 API를 주기적으로 조회하고 이전 settings 객체와 최신 settings 객체를 비교해 설정 변경을 감지한다. 설정 전용 버전과 과거 변경 이력은 저장하지 않으므로 과거 범위 변경·삭제 슬롯 수를 임의 복원하는 changeNotice 필드는 반환하지 않는다.

#### **코드 예제**

```javascript
const response = await fetch(`/api/v1/promises/${promiseId}`, {
  method: 'GET',
  credentials: 'include',
  headers: { Accept: 'application/json' },
});
const result = await response.json();
if (!response.ok) {
  // code를 기준으로 로그인·후보 재조회·상태 변경을 안내한다.
  throw result;
}
```

#### **보안 정보**

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

---

## **STATE-API-02 — 설정 완료와 모집 시작**

`POST /api/v1/promises/{promiseId}/start`

방장이 필수 설정을 저장하고 가능 시간 수집을 시작한다.



### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-01-02, STATE-03-01, REVIEW-05, REVIEW-07
- 권한: 현재 active host
- 허용 상태: draft
- 상태 전환: draft → collecting
- 동시성: promises 행 잠금 후 권한·상태·DB 시각을 다시 검사하고 설정 저장과 상태 전환을 한 트랜잭션으로 처리
- 기존 공통 규약: [STATE-API-00](https://app.notion.com/p/STATE-API-00-3f87085f31828013ab20dcd75b849ed2?pvs=21)

### **1. 기본 정보**

- **목적:** 방장이 필수 설정을 저장하고 가능 시간 수집을 시작한다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/start`
- **Authentication Required:** 예
- **Content Type:** application/json

### **요청**

#### **Request Body**

| 이름 | 명세 |
| --- | --- |
| `participantLimit` | integer, 필수. 방장 포함 2~30명이며 현재 active 인원 이상 |
| `dateRange.startDate`, `dateRange.endDate` | YYYY-MM-DD, 필수. 양끝 포함. 달력에 실제로 있는 날짜. `startDate`는 판정 시각 기준 한국 시간 오늘 이후(오늘 허용, **2026-11-04 구현에서 추가 — DECISION_CONFLICTS R-12**). `startDate ≤ endDate`. `endDate`는 한국 시간 오늘부터 3개월 이내(달력의 월 단위로 계산, 그 달에 같은 날이 없으면 말일. 예: 11-30 → 02-28) |
| `dailyTimeRange.startTime`, `dailyTimeRange.endTime` | HH:mm, 필수. 시작은 00:00~23:30, 종료는 00:30~24:00의 30분 경계이며 시작 분 값은 종료 분 값보다 작아야 함 |
| `durationMinutes` | integer, 필수. 30 이상·30분 배수이며 하루 시간 범위 이하 |
| `votingDeadlineAt` | 오프셋(`Z` 또는 `±HH:mm`) 포함 ISO 8601, 필수. 오프셋이 없으면 400. 잠금 후 DB 시각보다 미래이고 마지막 후보 날짜 00:00(Asia/Seoul)보다 이전 |

- `dateRangeLimitMonths`는 받지 않는다. 3개월은 서버 공통 제한값이다.
- 형식 오류(필드 누락·타입·없는 날짜·없는 시각·오프셋 없는 마감)는 400 `INVALID_REQUEST`, 형식은 맞지만 규칙 위반은 422 `VALIDATION_FAILED`(`details.field`에 `participantLimit`·`dateRange`·`dailyTimeRange`·`durationMinutes`·`votingDeadlineAt` 중 첫 위반)이다.

```json
{
  "participantLimit": 8,
  "dateRange": {"startDate":"2026-10-20","endDate":"2026-10-31"},
  "dailyTimeRange": {"startTime":"09:00","endTime":"18:00"},
  "durationMinutes": 60,
  "votingDeadlineAt": "2026-10-19T18:00:00+09:00"
}
```

### **응답**

#### **Status Code: 200 OK**

```json
{
  "promiseId":"7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus":"collecting",
  "settings":{
    "participantLimit":8,
    "dateRange":{"startDate":"2026-10-20","endDate":"2026-10-31"},
    "dailyTimeRange":{"startTime":"09:00","endTime":"18:00"},
    "durationMinutes":60,
    "votingDeadlineAt":"2026-10-19T18:00:00+09:00"
  }
}
```

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·필드 형식 오류 | — |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | — |
| 403 | FORBIDDEN | 다른 약속 소속 또는 권한 부족 | — |
| 403 | INVALID_ORIGIN | `Origin` 헤더 없음 또는 서비스 도메인과 다름 (API_CONVENTIONS 7절, DECISION_CONFLICTS A-09) | 허용되지 않은 요청 출처입니다. |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | — |
| 409 | PROMISE_CANCELLED | 약속이 취소됨 | — |
| 410 | DRAFT_EXPIRED | draft 생성 후 10분이 지나 만료·정리됨 | — |
| 409 | INVALID_PROMISE_STATE | 현재 상태에서 허용되지 않는 요청. `details`에 `promiseStatus`, `allowedStates: ["draft"]` | — |
| 422 | VALIDATION_FAILED | 값이 비즈니스 규칙을 위반 | — |
| 500 | INTERNAL_ERROR | 서버 오류 | — |

모든 응답(에러 포함)에 `Cache-Control: no-store`를 붙인다.

### **처리 순서 / 비고**

#### **처리 순서**

0. `Origin`을 검증한다. 실패하면 `403 INVALID_ORIGIN`.
1. promiseId 형식(오류 시 `400 INVALID_REQUEST`)과 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션(만료·active 참여자, 실패 시 401)과 약속 소속(다르면 403 `FORBIDDEN`)을 확인하고, 본문 형식을 검사(400)한 뒤 promise_link와 promises 행을 정해진 순서로 잠근 뒤 취소 상태·최신 active host·draft 상태를 다시 확인한다. 잠금 후 현재 시각이 created_at+10분 이상이면 세션·방장 참여자·promise를 명시적으로 삭제하고 `410 DRAFT_EXPIRED`를 반환한다. **이 삭제는 410 응답을 내더라도 커밋한다(롤백하지 않는다).**
2. 모든 필수 설정을 검증한다. participantLimit은 2~30명이며 잠금 후 active 인원 이상, 시작일은 한국 시간 오늘 이후, 날짜 범위의 종료일은 한국 시간 오늘부터 3개월 이내(달력의 월 단위로 계산)여야 한다. 일일 시작·종료 문자열은 분 값으로 변환하며 종료 24:00은 1440으로 저장한다. 하나라도 실패하면 아무 값도 저장하지 않는다.
3. 설정과 `status=collecting`을 함께 저장한다.
4. `status=active`인 참여자의 현재 유효한 세션(`expires_at > 잠금 후 판정 시각`)만 `votingDeadlineAt + 7일`로 갱신한다. 이미 만료됐거나 cancelled 참여자에게 속한 세션은 다시 활성화하지 않는다. 각 브라우저 쿠키 만료는 다음 응답에서 같은 기준으로 갱신한다.
5. 이미 collecting인 재요청은 409이며 조회 API로 성공 여부를 확인한다.

#### **쿠키 갱신**

세션 인증에 성공한 뒤의 모든 응답(200과 400·403·409·410·422 포함)은 `Set-Cookie`로 요청자 쿠키를 다시 보낸다. `Max-Age`는 응답 시점 DB `expires_at`까지 남은 초(내림)다.

- 200: 이번 요청에서 갱신된 `votingDeadlineAt + 7일` 기준. 요청자 세션이 잠금 대기 중 만료돼 갱신되지 않았다면 원래 `expires_at` 기준.
- 잠금 전 오류(본문 400): 인증 시점의 `expires_at`과 판정 시각 기준.
- 잠금 후 오류(403·409·422): 원래 `expires_at`과 잠금 후 판정 시각 기준.
- 410 `DRAFT_EXPIRED`, 잠금 후 약속이 이미 정리된 404: 세션 행이 지워졌으므로 빈 값과 `Max-Age=0`으로 쿠키를 지운다.
- 세션 인증 전 실패(400 형식·401·403·404·409 취소·`INVALID_ORIGIN`)는 쿠키를 보내지 않는다.

#### **보안 정보**

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## **STATE-API-03 — 모집 중 설정 변경**

`PATCH /api/v1/promises/{promiseId}/settings`

모집 중 허용된 설정을 변경한다. 날짜·하루 시간 범위 변경은 재조율로 취급하지만 별도 상태값은 만들지 않는다.



### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-04-01~03, STATE-09-03~05, REVIEW-08, REVIEW-14, REVIEW-15
- 권한: 현재 active host
- 허용 상태: collecting이며 마감 전
- 상태 전환: collecting 유지
- 동시성: promises 행 잠금 후 마감·권한을 재검사하고 설정·슬롯 정리·제출 상태 변경을 한 트랜잭션으로 처리

### **1. 기본 정보**

- **목적:** 모집 중 허용된 설정을 변경한다. 날짜·하루 시간 범위 변경은 재조율로 취급하지만 별도 상태값은 만들지 않는다.
- **HTTP Method:** PATCH
- **Endpoint:** `/api/v1/promises/{promiseId}/settings`
- **Authentication Required:** 예
- **Content Type:** application/json

### **요청**

한 필드 이상 필요하며 생략한 값은 유지한다. `dateRange`와 `dailyTimeRange`는 시작·종료를 함께 보낸다.

| 이름 | 명세 |
| --- | --- |
| `participantLimit` | 현재 active 인원 이상이면서 최대 30명. 모집 중에는 증가만 허용 |
| `dateRange` | 종료일은 한국 시간 오늘부터 3개월 이내(달력의 월 단위로 계산) |
| `dailyTimeRange` | 시작은 00:00~23:30, 종료는 00:30~24:00의 30분 경계. 서버는 분 값으로 변환하고 시작 분 \< 종료 분을 검증 |
| `durationMinutes` | 30 이상·30분 배수 |
| `votingDeadlineAt` | 현재보다 미래이고 기존 마감보다 늦은 값만 허용 |

```json
{
  "dateRange":{"startDate":"2026-10-20","endDate":"2026-10-27"},
  "durationMinutes":90
}
```

#### **범위 축소 확인**

화면은 범위를 줄일 때 다음 일반 경고를 표시한다. 삭제 개수 미리보기 API는 만들지 않는다.

> 범위를 줄이면 제외되는 날짜·시간의 기존 입력이 삭제됩니다. 변경할까요?

### **응답**

```json
{
  "promiseId":"7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus":"collecting",
  "settings":{"participantLimit":8,"dateRange":{"startDate":"2026-10-20","endDate":"2026-10-27"},"dailyTimeRange":{"startTime":"09:00","endTime":"18:00"},"durationMinutes":90,"votingDeadlineAt":"2026-10-19T18:00:00+09:00"},
  "changeImpact":{"rangeChanged":true,"hasAddedSelectableSlots":false,"submissionsReset":false,"removedSlotCount":12,"versionChangedParticipantCount":3,"candidateRecalculationRequired":true}
}
```

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·필드 형식 오류 | — |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | — |
| 403 | FORBIDDEN | 다른 약속 소속 또는 권한 부족 | — |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | — |
| 409 | PROMISE_CANCELLED | 약속이 취소됨 | — |
| 409 | INVALID_PROMISE_STATE | 현재 상태에서 허용되지 않는 요청 | — |
| 422 | CAPACITY_DECREASE_NOT_ALLOWED | 모집 중 정원 감소 | 모집 중에는 정원을 줄일 수 없습니다. |
| 422 | DEADLINE_SHORTEN_NOT_ALLOWED | 모집 중 마감 단축 | 모집 중에는 응답 마감을 앞당길 수 없습니다. |
| 422 | CAPACITY_BELOW_ACTIVE_COUNT | 정원이 현재 active 인원보다 작음 (구현 추가, R-27) | 정원은 현재 참여 인원보다 적을 수 없습니다. |
| 422 | VALIDATION_FAILED | 값이 비즈니스 규칙을 위반 | — |
| 500 | INTERNAL_ERROR | 서버 오류 | — |

### **처리 순서 / 비고**

#### **처리 순서**

공통 규약에 따라 promiseId와 약속 존재 여부를 먼저 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 인증 후 promises 행을 잠그면 취소 상태·권한·마감을 다시 확인한다.

1. 잠금 후 마감 시각 이상이면 `collecting→closed`를 먼저 반영하고 변경은 409로 거절한다.
2. 이전 선택 가능 슬롯 집합을 A, 변경 후 집합을 B로 계산한다.
3. 각 참여자의 슬롯은 `기존 슬롯 ∩ B`만 남긴다. 새 슬롯을 자동 선택하지 않는다.
4. `B-A`가 비어 있는 축소만 발생하면 기존 제출 상태를 유지한다.
5. 축소로 실제 슬롯이 삭제된 참여자의 `availability_version`만 1 증가시킨다. 실제 슬롯이 삭제되지 않은 참여자의 버전은 변경하지 않는다.
6. `B-A`가 하나라도 있는 확대·이동이면 모든 active 참여자의 `availability_submitted_at=NULL` 처리와 `availability_version+1`을 수행한다. 제출 시각이 이미 NULL이어도 버전을 증가시킨다.
7. 범위를 바꾸지 않고 소요 시간만 변경하거나 정원·마감만 변경한 경우 슬롯·제출 상태·버전을 유지하고 필요한 후보 계산만 새 설정으로 수행한다. 설정 전용 버전은 두지 않으며 참여자 화면은 STATE-API-01의 settings 전체를 주기적으로 비교한다.
8. 마감을 연장할 때는 active 참여자의 현재 유효한 세션만 새 `votingDeadlineAt+7일`로 갱신한다. 이미 만료됐거나 cancelled 참여자의 세션은 다시 활성화하지 않는다.
9. 현재 ERD에는 변경 이력 테이블이 없으므로 과거 changeNotice를 영구 저장하지 않는다. `changeImpact`는 이번 요청의 계산 결과다.

#### **구현 결정 (2026-11-09, DECISION_CONFLICTS R-27)**

- 검사 순서: Origin 403 → promiseId 400 → 본문 400(JSON·필드 형식, **아는 필드가 하나도 없는 빈 요청**) → 404 → 409 `PROMISE_CANCELLED`(세션보다 우선) → 401 → 403(다른 약속) → `promises` 행 잠금 → 잠금 후 cancelled 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403 → 허용 상태 → 설정 검증 422 → 저장. 잠금·재확인·범위 정리 단계는 STATE-API-06과 같은 코드(`lib/state/settings-change.ts`)를 쓴다.
- 허용 상태: 마감 전 collecting만. 잠금 후 마감 시각 이상(경계 포함)이면 closed를 저장하고 409 `INVALID_PROMISE_STATE` `details.promiseStatus="closed"`(저장은 유지). draft(10분 경과와 관계없이)·closed·confirmed도 409, `details.allowedStates=["collecting"]`.
- 요청: 필드 형식은 STATE-API-02와 같다(`null`·시작/종료 중 하나만 보낸 범위·오프셋 없는 마감은 400). 모르는 필드는 무시한다.
- 검증 순서: ① 기존 값과 합친 설정을 STATE-API-02·06과 같은 `validateStartSettings`로 검증 — 정원 2~30, 정원 < active 인원은 422 `CAPACITY_BELOW_ACTIVE_COUNT`(06과 같은 코드), 날짜 범위 종료는 오늘부터 3개월(R-07, 노션 원문의 "최대 90일"이 아님), 시작 날짜 하한(오늘 이후, R-12)은 **`dateRange`를 보낸 경우에만**, 하루 범위·소요 시간, 마감은 판정 시각 이후이면서 (바뀐) 마지막 날짜 00:00 이전. ② 모집 중 규칙 — 정원이 기존보다 작으면 422 `CAPACITY_DECREASE_NOT_ALLOWED`, 마감이 기존보다 이르면 422 `DEADLINE_SHORTEN_NOT_ALLOWED`. **같은 값은 변경 없음으로 허용**한다. 그래서 정원 감소이면서 active 인원보다 작으면 `CAPACITY_BELOW_ACTIVE_COUNT`, 과거 시각으로 단축하면 `VALIDATION_FAILED`가 먼저 나온다. 범위를 줄여 기존 마감이 새 마지막 날짜 00:00 이후가 되면 마감을 앞당길 수 없으므로 422 `VALIDATION_FAILED` `field=votingDeadlineAt`.
- 범위 변경: STATE-API-06과 같은 `planRangeChange`(R-26) — 정리 대상은 active 참여자만, 「선택 가능」 추가 칸은 판정 시각 이후 시작 칸만.
- 저장: 설정 컬럼만 한 번에(`status`는 바꾸지 않음). 마감이 기존보다 늦을 때만 같은 트랜잭션에서 `refreshActiveSessions`(collecting, 새 마감).
- 응답 `settings`는 STATE-API-01과 같은 함수로 만든다(`24:00`, 마감 초 단위 `+09:00`). `changeImpact.rangeChanged`는 날짜·하루 범위 중 하나라도 값이 바뀐 경우, `candidateRecalculationRequired`는 범위 또는 소요 시간이 바뀐 경우(후보는 저장하지 않고 조회 때 계산하므로 안내용). 거절 응답(401·403·409·422)은 잠금 후 다시 읽은 세션 기준으로 쿠키를 갱신한다.

#### **보안 정보**

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## **STATE-API-04 — 방장 마감**

`POST /api/v1/promises/{promiseId}/close`

현재 방장이 수집을 마감한다. 이미 closed인 중복 요청은 데이터를 다시 바꾸지 않고 현재 상태를 반환한다.



### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-01-02, STATE-05-01, STATE-05-03
- 관련 US: 현재 원본에 연결된 US ID 없음
- 근거: 제공한 시간 조율 ERD 설명서 6.1·8.2절 및 해당 Notion 상태 규칙
- 권한: 해당 약속의 현재 active host
- 허용 상태: collecting: 마감 수행 / closed: 변경 없이 현재 마감 상태 반환
- 상태 전환: collecting → closed; closed → closed
- 동시성: 약속 잠금 후 최신 host 권한·상태·DB 시각 재검증
- TBD: 없음. 설정 변경·재조율·취소·탈퇴 계약은 STATE-API-03·06·07·08에 반영
- 기존 공통 규약: [Notion 참고 문서](https://app.notion.com/p/MEMBER-API-00-3f67085f31828163a34ff6da7b3180a6?pvs=21)

### **1. 기본 정보**

- **목적:** 현재 방장이 수집을 마감한다. 이미 closed인 중복 요청은 데이터를 다시 바꾸지 않고 현재 상태를 반환한다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/close`
- **Authentication Required:** 예 — 약속별 세션 쿠키
- **Content Type:** application/json; charset=utf-8
- 성공 응답은 기존 MEMBER와 같은 래퍼 없는 JSON이다. 필드·URI·조회 페이지 크기 등 기술 계약은 아래와 같이 정하며 새로운 제품 정책을 추가하지 않는다.

### **요청**

#### **헤더**

| Name | Value | 필수 |
| --- | --- | --- |
| Cookie | ys_session_{promiseId}=… | 예 |
| Accept | application/json | 권장 |
| Origin | 서비스의 허용 Origin | 예 |

#### **Path Parameter**

| 이름 | 타입 | 설명 | 필수 |
| --- | --- | --- | --- |
| promiseId | string(UUID) | 초대 링크 조회나 방장 등록으로 받은 약속 ID | 예 |

#### **Request Body**

본문 없음. 요청자 ID·역할은 세션과 DB에서 확인한다.

### **응답**

#### **Status Code: 200 OK**

| 이름 | 타입 | 설명 |
| --- | --- | --- |
| promiseId | string(UUID) | 약속 ID |
| promiseStatus | closed | 기한 또는 방장 마감 후 상태 |

#### **Response Body**

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "closed"
}
```

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·쿼리·필수값 형식 오류 | 요청 형식을 확인해 주세요. |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | 다시 로그인해 주세요. |
| 403 | FORBIDDEN | 다른 약속 소속 또는 방장 권한 부족 | 이 작업을 수행할 권한이 없습니다. |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | 약속을 찾을 수 없습니다. |
| 409 | PROMISE_CANCELLED | 약속이 취소됨 | 취소된 약속입니다. |
| 409 | INVALID_PROMISE_STATE | 이 API에서 허용하지 않는 약속 상태 | 현재 약속 상태에서는 요청할 수 없습니다. |
| 500 | INTERNAL_ERROR | 서버 오류 | 처리 중 오류가 발생했습니다. |

#### **오류 응답 예제**

```json
{
  "code": "INVALID_PROMISE_STATE",
  "message": "현재 약속 상태에서는 마감할 수 없습니다.",
  "details": {
    "promiseStatus": "confirmed",
    "allowedStates": [
      "collecting",
      "closed"
    ]
  }
}
```

### **처리 순서 / 비고**

#### **처리 순서와 ERD 대응**

1. promiseId 형식과 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션 소속을 확인하고 약속 행을 잠근 뒤 취소 상태와 최신 active·host 권한을 다시 확인한다.
2. 이미 closed라면 데이터 변경 없이 200으로 현재 closed 상태를 반환한다. 마감 요청 중복 처리는 새 제품 규칙을 추가하지 않는 기술 계약이다.
3. collecting이라면 잠금 후 서버 시각으로 기한 판정을 수행한다. 이미 기한 도달이면 공통 마감, 기한 전이면 방장 조기 마감으로 closed를 저장한다. 세션·링크 만료는 `voting_deadline_at+7일`을 유지하며 조기 마감 때 갱신하지 않는다. `voting_deadline_at`도 덮어쓰지 않는다(DECISION_CONFLICTS C-11 잠정, 팀 확정 필요).
4. draft·confirmed는 `409 INVALID_PROMISE_STATE`, cancelled는 세션 인증 결과보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 이번 요청에서 확정 시각·참가 입력·제출 기록을 삭제하거나 초기화하지 않는다.
5. 후보는 저장하지 않고 후보 조회 API가 현재 데이터를 계산한다. 현재 ERD에 closedAt·closeReason 컬럼이 없으므로 해당 값을 저장된 마감 이력처럼 응답하지 않는다.
6. 전원 제출 여부·후보 최소 인원은 마감의 선행 조건이 아니다.
7. 화면은 현재 host이면서 collecting일 때만 마감 버튼을 보여주고 요청 중 비활성화한다. 마감 후에는 숨긴다. 재조율로 collecting이 된 뒤 다시 표시한다.
8. 200 중복 처리는 같은 closed 상태에서의 재시도 계약이다. 다른 조율 회차를 가로지르는 지연 요청의 보호 정책은 EXCEPTION 영역에서 별도 다루며 요청 단위 멱등성까지 보장한다고 표현하지 않는다.

#### **구현 결정 (2026-11-07, DECISION_CONFLICTS R-22)**

- 검사 순서: Origin 403 → promiseId 400 → 404 → 409 `PROMISE_CANCELLED` → 401 → 403(다른 약속) → `promises` 행 잠금 → 잠금 후 cancelled 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403 → 상태.
- 링크를 잠그지 않는다(draft를 지우지 않음). 10분 지난 draft도 409 `INVALID_PROMISE_STATE`이며 삭제하지 않는다.
- 조기 마감·공통 마감 모두 `status`만 closed로 바꾼다. 세션·`voting_deadline_at`은 바꾸지 않는다(C-11 잠정).
- 본문은 읽지 않는다. 상태 오류 메시지는 공통 헬퍼 문구("현재 약속 상태에서는 요청할 수 없습니다.")다.
- 가능 시간 제출과 같은 약속 행을 잠그므로 먼저 잠금을 잡은 요청이 이긴다(DATABASE.md 8.2). EXCEPTION-06-01은 미결로 둔다.

#### **코드 예제**

```javascript
const response = await fetch(`/api/v1/promises/${promiseId}/close`, {
  method: 'POST',
  credentials: 'include',
  headers: { Accept: 'application/json' },
});
const result = await response.json();
if (!response.ok) {
  // code를 기준으로 로그인·후보 재조회·상태 변경을 안내한다.
  throw result;
}
```

#### **보안 정보**

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

---

## **STATE-API-05 — 최종 일정 확정**

`POST /api/v1/promises/{promiseId}/confirmation`

현재 active 방장이 미래 유효 후보 하나를 확정한다. 최신 공통 가능 인원을 다시 검사하고 confirmed_start_at을 저장한다.



### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-01-02, STATE-08-01 / ERD 설명서 7.1·7.2
- 관련 US: 현재 원본에 연결된 US ID 없음
- 근거: 제공한 시간 조율 ERD 설명서 3.2·7.1·7.2·8.2절 및 해당 Notion 상태 규칙
- 권한: 해당 약속의 현재 active host
- 허용 상태: closed
- 상태 전환: closed → confirmed; confirmed 직접 교체 불가
- 동시성: 약속 잠금 후 host·closed·최신 후보 유효성 재검증과 확정 저장을 단일 트랜잭션으로 수행
- TBD: 없음. 확정 후 탈퇴는 일정 유지, 일정 변경은 STATE-API-06 재조율을 사용한다.
- 기존 공통 규약: [Notion 참고 문서](https://app.notion.com/p/MEMBER-API-00-3f67085f31828163a34ff6da7b3180a6?pvs=21)

### **1. 기본 정보**

- **목적:** 현재 active 방장이 미래 유효 후보 하나를 확정한다. 최신 공통 가능 인원을 다시 검사하고 confirmed_start_at을 저장한다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/confirmation`
- **Authentication Required:** 예 — 약속별 세션 쿠키
- **Content Type:** application/json; charset=utf-8
- 성공 응답은 기존 MEMBER와 같은 래퍼 없는 JSON이다. 필드·URI·조회 페이지 크기 등 기술 계약은 아래와 같이 정하며 새로운 제품 정책을 추가하지 않는다.

### **요청**

#### **헤더**

| Name | Value | 필수 |
| --- | --- | --- |
| Cookie | ys_session_{promiseId}=… | 예 |
| Accept | application/json | 권장 |
| Origin | 서비스의 허용 Origin | 예 |
| Content-Type | application/json | 예 |

#### **Path Parameter**

| 이름 | 타입 | 설명 | 필수 |
| --- | --- | --- | --- |
| promiseId | string(UUID) | 초대 링크 조회나 방장 등록으로 받은 약속 ID | 예 |

#### **Request Body**

| 이름 | 타입 | 설명 | 필수 | 기본값 |
| --- | --- | --- | --- | --- |
| startAt | string(date-time) | 오프셋 포함 ISO 8601. 한국 30분 경계의 미래 후보 시작 | 예 | 없음 |

```json
{
  "startAt": "2026-10-20T14:00:00+09:00"
}
```

### **응답**

#### **Status Code: 200 OK**

| 이름 | 타입 | 설명 |
| --- | --- | --- |
| promiseId | string(UUID) | 약속 ID |
| promiseStatus | confirmed | 확정 완료 상태 |
| currentConfirmation.startAt | string(date-time) | confirmed_start_at에 저장한 시작 |
| currentConfirmation.endAt | string(date-time) | 시작+현재 duration_minutes; 별도 DB 컬럼 아님 |

#### **Response Body**

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "confirmed",
  "currentConfirmation": {
    "startAt": "2026-10-20T14:00:00+09:00",
    "endAt": "2026-10-20T15:00:00+09:00"
  }
}
```

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·쿼리·필수값 형식 오류 | 요청 형식을 확인해 주세요. |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | 다시 로그인해 주세요. |
| 403 | FORBIDDEN | 다른 약속 소속 또는 방장 권한 부족 | 이 작업을 수행할 권한이 없습니다. |
| 403 | INVALID_ORIGIN | `Origin` 헤더 없음 또는 서비스 도메인과 다름 (API_CONVENTIONS 7절, DECISION_CONFLICTS A-09) | 허용되지 않은 요청 출처입니다. |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | 약속을 찾을 수 없습니다. |
| 409 | PROMISE_CANCELLED | 약속이 취소됨 | 취소된 약속입니다. |
| 409 | INVALID_PROMISE_STATE | 이 API에서 허용하지 않는 약속 상태 | 현재 약속 상태에서는 요청할 수 없습니다. |
| 500 | INTERNAL_ERROR | 서버 오류 | 처리 중 오류가 발생했습니다. |
| 422 | VALIDATION_FAILED | startAt 날짜·시간 형식이 유효하지 않음 | 확정 시작 시각을 확인해 주세요. |
| 422 | INVALID_CONFIRMATION_CANDIDATE | 과거 시각·경계 위반·범위 초과·공통 가능 인원 2명 미만 | 후보가 변경되었거나 유효하지 않습니다. 최신 후보를 확인해 주세요. |

#### **오류 응답 예제**

```json
{
  "code": "INVALID_PROMISE_STATE",
  "message": "확정된 일정은 직접 변경할 수 없습니다.",
  "details": {
    "promiseStatus": "confirmed",
    "allowedStates": [
      "closed"
    ]
  }
}
```

### **처리 순서 / 비고**

#### **처리 순서와 ERD 대응**

1. startAt과 promiseId 형식을 검증하고 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션 소속을 확인하고 약속 행을 잠근 뒤 취소 상태와 최신 active·host 권한을 다시 확인한다.
2. 이 API는 쓰기 요청이므로 약속 행 잠금 후 마감 시각을 판정한다. DB status가 collecting이고 마감 시각이 지났다면 promises.status=closed를 먼저 저장한 뒤 같은 요청에서 방장 권한과 후보 유효성을 계속 검사할 수 있다. 기한 전 collecting과 이미 confirmed인 요청은 `409 INVALID_PROMISE_STATE`이다.
3. startAt을 절대 시각으로 파싱한다. 클라이언트의 참석 인원·순위·종료·소요 시간은 입력받지 않는다. 같은 절대 시각의 오프셋 표기는 같은 후보로 검사한다.
4. 잠금 후 현재 DB 시각보다 엄격히 미래이고 한국 기준 00분·30분 경계인지 확인한다. 설정 날짜 범위 안에서 전체 duration_minutes가 해당 날의 하루 선택 범위 안에 들어야 한다.
5. active이며 제출 완료인 동일 참여자 중 필요한 모든 연속 30분 슬롯을 선택한 사람이 2명 이상인지 다시 검사한다. 방장은 집계하지만 방장 참석은 필수 조건이 아니다.
6. 상위 5개에 없더라도 전체 유효 후보이면 허용한다. 유효하지 않거나 시간이 이미 지났으면 422 INVALID_CONFIRMATION_CANDIDATE로 거부하고 최신 후보 재조회를 안내한다.
7. promises.confirmed_start_at=startAt과 status=confirmed를 함께 저장한다. endAt은 현재 duration_minutes로 계산한다. 제출 상태·참가 슬롯을 초기화하지 않는다.
8. 같은 트랜잭션에서 이 약속의 `status=active` 참여자 세션 중 아직 유효한 것만 `expires_at`을 `confirmed_start_at+7일`(확정 후 링크 만료와 같은 값)로 갱신한다. 만료됐거나 cancelled 참여자의 세션은 되살리지 않는다. 요청자 쿠키는 이 응답에서, 다른 기기 쿠키는 이후 세션 인증 응답에서 Max-Age를 갱신한다(DECISION_CONFLICTS C-10 잠정, 팀 확정 필요).
9. 응답 유실 시 STATE-API-01로 확정 결과를 확인한다. 이미 confirmed인 재요청은 409로 일관되게 처리하며 일정 교체를 실행하지 않는다. 일정 변경은 STATE-API-06으로 재조율한 뒤 다시 확정한다.

#### **구현 결정 (2026-11-07, DECISION_CONFLICTS R-23)**

- 검사 순서: Origin 403 → promiseId 400 → 본문 400(JSON 객체 아님·`startAt` 없음·문자열 아님) → `startAt` 형식 422 `VALIDATION_FAILED`(`details.field: "startAt"`) → 404 → 409 `PROMISE_CANCELLED` → 401 → 403(다른 약속) → `promises` 행 잠금 → 잠금 후 cancelled 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403 → 마감 지난 collecting이면 closed 저장 → 상태 409 → 후보 422 → 저장.
- `startAt` 표기: `YYYY-MM-DDTHH:MM[:SS[.fff]]` + `Z` 또는 `±HH:MM`. 같은 절대 시각이면 오프셋과 무관하게 같은 후보다.
- 후보 판정은 `lib/state/candidates.ts`의 판정 함수 하나를 STATE-API-10 `computeCandidates`와 함께 쓴다(`validateCandidateStart`). 판정 시각은 잠금 후 `clock_timestamp()`이고 시작 = 판정 시각이면 지난 것이다.
- 마감 지난 collecting을 closed로 저장한 뒤 후보가 무효여서 422로 끝나도 closed 저장은 커밋한다(TIME-API-01이 마감 경과 시 closed를 커밋하고 409를 내는 것과 같음). 최신 role이 host가 아니면 closed 저장 전에 403으로 끝난다(방장이 아닌 요청은 상태를 바꾸지 않음).
- 422 `INVALID_CONFIRMATION_CANDIDATE`는 이유를 구분해 응답하지 않는다. 상태 오류 메시지는 공통 헬퍼 문구다.
- 응답 시각은 초 단위 `+09:00`이다.

#### **코드 예제**

```javascript
const response = await fetch(`/api/v1/promises/${promiseId}/confirmation`, {
  method: 'POST',
  credentials: 'include',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify({ startAt }),
});
const result = await response.json();
if (!response.ok) {
  // code를 기준으로 로그인·후보 재조회·상태 변경을 안내한다.
  throw result;
}
```

#### **보안 정보**

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

---

## **STATE-API-06 — 재조율 시작**

`POST /api/v1/promises/{promiseId}/reopen`

마감되거나 확정된 약속을 다시 열어 응답을 받는다.



### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-01-01~02, STATE-06-01, STATE-08-01, STATE-09-02~05, REVIEW-04, REVIEW-14, REVIEW-15
- 권한: 현재 active host
- 허용 상태: closed / confirmed
- 상태 전환: closed / confirmed → collecting
- 동시성: promises 행 잠금 후 모든 설정·슬롯·제출·확정값 변경을 한 트랜잭션으로 처리

### **1. 기본 정보**

- **목적:** 마감되거나 확정된 약속을 다시 열어 응답을 받는다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/reopen`
- **Authentication Required:** 예
- **Content Type:** application/json

### **요청**

| 이름 | 명세 |
| --- | --- |
| `votingDeadlineAt` | 필수. 현재보다 미래이며 적용 후 마지막 후보 날짜 00:00 이전 |
| `participantLimit` | 선택. 현재 active 인원 이상이면서 2~30명 범위에서 증가·감소 가능 |
| `dateRange`, `dailyTimeRange`, `durationMinutes` | 선택. 생략 시 유지. 날짜 범위의 종료일은 한국 시간 오늘부터 3개월 이내(달력의 월 단위로 계산). 일일 시작은 00:00~23:30, 종료는 00:30~24:00의 30분 경계이며 서버는 분 값으로 변환 |

```json
{
  "votingDeadlineAt":"2026-10-21T18:00:00+09:00",
  "participantLimit":10,
  "dateRange":{"startDate":"2026-10-20","endDate":"2026-11-07"}
}
```

### **응답**

```json
{
  "promiseId":"7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus":"collecting",
  "currentConfirmation":null,
  "changeImpact":{"hasAddedSelectableSlots":true,"submissionsReset":true,"removedSlotCount":0,"versionChangedParticipantCount":5,"confirmationCleared":true}
}
```

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·필드 형식 오류 | — |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | — |
| 403 | FORBIDDEN | 다른 약속 소속 또는 권한 부족 | — |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | — |
| 409 | PROMISE_CANCELLED | 약속이 취소됨 | — |
| 409 | INVALID_PROMISE_STATE | 현재 상태에서 허용되지 않는 요청 | — |
| 422 | CAPACITY_BELOW_ACTIVE_COUNT | 정원이 현재 active 인원보다 작음 | — |
| 422 | VALIDATION_FAILED | 값이 비즈니스 규칙을 위반 | — |
| 500 | INTERNAL_ERROR | 서버 오류 | — |

### **처리 순서 / 비고**

#### **처리 순서**

1. promiseId 형식과 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션을 인증하고 promises 행을 잠근 뒤 취소 상태·최신 active host·closed 또는 confirmed 상태를 다시 확인한다.
2. 새 설정과 현재보다 미래인 `votingDeadlineAt`을 검증한다.
3. confirmed에서 재조율하는 경우 `confirmed_start_at=NULL`로 변경한다. 현재 ERD에는 과거 확정 이력 저장 구조가 없다.
4. 이전 선택 가능 슬롯 집합 A와 변경 후 집합 B를 계산하고, 새 범위 밖의 기존 슬롯만 삭제한다. 범위 안 슬롯은 유지한다.
5. `B-A`가 비어 있는 축소만 발생하면 제출 상태를 유지한다. 축소로 실제 슬롯이 삭제된 참여자의 `availability_version`만 1 증가시키며, 실제 슬롯이 삭제되지 않은 참여자의 버전은 변경하지 않는다.
6. `B-A`가 하나라도 있는 확대·이동이면 모든 active 참여자의 `availability_submitted_at=NULL` 처리와 `availability_version+1`을 수행한다. 제출 시각이 이미 NULL이어도 버전을 증가시킨다.
7. 범위를 변경하지 않았거나 소요 시간만 변경한 경우 슬롯·제출 상태·버전을 유지하고 후보만 새 길이로 계산한다. 설정 전용 버전은 두지 않으며 참여자 화면은 STATE-API-01의 settings 전체를 주기적으로 비교한다.
8. `status=collecting`과 새 마감을 저장한다. 빈자리가 있으면 정원을 바꾸지 않아도 신규 참여를 허용한다.
9. active 참여자의 현재 유효한 세션만 새 `votingDeadlineAt+7일`로 갱신한다. 이미 만료됐거나 cancelled 참여자에게 속한 세션은 다시 활성화하지 않는다.

#### **구현 결정 (2026-11-08, DECISION_CONFLICTS R-26)**

- 검사 순서: Origin 403 → promiseId 400 → 본문 400(JSON·필드 형식, `votingDeadlineAt` 누락) → 404 → 409 `PROMISE_CANCELLED`(세션보다 우선) → 401 → 403(다른 약속) → `promises` 행 잠금 → 잠금 후 cancelled 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403 → 허용 상태 확인 → 설정 검증 422 → 저장.
- 허용 상태: closed·confirmed, **마감 시각이 지난 collecting**(잠금 후 closed를 먼저 저장하고 진행 — 뒤에서 422가 나도 closed 저장은 남는다, STATE-API-05와 같음). 마감 전 collecting·draft(10분 경과 여부와 관계없이, 삭제 없음)는 409 `INVALID_PROMISE_STATE` `details.allowedStates=["closed","confirmed"]`. 같은 방장의 병렬 재조율은 두 번째가 잠금 후 collecting을 보고 409.
- 요청: `votingDeadlineAt` 필수, 나머지는 생략하면 유지. 필드 형식은 STATE-API-02와 같다(마감은 오프셋 필수). `null`·시작/종료 중 하나만 보낸 범위는 400, 모르는 필드는 무시.
- 검증: 기존 값과 합친 설정을 STATE-API-02와 같은 함수로 검증한다 — 정원 2~30 정수, 날짜 범위 종료는 한국 시간 오늘부터 3개월 이내(R-07, 노션 원문의 "90일"이 아님), 하루 범위 30분 경계, 소요 시간 30분 배수·하루 범위 이하, 마감은 판정 시각보다 뒤이면서 마지막 날짜 00:00보다 앞. **시작 날짜 하한(오늘 이후, R-12)은 `dateRange`를 보낸 경우에만** 본다(생략해 유지하면 이미 지난 시작일이어도 재조율 가능). 정원 < active 인원은 422 `CAPACITY_BELOW_ACTIVE_COUNT` `{ field: "participantLimit" }`, 그 밖은 422 `VALIDATION_FAILED` `{ field }`. 실패하면 아무것도 저장하지 않는다.
- 범위 변경 계산(순수 함수 `lib/state/range-change.ts`, STATE-API-03 공용): A·B는 날짜 × 하루 범위의 30분 칸. B 밖의 기존 슬롯만 삭제(지난 슬롯도 범위 밖이면 삭제). B−A 중 시작이 판정 시각보다 뒤인 칸이 하나라도 있으면 확대·이동 — 모든 active 참여자 제출 해제·버전 +1(미제출자 포함). 아니면 슬롯이 실제로 지워진 참여자만 버전 +1. **정리 대상은 active 참여자만**이고 탈퇴(cancelled) 참여자의 슬롯·제출·버전은 그대로 둔다(집계에서 이미 제외되고 기록 보존 원칙과 맞춤).
- 저장: 설정·`voting_deadline_at`·`status='collecting'`·`confirmed_start_at=NULL`(closed여도 NULL로 쓴다, 값은 원래 NULL) 한 번에. 같은 트랜잭션에서 `refreshActiveSessions`에 collecting·새 마감을 넘긴다.
- 응답 `changeImpact`: `hasAddedSelectableSlots`, `submissionsReset`(= 앞의 값), `removedSlotCount`(삭제한 슬롯 행 수), `versionChangedParticipantCount`, `confirmationCleared`(재조율 전 상태가 confirmed). 거절 응답(401·403·409·422)은 잠금 후 다시 읽은 세션 기준으로 쿠키를 갱신한다.

#### **보안 정보**

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## **STATE-API-07 — 약속 취소**

`POST /api/v1/promises/{promiseId}/cancel`

방장이 약속을 복원 불가능하게 취소한다. DB 데이터는 물리 삭제하지 않는다.

> 원문: [STATE-API-07](https://app.notion.com/p/STATE-API-07-3f87085f318280e0beb1d57442099b0e?pvs=21)

### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-01-02, STATE-10-01, REVIEW-03, REVIEW-16
- 권한: 현재 active host
- 허용 상태: draft / collecting / closed / confirmed
- 상태 전환: 취소 전 상태 → cancelled
- 동시성: promises 행 잠금 후 상태 변경과 전체 세션 만료를 한 트랜잭션으로 처리

### **1. 기본 정보**

- **목적:** 방장이 약속을 복원 불가능하게 취소한다. DB 데이터는 물리 삭제하지 않는다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/cancel`
- **Authentication Required:** 예
- **Request Body:** 없음

### **요청**

- Cookie, Accept, Origin 헤더를 사용한다.
- promiseId는 경로에서 받으며 요청자 ID와 role은 세션에서 확인한다.

### **응답**

```json
{
  "promiseId":"7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus":"cancelled",
  "cancelledAt":"2026-10-27T20:30:00+09:00",
  "message":"취소된 약속입니다."
}
```

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·필드 형식 오류 | — |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | — |
| 403 | FORBIDDEN | 다른 약속 소속 또는 권한 부족 | — |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | — |
| 409 | PROMISE_CANCELLED | 약속이 이미 취소됨 | — |
| 409 | INVALID_PROMISE_STATE | 현재 상태에서 허용되지 않는 요청 | — |
| 422 | VALIDATION_FAILED | 값이 비즈니스 규칙을 위반 | — |
| 500 | INTERNAL_ERROR | 서버 오류 | — |

### **처리 순서 / 비고**

#### **처리 순서와 데이터 보존**

1. promiseId 형식과 약속 존재 여부를 확인한다. 약속이 이미 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션 소속을 확인하고 promises 행을 잠근 뒤 취소 상태·최신 active host·허용 상태를 다시 확인한다.
2. `promises.status=cancelled`, `promises.cancelled_at=clock_timestamp()`로 함께 변경한다.
3. 설정과 모든 참여자 데이터를 보존한다. 참여자의 `role`, `status`, `cancelled_at`, 닉네임, PIN 해시, 가능 슬롯, 제출 시각, `availability_version`을 변경하지 않으며 `confirmed_start_at`도 보존한다. MVP에서는 취소 데이터를 자동 삭제하지 않는다. 후보는 저장 테이블이 없으므로 삭제 대상이 아니다.
4. 약속 취소는 참여자 탈퇴와 다르다. 약속이 `cancelled`로 변경되더라도 각 참여자를 `cancelled`로 바꾸거나 방장을 `member`로 내리지 않는다. 참여자 상태는 보존하고 모든 세션만 즉시 만료한다.
5. 해당 약속의 모든 세션 행은 삭제하지 않고 `expires_at=clock_timestamp()`로 갱신해 즉시 사용할 수 없게 한다. 응답 쿠키도 Max-Age=0으로 만료한다.
6. 기존 초대 링크는 유지하며 인증 없이 `cancelled`와 취소 안내만 반환한다. 상세 설정·입력·결과는 노출하지 않는다.
7. 취소 후 재로그인·재조율·복원은 허용하지 않는다.
8. 약속 취소 요청이 성공한 최초 요청에는 200 OK를 반환한다. 취소 트랜잭션 완료 후 동일 API를 포함한 일반 API를 다시 호출하면 세션 만료 여부와 관계없이 `409 PROMISE_CANCELLED`를 반환한다.

#### **구현 결정 (2026-11-08, DECISION_CONFLICTS R-25)**

- 검사 순서: Origin 403 → promiseId 400 → 404 → 409 `PROMISE_CANCELLED` → 401 → 403(다른 약속) → `promises` 행 잠금 → 잠금 후 cancelled 409 → 세션·참여자 재확인 401 → 최신 role이 host가 아니면 403 → 10분 지난 draft 410 → 저장.
- 링크를 잠그지 않는다(draft를 지우지 않음). **10분 지난 draft는 취소하지 않고 410 `DRAFT_EXPIRED`**(삭제 없음) — 취소를 저장하면 다시 방장 등록이 가능해야 할 링크가 영구히 cancelled가 되기 때문이다. STATE-API-02의 410과 맞췄다. 명세 허용 상태에는 없는 판단이다.
- 마감 지난 collecting도 closed를 거치지 않고 바로 cancelled로 저장한다(최종 상태가 같음).
- 저장: `status='cancelled'`, `cancelled_at`=잠금 후 `clock_timestamp()` 한 문장. 같은 트랜잭션에서 이 약속의 세션 중 아직 유효한 것을 참여자 상태와 관계없이(탈퇴자 포함) `expires_at`=같은 시각으로 바꾼다(`expireAllSessions`). 이미 만료된 세션은 원래 만료 시각을 둔다(지난 시각을 뒤로 미루지 않음).
- 응답 `cancelledAt`은 초 단위 `+09:00`, `message`는 "취소된 약속입니다.". 요청자 쿠키는 값을 비우고 Max-Age=0. 거절 응답(401·403·409·410)은 잠금 후 다시 읽은 세션 기준으로 쿠키를 갱신한다.
- 본문은 읽지 않는다. 명세 에러 표의 409 `INVALID_PROMISE_STATE`·422는 나올 경우가 없다(cancelled 외 네 상태는 모두 허용, 본문 없음).
- 확정·가능 시간 제출·마감과 같은 약속 행을 잠그므로 먼저 잠금을 잡은 요청이 이긴다. 취소가 먼저면 뒤 요청은 잠금 후 cancelled를 보고 저장 없이 409 `PROMISE_CANCELLED`.

#### **보안 정보**

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## **STATE-API-08 — 본인 탈퇴와 자동 승계**

`DELETE /api/v1/promises/{promiseId}/participants/me`

본인이 약속에서 나간다. draft에서는 초안을 물리 삭제하고 링크를 보존한다. collecting / closed / confirmed에서는 데이터를 보존한 채 탈퇴 처리하며, 후임자가 없는 마지막 방장의 요청은 방장 참여자 상태를 유지한 채 약속 전체 취소로 전환한다.

> 원문: [STATE-API-08](https://app.notion.com/p/STATE-API-08-3f87085f318280ffaef4f4a8cba7ea2d?pvs=21)

### **0. 규칙 연결**

- 도메인: STATE / MEMBER 연동
- 관련 규칙: STATE-06-01~02, MEMBER-10-03, MEMBER-12-01·03·04, REVIEW-11~13·17
- 권한: 해당 약속의 active 참여자
- 허용 상태: draft / collecting / closed / confirmed. cancelled는 거부
- 상태 전환: draft에서 방장이 나가면 초안을 물리 삭제하고 링크를 재사용 가능하게 한다. collecting / closed / confirmed에서는 일반 참여자와 후임자가 있는 방장을 탈퇴 처리한다. 후임자가 없는 방장은 참여자 상태를 유지한 채 약속만 cancelled로 전환한다.
- 동시성: promise_link_id를 잠금 없이 조회한 뒤 promise_links → promises 순서로 잠근다. 최신 상태·권한을 재검사하고 초안 폐기 또는 탈퇴·자동 승계·약속 취소와 관련 세션 처리를 한 트랜잭션으로 수행한다.

### **1. 기본 정보**

- **목적:** 본인이 약속에서 나간다. draft에서는 초안을 물리 삭제하고 링크를 보존한다. collecting / closed / confirmed에서는 데이터를 보존한 채 탈퇴 처리하며, 후임자가 없는 마지막 방장의 요청은 방장 참여자 상태를 유지한 채 약속 전체 취소로 전환한다.
- **HTTP Method:** DELETE
- **Endpoint:** `/api/v1/promises/{promiseId}/participants/me`
- **Authentication Required:** 예

### **요청**

본문과 participantId를 받지 않는다. 세션 참여자 본인만 처리한다.

### **응답**

일반 참여자의 탈퇴가 완료된 경우의 응답 예시다. 후임자가 있는 방장이 탈퇴한 경우에도 같은 필드를 반환하되 `hostTransferred=true`, `newHostParticipantId=후임 참여자 UUID`를 반환한다. 성공 응답은 `200 OK`다.

```json
{
  "promiseId":"7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus":"confirmed",
  "participantStatus":"cancelled",
  "participantCancelledAt":"2026-10-27T20:30:00+09:00",
  "hostTransferred":false,
  "newHostParticipantId":null,
  "promiseCancelledAt":null
}
```

후임자가 없는 마지막 방장의 요청이 약속 취소로 전환된 경우:

```json
{
  "promiseId":"7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus":"cancelled",
  "participantStatus":"active",
  "participantCancelledAt":null,
  "hostTransferred":false,
  "newHostParticipantId":null,
  "promiseCancelledAt":"2026-10-27T20:30:00+09:00"
}
```

두 번째 응답의 `participantStatus=active`는 탈퇴 후에도 활동을 허용한다는 뜻이 아니다. 약속 취소 정책에 따라 참여자 원본 상태를 보존한 결과이며, 모든 세션이 즉시 만료되고 cancelled 약속의 후속 요청은 차단된다.

`draft` 에서 방장이 탈퇴해 초안이 폐기된 경우 :

```json
{
  "result": "draft_discarded",
  "promiseId": null
}
```

약속과 방장 기록이 물리 삭제되었으므로 기존 promiseId는 더 이상 유효하지 않다. 클라이언트는 쿠키가 제거된 상태로 링크 첫 화면(MEMBER-API-01)으로 돌아가며, 링크는 다른 사용자가 다시 방장 등록할 수 있다.

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·필드 형식 오류 | — |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | — |
| 403 | FORBIDDEN | 다른 약속 소속 또는 권한 부족 | — |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | — |
| 409 | PROMISE_CANCELLED | 약속이 취소됨 | — |
| 409 | INVALID_PROMISE_STATE | 현재 상태에서 허용되지 않는 요청 | — |
| 422 | VALIDATION_FAILED | 값이 비즈니스 규칙을 위반 | — |
| 500 | INTERNAL_ERROR | 서버 오류 | — |

### **처리 순서 / 비고**

#### **처리 순서**

1. `promiseId` 형식과 약속 존재 여부를 확인한다. 약속이 이미 `cancelled`이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 이 단계에서는 행을 잠그지 않고 해당 약속의 `promise_link_id`만 함께 읽는다.
2. 세션과 요청자의 약속 소속을 확인한다. 한 트랜잭션 안에서 `promise_links → promises` 순서로 행을 `FOR UPDATE`로 잠근다. 이 API는 draft 폐기 가능성이 있으므로 모든 분기에서 같은 잠금 순서를 사용하며, promises를 먼저 잠근 뒤 링크 잠금을 추가하지 않는다. 잠금 후 원래 요청한 약속이 여전히 존재하는지, 취소 상태인지, 세션이 유효한지, 요청자가 해당 약속의 active 참여자인지와 최신 role을 다시 확인한다. 그사이 약속이 삭제됐다면 `404 PROMISE_NOT_FOUND`, 취소됐다면 인증 오류보다 우선하여 `409 PROMISE_CANCELLED`를 반환하며 같은 링크에 새로 생성된 다른 약속을 대신 처리하지 않는다.
3. 잠금 후 약속이 `draft`이면 현재 active host만 초안 폐기를 수행한다. `participant_sessions → 방장 participants → promises` 순서로 명시적으로 물리 삭제하고 `promise_links` 행은 보존한다. 모든 FK의 `ON DELETE RESTRICT`를 유지하며 자동 CASCADE에 의존하지 않는다. 응답 쿠키를 제거하고 커밋 후 `200 OK`와 `result=draft_discarded, promiseId=null`을 반환한다. 이 분기에서는 아래 일반 탈퇴·자동 승계·약속 취소 처리를 실행하지 않는다.
4. draft가 아니면 공통 마감 규약을 적용한다. 잠금 후 DB `status=collecting`이고 현재 시각이 `voting_deadline_at` 이상이면 `closed`로 반영한다. 이후 `collecting / closed / confirmed`에서 다음 역할별 분기를 수행한다.
5. 일반 참여자이면 `participants.status=cancelled`, `participants.cancelled_at=clock_timestamp()`를 함께 기록한다. 해당 참여자의 모든 세션 행은 삭제하지 않고 `expires_at=clock_timestamp()`로 즉시 만료한다. 이 경우 방장 승계 분기는 실행하지 않는다.
6. 방장이면 본인을 제외한 active 참여자 중 `created_at ASC, id ASC` 순서의 첫 참여자를 후임자로 선정한다. 제출 여부는 승계 조건으로 사용하지 않는다.
7. 후임자가 있으면 기존 방장의 `role=member, status=cancelled, cancelled_at=clock_timestamp()`를 같은 UPDATE로 변경한 뒤 새 방장의 `role=host`를 지정한다. 새 방장의 `status=active, cancelled_at=NULL`은 유지한다. 기존 방장의 모든 세션을 즉시 만료한다. 기존 방장 변경을 먼저 수행하여 방장 UNIQUE 제약과 `host이면 active` CHECK를 준수한다.
8. 후임자가 없으면 방장 참여자 탈퇴를 완료하지 않고 약속 전체 취소로 전환한다. 기존 방장의 `role=host, status=active, cancelled_at=NULL`은 유지하고 `promises.status=cancelled, promises.cancelled_at=clock_timestamp()`만 변경한다. 다른 참여자 행의 role·status·cancelled_at도 변경하지 않고 해당 약속의 모든 세션을 즉시 만료한다. 이는 이미 취소된 약속에서 탈퇴를 허용하는 규칙이 아니라, 취소되지 않은 약속의 마지막 방장 요청을 약속 취소로 전환하는 예외다.
9. 일반 참여자 탈퇴 또는 방장 승계가 완료되면 탈퇴자를 정원·후보·가능 인원·참석자 등 모든 active 집계에서 제외한다. draft 폐기를 제외한 모든 분기에서 닉네임·PIN 해시·가능 슬롯·제출 시각·`availability_version`은 보존하며 MVP에서는 자동 삭제하지 않는다.
10. 약속이 취소되지 않고 `closed`로 남으면 다음 후보 조회에서 최신 active 참여자 기준으로 다시 계산한다. `confirmed`로 남으면 약속 상태와 `confirmed_start_at`을 유지하고 다음 조회에서 참석자 명단을 갱신한다. 이 경우 참석 가능 인원이 2명 미만이어도 자동 확정 해제·자동 취소하지 않으며 STATE-API-01의 `hostActionRequired`로 방장에게 재조율·취소를 안내한다. 마지막 방장 요청으로 약속 전체를 취소한 분기에는 이 유지 규칙을 적용하지 않는다.
11. 관련 상태·역할·시각 기록·세션 처리는 같은 트랜잭션으로 커밋하며 하나라도 실패하면 전체 롤백한다. 성공 시 요청 브라우저의 해당 약속 쿠키도 `Max-Age=0`으로 제거하고 `200 OK`를 반환한다. 약속 취소로 전환된 최초 요청에도 성공 결과를 반환하되, 이후 취소된 약속의 동일 API 및 일반 API 요청은 `409 PROMISE_CANCELLED`로 거절한다.

#### **보안 정보**

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## **STATE-API-09 — MEMBER·TIME 상태 제한 연동**

내부 공통 가드 — 독립 HTTP 엔드포인트 없음

신규 참여, 본인 탈퇴, 내보내기, 가능 시간 제출·재제출 등에 동일한 약속 상태 제한을 적용한다.



### **0. 규칙 연결**

- 도메인: STATE / MEMBER / TIME 연동
- 근거: 최신 ERD의 상태·권한·동시성·보존 규칙과 STATE-API-00~08·10
- 공통 계약: [STATE-API-00](https://app.notion.com/p/STATE-API-00-3f87085f31828013ab20dcd75b849ed2?pvs=21)
- 권한·허용 상태: 호출하는 작업별로 아래 표를 적용한다. 신규 참여처럼 아직 참여자가 없는 요청에 기존 active 참여자 세션을 일괄 요구하지 않는다.
- 역할: MEMBER·TIME의 개별 API가 공통으로 적용할 상태·마감·잠금 규칙이다. 별도의 탈퇴 API나 외부 엔드포인트를 추가하지 않는다.

### **1. 기본 정보**

- **목적:** 신규 참여, 본인 탈퇴, 내보내기, 가능 시간 제출·재제출 등에 동일한 약속 상태 제한을 적용한다.
- **HTTP Method:** 없음 — 내부 공통 가드
- **Endpoint:** 없음 — 외부 호출 대상 아님
- **Authentication Required:** 호출 API의 인증 계약을 따른다. 기존 참여자의 작업은 약속별 유효 세션·소속·active 상태를 확인하고, 방장 전용 작업은 최신 host 권한을 확인한다.
- **범위:** 상태·권한·마감·동시성 연동만 정의한다. MEMBER의 등록·로그인 요청 형식이나 TIME의 제출·조회 명세를 여기서 새로 정의하지 않는다.

### **2. 적용 작업과 허용 조건**

| 작업 | 상태·권한 조건 | 처리 기준 |
| --- | --- | --- |
| 신규 참여 | effectiveStatus=collecting, 마감 전, active 인원 \< 정원 | 닉네임 중복·정원·상태를 잠금 후 다시 검사한다. 등록·인증 방식은 MEMBER 계약을 따른다. |
| 가능 시간 제출·재제출 | 해당 약속의 active 참여자, effectiveStatus=collecting, 마감 전 | 잠금 후 마감·범위·기준 availability_version을 검사한다. 슬롯과 제출 상태·버전은 같은 트랜잭션으로 반영한다. 세부 요청·재시도 계약은 TIME 및 ERD를 따른다. |
| 본인 탈퇴·나가기 | 해당 약속의 active 참여자, draft / collecting / closed / confirmed | draft의 방장 나가기는 초안 폐기다. 그 외 상태의 탈퇴·승계·후임 없음 분기는 STATE-API-08을 따른다. |
| 방장의 참여자 내보내기 | 현재 active host, effectiveStatus=collecting, 마감 전 | closed·confirmed에서는 거절하고 재조율 후 처리한다. 대상 참여자·권한 검증은 MEMBER 계약도 적용한다. |
| 모집 중 설정 변경 | 현재 active host, collecting이며 마감 전 | STATE-API-03. closed·confirmed에서 직접 설정 변경은 허용하지 않는다. |
| 방장 마감 | 현재 active host, collecting 또는 closed | STATE-API-04. collecting은 closed로 변경하고 이미 closed이면 변경 없이 현재 상태를 반환한다. |
| 공식 후보 조회 | active 참여자, effectiveStatus=closed | STATE-API-10. GET은 DB 상태를 변경하지 않는다. |
| 최종 일정 확정 | 현재 active host, closed | STATE-API-05. 미래 시각·범위·최신 공통 가능 인원을 재검증한다. confirmed의 직접 일정 교체는 금지한다. |
| 재조율 시작 | 현재 active host, closed / confirmed | STATE-API-06. 미래 마감·새 설정을 검증하고 collecting으로 전환한다. |
| 약속 취소 | 현재 active host, draft / collecting / closed / confirmed | STATE-API-07. 약속만 cancelled로 변경하고 참여자 상태는 보존한다. draft 취소와 STATE-API-08의 draft 나가기(폐기)는 서로 다른 동작이다. |

이미 cancelled인 약속의 일반 API는 위 허용 조건과 세션 인증 결과보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 인증 없는 초대 링크 접근에는 취소 안내만 제공하고 설정·참여자·입력·결과를 노출하지 않는다.

### **3. 공통 처리 계약**

#### **조회와 쓰기의 상태 판정**

1. 호출 API의 경로·필드 형식을 검사하고 대상 약속을 확인한다. 약속이 cancelled이면 인증 결과보다 먼저 취소 오류를 반환한다.
2. 취소되지 않은 약속은 호출 API의 인증·소속·권한 조건을 확인한다. 신규 참여와 초대 링크 조회에 기존 참여자 세션 검사를 잘못 적용하지 않는다.
3. GET은 읽기 기준의 서버 시각으로 effectiveStatus를 계산한다. DB status=collecting이고 현재 시각이 voting_deadline_at 이상이면 closed로 판단하되 DB에는 쓰지 않는다.
4. 쓰기 요청은 아래 잠금 규칙을 적용한 뒤 약속 존재·취소 상태·요청자 참여 상태·권한·마감·정원을 필요한 범위에서 다시 검사한다. 인증 자체가 실패한 요청은 약속 DB 상태를 변경하지 않는다.
5. 잠금 후 collecting의 마감 시각에 도달했다면 공통 규약에 따라 closed로 반영한 뒤 해당 작업의 허용 상태를 검사한다. 제출·신규 참여·모집 중 설정 변경은 거절하고, closed에서도 허용되는 탈퇴·확정·재조율 등은 각 API 규약에 따라 처리한다.
6. 전원 제출은 자동 마감 조건이 아니다. 응답자가 0명 또는 1명이어도 기한에 도달하면 마감으로 판정한다.

#### **잠금과 원자성**

- 일반적인 같은 약속의 변경은 promises 행 잠금으로 직렬화한다. 참여자·슬롯을 변경하는 경로도 같은 규약을 따른다.
- 링크와 약속을 함께 잠그는 경로는 항상 `promise_links → promises` 순서를 따른다. promises를 먼저 잡은 뒤 링크 잠금을 추가하지 않는다.
- STATE-API-08은 draft 폐기 가능성이 있으므로 promise_link_id를 잠금 없이 조회한 다음 처음부터 링크 → 약속 순서로 잠근다. 상태·권한은 잠금 후 다시 판정한다.
- 초안 생성·10분 만료 정리·초안 나가기와 관련된 동시 요청도 링크 → 약속 잠금 순서를 공유한다. 잠금 대기 중 약속이 삭제되거나 상태가 바뀌면 오래된 조회 결과로 처리하지 않는다.
- 해당 작업의 역할·참여 상태·슬롯·제출 상태·버전·세션 등 관련 변경은 각 API에서 정한 트랜잭션 경계 안에서 함께 반영한다.

#### **탈퇴·취소·초안 폐기의 구분**

| 경우 | 약속·참여자 처리 | 세션·링크 |
| --- | --- | --- |
| draft에서 방장 나가기 | 세션 → 방장 참여자 → promise를 명시적으로 물리 삭제 | 요청 브라우저 쿠키 제거, 링크는 보존하여 재사용 |
| 10분 만료 draft 정리 | GET은 만료만 계산. 쓰기 경로의 정리 절차에서 자식부터 명시적으로 삭제 | 링크 보존, RESTRICT 유지 |
| 일반 참여자 탈퇴·내보내기 | 해당 participants.status=cancelled와 cancelled_at을 함께 기록하고 데이터 보존 | 해당 참여자의 모든 세션 즉시 만료 |
| draft가 아닌 약속의 방장 탈퇴·후임 있음 | 기존 방장을 member + cancelled로 변경하고 cancelled_at 기록 후 새 방장 지정 | 기존 방장의 모든 세션 즉시 만료 |
| draft가 아닌 약속의 방장 탈퇴·후임 없음 | 방장의 host + active + cancelled_at=NULL 유지. 약속만 cancelled + cancelled_at 기록 | 약속의 모든 세션 즉시 만료, 링크 보존 |
| 방장의 약속 취소 | promises.status=cancelled와 cancelled_at 기록. 모든 참여자의 role·status·cancelled_at 및 설정·입력·확정 일정 보존 | 약속의 모든 세션 즉시 만료, 링크 보존 |

draft 폐기를 제외한 취소·탈퇴·내보내기에서는 관련 데이터와 세션 행을 삭제하지 않는다. 세션은 expires_at을 현재 시각으로 변경한다. 취소된 약속에 active 참여자가 기록상 남아 있어도 재로그인·조회·변경 권한이 생기지 않는다.

상세 응답·분기·쿠키 처리는 [STATE-API-08](https://app.notion.com/p/STATE-API-08-3f87085f318280ffaef4f4a8cba7ea2d?pvs=21)과 [STATE-API-07](https://app.notion.com/p/STATE-API-07-3f87085f318280e0beb1d57442099b0e?pvs=21)을 따른다. 약속이 취소되지 않은 closed·confirmed의 탈퇴는 기존 약속 상태를 유지한다. confirmed의 참석 가능 인원이 2명 미만이 되어도 자동 확정 해제·자동 취소하지 않고 방장에게 안내한다.

#### **설정 변경·제출 상태 연동**

- 날짜·하루 시간 범위가 축소되기만 하면 범위 밖 슬롯을 제거하고 제출 상태를 유지한다. 실제 슬롯이 삭제된 참여자의 availability_version만 증가한다.
- 새로운 선택 가능 슬롯이 하나라도 추가되는 확대·이동이면 모든 active 참여자의 availability_submitted_at을 NULL로 변경하고 availability_version을 증가시킨다.
- 범위가 같고 소요 시간만 변경되면 슬롯·제출 상태·버전을 유지하고 후보를 새 소요 시간으로 계산한다. confirmed 상태의 직접 소요 시간 변경은 금지하며 재조율을 거친다.
- 설정 전용 버전은 두지 않는다. 화면은 STATE-API-01의 settings 전체를 주기적으로 조회·비교한다. availability_version은 개인 응답 변경 기준이지 약속 전체 설정 버전이 아니다.
- 세션 만료 시각 연장은 active 참여자의 현재 유효한 세션에만 적용한다. 이미 만료된 세션이나 cancelled 참여자 세션을 다시 활성화하지 않는다.

#### **반환·오류 연결**

이 문서는 독립 HTTP 요청·성공 응답을 정의하지 않는다. 가드 통과 후 호출 API의 처리를 계속하고, 실패하면 호출 API의 공통 오류 형식을 따른다.

- `400 INVALID_REQUEST`: 요청 형식 오류
- `404 PROMISE_NOT_FOUND`: 대상 약속 없음
- `409 PROMISE_CANCELLED`: 약속 취소. 세션 인증 오류보다 우선
- `401 UNAUTHENTICATED`: 인증이 필요한 작업에서 세션 없음·만료·검증 실패 또는 참여자 비활성
- `403 FORBIDDEN`: 약속 소속·역할 등 필요한 권한 불충족
- `409 INVALID_PROMISE_STATE`: 마감 판정을 반영한 현재 상태에서 해당 작업 불가
- 정원·입력 범위·버전 충돌·draft 만료 등 작업별 오류는 해당 API의 코드와 계약을 따른다. 여기서 다른 코드로 다시 정의하지 않는다.

#### **보안 정보**

- 기존 참여자의 인증은 약속별 HttpOnly 쿠키와 session_token_hash로 확인한다. 요청 본문의 participantId·role·isHost를 권한 근거로 사용하지 않는다.
- 일반 API의 cancelled 판정을 누락하지 않는다. 약속 취소 시 참여자가 active로 보존되므로 참여자 상태만 검사해서는 안 된다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문과 호출 API에서 허용하지 않은 개인 입력은 응답·로그에 노출하지 않는다.

---

## **STATE-API-10 — 공식 시간 후보 조회**

`GET /api/v1/promises/{promiseId}/candidates`

마감된 약속의 전체 범위에서 미래 유효 후보를 공통 가능 인원·시작 시각 순으로 조회한다.



### **0. 규칙 연결**

- 도메인: STATE
- 관련 규칙: STATE-05-01 / ERD 설명서 7.1~7.3 후보 계산 조건
- 관련 US: 현재 원본에 연결된 US ID 없음
- 근거: 제공한 시간 조율 ERD 설명서 7.1~7.3·8.2절 및 해당 Notion 상태 규칙
- 권한: 해당 약속의 active 참여자
- 허용 상태: closed
- 상태 전환: 없음. 기한 도달 collecting은 effectiveStatus=closed로 계산하며 기한 전 collecting은 409
- 동시성: DB 상태를 변경하지 않고 일관된 읽기 기준과 서버 시각 1회로 후보 계산
- TBD: 없음. 탈퇴 참여자는 status=cancelled로 집계에서 제외하며 확정 후 탈퇴는 기존 확정 일정을 바꾸지 않는다.
- 기존 공통 규약: [Notion 참고 문서](https://app.notion.com/p/MEMBER-API-00-3f67085f31828163a34ff6da7b3180a6?pvs=21)

### **1. 기본 정보**

- **목적:** 마감된 약속의 전체 범위에서 미래 유효 후보를 공통 가능 인원·시작 시각 순으로 조회한다.
- **HTTP Method:** GET
- **Endpoint:** `/api/v1/promises/{promiseId}/candidates`
- **Authentication Required:** 예 — 약속별 세션 쿠키
- **Content Type:** application/json; charset=utf-8
- 성공 응답은 기존 MEMBER와 같은 래퍼 없는 JSON이다. 필드·URI·조회 페이지 크기 등 기술 계약은 아래와 같이 정하며 새로운 제품 정책을 추가하지 않는다.

### **요청**

#### **헤더**

| Name | Value | 필수 |
| --- | --- | --- |
| Cookie | ys_session_{promiseId}=… | 예 |
| Accept | application/json | 권장 |

#### **Path Parameter**

| 이름 | 타입 | 설명 | 필수 |
| --- | --- | --- | --- |
| promiseId | string(UUID) | 초대 링크 조회나 방장 등록으로 받은 약속 ID | 예 |

#### **Query Parameter**

| 이름 | 타입 | 설명 | 필수 | 기본값 |
| --- | --- | --- | --- | --- |
| limit | integer | 1~5. 한 번에 반환할 개수 | 아니오 | 5 |
| offset | integer | 0 이상의 결과 시작 위치 | 아니오 | 0 |

#### **Request Body**

본문 없음. 요청자 ID·역할은 세션과 DB에서 확인한다.

### **응답**

#### **Status Code: 200 OK**

| 이름 | 타입 | 설명 |
| --- | --- | --- |
| promiseId | string(UUID) | 약속 ID |
| promiseStatus | closed | 현재 시각을 반영해 계산한 effectiveStatus. DB status는 collecting일 수 있음 |
| calculatedAt | string(date-time) | 이번 후보 계산의 서버 기준 시각 |
| limit / offset | integer | 적용한 페이지 요청 |
| total | integer | 이 시각의 전체 유효 후보 개수 |
| hasMore | boolean | 추가 후보 여부 |
| nextOffset | integer 또는 null | 추가 요청 위치; 없으면 null |
| candidates | array | 이번 페이지의 후보 |
| candidates\[\].startAt / endAt | string(date-time) | 미래 시작 / 시작+소요 시간 |
| candidates\[\].availableParticipantCount | integer | 전체 연속 구간 공통 가능 인원, 2 이상 |

#### **Response Body**

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "closed",
  "calculatedAt": "2026-10-19T18:01:00+09:00",
  "limit": 5,
  "offset": 0,
  "total": 1,
  "hasMore": false,
  "nextOffset": null,
  "candidates": [
    {
      "startAt": "2026-10-20T14:00:00+09:00",
      "endAt": "2026-10-20T15:00:00+09:00",
      "availableParticipantCount": 3
    }
  ]
}
```

#### **후보 없음: 오류가 아닌 200**

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "closed",
  "calculatedAt": "2026-10-19T18:01:00+09:00",
  "limit": 5,
  "offset": 0,
  "total": 0,
  "hasMore": false,
  "nextOffset": null,
  "candidates": []
}
```

### **에러**

| HTTP 상태 | code | 발생 원인 | message 예시 |
| --- | --- | --- | --- |
| 400 | INVALID_REQUEST | UUID·JSON·쿼리·필수값 형식 오류 | 요청 형식을 확인해 주세요. |
| 401 | UNAUTHENTICATED | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | 다시 로그인해 주세요. |
| 403 | FORBIDDEN | 다른 약속 소속 또는 방장 권한 부족 | 이 작업을 수행할 권한이 없습니다. |
| 404 | PROMISE_NOT_FOUND | 약속 없음 | 약속을 찾을 수 없습니다. |
| 409 | PROMISE_CANCELLED | 약속이 취소됨 | 취소된 약속입니다. |
| 409 | INVALID_PROMISE_STATE | 이 API에서 허용하지 않는 약속 상태 | 현재 약속 상태에서는 요청할 수 없습니다. |
| 500 | INTERNAL_ERROR | 서버 오류 | 처리 중 오류가 발생했습니다. |
| 422 | VALIDATION_FAILED | limit이 1~5가 아니거나 offset이 음수·정수가 아님 | 후보 조회 범위를 확인해 주세요. |

#### **오류 응답 예제**

```json
{
  "code": "INVALID_PROMISE_STATE",
  "message": "응답 마감 후 후보를 조회할 수 있습니다.",
  "details": {
    "promiseStatus": "collecting",
    "allowedStates": [
      "closed"
    ]
  }
}
```

### **처리 순서 / 비고**

#### **처리 순서와 ERD 대응**

1. limit·offset과 promiseId 형식을 검증하고 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다.
2. 세션과 active 참여 상태를 확인한다. 이 API는 GET이므로 DB status를 변경하거나 약속 행을 쓰기 잠금하지 않는다.
3. DB `status=collecting`이고 현재 시각이 `voting_deadline_at` 이상이면 `effectiveStatus=closed`로 계산한다. 응답의 `promiseStatus`에는 effectiveStatus를 반환한다.
4. effectiveStatus가 closed가 아니면 409를 반환한다. confirmed에서는 확정 일정 조회를 사용한다.
5. 공통 후보 계산 계약에 따라 전체 날짜 범위의 모든 유효 후보를 일관된 읽기 기준으로 계산한다. 화면에 보이는 주로 제한하지 않는다.
6. active이고 제출 완료인 동일 참여자들의 모든 연속 슬롯 참석을 집계한다. 2명 이상 후보만 포함하고 인원 내림차순·시작 오름차순으로 정렬한다.
7. 해당 계산 시각의 후보 전체 개수를 total로 반환하고 offset부터 limit개를 반환한다. offset이 전체 개수 이상이면 빈 배열·hasMore=false·nextOffset=null이다.
8. 현재 ERD에 추천 결과 테이블이 없으므로 후보 ID나 영구 순위를 만들지 않는다. 후보 식별은 startAt이며 유효성은 확정 요청 때 다시 계산한다.
9. 페이지 요청 사이에 시간·참여 데이터가 바뀌면 total·순서가 달라질 수 있다. calculatedAt을 반환하고 정해진 결과 스냅샷을 보장하지 않는다.
10. 공식 후보 조회 응답에는 참여자별 슬롯·제출 여부·닉네임 목록을 포함하지 않는다.

#### **구현 결정 (2026-11-06, DECISION_CONFLICTS R-20)**

- 검사 순서: promiseId 400 → limit·offset 422(`details.field`) → 404 → 409 `PROMISE_CANCELLED` → 401 → 403 → 409 `INVALID_PROMISE_STATE`. limit·offset은 10진 정수 표기만 받는다.
- 후보 시작은 계산 시각보다 뒤(시작 = 계산 시각이면 제외)다. 계산 시각은 읽기 트랜잭션(REPEATABLE READ, 잠금 없음)의 `now()` 하나다.
- draft는 10분이 지났어도 409 `INVALID_PROMISE_STATE`(`promiseStatus: "draft"`)다.
- 계산 함수는 `lib/state/candidates.ts`의 `computeCandidates`이며 STATE-API-05 확정 재검증에서 재사용한다.

#### **코드 예제**

```javascript
const response = await fetch(`/api/v1/promises/${promiseId}/candidates?limit=5&offset=0`, {
  method: 'GET',
  credentials: 'include',
  headers: { Accept: 'application/json' },
});
const result = await response.json();
if (!response.ok) {
  // code를 기준으로 로그인·후보 재조회·상태 변경을 안내한다.
  throw result;
}
```

#### **보안 정보**

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

