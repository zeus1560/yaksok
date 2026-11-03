# 참여자 재인증 API (MEMBER-API-04)

## 식별자와 상태

- 스펙 ID: `004-participant-login-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-04-01, MEMBER-04-02(다중 기기), MEMBER-06-01(PIN), MEMBER-06-03(인증 유지 기간), MEMBER-06-04(❗미결, 시도 제한), MEMBER-06-02(❗미결, PIN 분실), MEMBER-01-02(링크 만료 기준), STATE-02-02(draft 10분), STATE-10-01(취소)
- ERD: DATABASE.md 9절(실패 메시지 통일), 3.5(세션)
- API: MEMBER-API-04 (`docs/specs/api/member.md`), API_CONVENTIONS 3절·4.2·5절·5.2·6절·7절, STATE API 공통 에러 코드(`docs/specs/api/state.md`)
- 관련 미결·충돌: A-09(Origin — 이번에 04 반영), A-04(해결), C-07(진행), R-11(이번 결정), C-10·C-11(신규 미결)

## 사용자와 문제

다른 기기·브라우저에서 같은 약속에 다시 들어온 참여자가 닉네임·PIN으로 본인임을 확인하고 세션을 받아야 한다. 방장·참여자 등록 응답이 유실됐을 때 본인 성공 여부를 판별하는 수단이기도 하다(API_CONVENTIONS 6절).

## 목표와 범위

- 이번에 구현할 동작: `POST /api/v1/promises/[promiseId]/auth/session`, 약속 상태 판정(순수 함수), PIN 검증·더미 해시, 세션 생성·쿠키, 에러 헬퍼, 문서 갱신
- 이번에 구현하지 않을 동작: 시도 제한·레이트 리밋(2026-10-12 결정), PIN 분실 복구, 화면, 확정·조기 마감 시 기존 세션 갱신(STATE API 몫)

## 선행 작업

003-host-registration-api (`verifyPin`, `normalizeNickname`/`validateNickname`, `session.ts`), 002-link-lookup-api (`linkExpiryBase`). 병합 확인: main 21aa399.

## 사용자 흐름

로그인 화면에서 닉네임·PIN 입력 → `POST …/auth/session` → Origin 검증 → 본문 검증(닉네임 trim → NFC) → 약속 조회 + DB `clock_timestamp()` → 상태 판정 → 참여자 조회 + PIN 검증(행 없으면 더미 해시) → 참여 상태 → 새 세션 행 → 200 + 쿠키.

## 수용 기준

- [x] AC-1 (API_CONVENTIONS 7절, A-09): Origin 없음·불일치 → 403 `INVALID_ORIGIN`
- [x] AC-2 (API_CONVENTIONS 3절): JSON 파싱 실패·필드 누락·문자열 아님 → 400 `INVALID_REQUEST`
- [x] AC-3 (MEMBER-05-01, R-10): 닉네임은 등록과 같은 규칙(trim → NFC, 2~12자, 이모지 불가), PIN 형식과 함께 위반 → 422 `VALIDATION_FAILED`
- [x] AC-4: promiseId UUID 형식 오류·없는 약속 → 404 `PROMISE_NOT_FOUND`
- [x] AC-5 (STATE-10-01, STATE-02-02, MEMBER-01-02, R-11): PIN 검증 전 상태 판정. cancelled → 409 `PROMISE_CANCELLED`, 10분 지난 draft → 404(삭제 없음), `linkExpiryBase + 7일 ≤ 판정 시각` → 410 `ACCESS_PERIOD_EXPIRED`. 확정 약속은 `confirmed_start_at` 기준
- [x] AC-6 (ERD 9, API_CONVENTIONS 7절): 없는 닉네임·틀린 PIN 모두 401 `INVALID_CREDENTIALS`, 같은 본문, 행 없어도 더미 해시 비교, 실패 반환 지점 한 곳
- [x] AC-7: 인증 성공 후 cancelled 참여자 → 403 `PARTICIPANT_CANCELLED`
- [x] AC-8 (MEMBER-04-02, API_CONVENTIONS 5.2): 새 세션 행만 생성, 기존 세션 유지. draft = 발급 시각 + 24시간, 그 외 = `linkExpiryBase + 7일`. 쿠키는 `sessionCookie`, Max-Age = 남은 초
- [x] AC-9: 세션 저장 P2003 → 404
- [x] AC-10 (MEMBER-API-04): 200 본문 6개 필드, `sessionExpiresAt` +09:00
- [x] AC-11: PIN·세션 토큰 원문이 로그·응답에 없음, 429 없음

## 데이터와 인터페이스

스키마 변경 없음. 읽기: `promises`(+`promise_links.created_at`), `participants`. 쓰기: `participant_sessions` 1행 생성. 계약은 MEMBER-API-04 참조(에러 표 400·403·410·422 추가).

## 구현 계획

1. `lib/member/session.ts`: `sessionMaxAgeSeconds(expiresAt, now)`
2. `lib/member/login.ts`: `resolveLoginAccess`(순수 판정), `loginParticipant`(조회·검증·세션 생성)
3. `lib/api-error.ts`: 401·403·404·409·410 헬퍼
4. `app/api/v1/promises/[promiseId]/auth/session/route.ts`
5. 문서: member.md(MEMBER-API-04), API_CONVENTIONS(3절 에러 코드, 5.2), DECISION_CONFLICTS(R-11, C-07·C-10·C-11, A-04·A-09)

## 검증 계획

- Vitest: 판정 단위(cancelled, draft 진행·10분 경계, 마감 + 7일 경계, 확정 후, 재조율), 인증(401 동일, 더미 해시, cancelled 403), 세션(새 행만, 24시간·+7일, Max-Age), 라우트(403·400·422·404·P2003·NFC)
- lint / typecheck / test / build
- dev 서버 + 개발 DB: 방장 등록(조합형 닉네임) → 쿠키 없이 로그인 → 세션 2행, NFC 코드포인트 확인, 데이터 삭제

## 미정 사항

- 결정(R-11): 로그인 가능 기간 = 링크 유효 기간, draft 로그인 허용(24시간), 에러 코드 STATE 기준 통일, 시도 제한 미구현(공개 배포 전 필수 재검토).
- 아래 해석 4건은 2026-11-04 승인됨.
- 해석: draft 세션의 "발급 시각"은 상태 판정에 쓴 DB 시각이다. 세션 행 저장은 PIN 검증(수십 ms) 뒤라 실제 저장 시각보다 그만큼 이르다.
- 해석: Max-Age도 판정 시각 기준 남은 초(내림)다. 쿠키 발급까지 PIN 검증 시간만큼 지나므로 쿠키가 DB 세션보다 최대 1초 미만 늦게 만료될 수 있다. 서버는 매 요청 `expires_at`을 확인하므로 권한에는 영향 없다.
- 해석: 쿠키 이름·Path에는 경로 값 대신 DB의 약속 id(소문자 UUID)를 쓴다(MEMBER-API-02와 같음). 대문자 UUID로 요청해도 조회는 되지만 쿠키 Path는 소문자다.
- 해석: 응답 시간 균등화는 "행 없음 vs PIN 틀림"에만 적용한다. 상태 판정 실패(404·409·410)는 PIN 검증 전에 끝나므로 더 빠르다 — 닉네임 존재 여부와 무관해 노출 정보는 없다.
- 미결(C-10): 확정 시 기존 세션을 `confirmed_start_at + 7일`로 갱신해야 함 — STATE 확정 API에서 처리.
- 미결(C-11): 조기 마감 시 세션 기준(실제 마감 처리 시각)과 링크 기준(`voting_deadline_at`)의 차이.
- 팀 확인 대기(C-07): 로그인 403 `PARTICIPANT_CANCELLED`, 세션 인증 API 401 `UNAUTHENTICATED`로 구분하는 안. 근거: 403은 닉네임·PIN이 모두 맞아야 나가므로 정보 노출이 없고 본인에게 정확한 안내가 된다.
- 남은 불일치(이번 범위 밖, 수정 안 함): member.md MEMBER-API-06의 cancelled 행이 아직 409 `INVALID_PROMISE_STATE`. MEMBER-API-03 에러 표에도 cancelled 구분이 없다. 해당 API 구현 시 `PROMISE_CANCELLED`로 맞춘다.

## 결과

- 수용 기준 AC-1~11 충족 (2026-11-04). Vitest 157건(이번 45건), lint·typecheck·build 통과. 개발 DB에서 조합형 닉네임 등록 → 쿠키 없이 로그인 200, 세션 2행, 저장 닉네임 NFC(U+D61C U+C2B9) 확인, 10분 지난 draft 404(삭제 없음)·cancelled 409, 확인용 데이터 삭제. 상세는 `context/current-feature.md` 완료 이력.
