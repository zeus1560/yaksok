# PIN 시도 제한과 레이트 리밋

## 식별자와 상태

- 스펙 ID: `035-login-rate-limit`
- 상태: 검토 중 — 구현·로컬 검증 완료, 보고 확인 뒤 기능 커밋. 미리보기 DB 마이그레이션(`npm run db:deploy:preview`)은 사용자가 확인 뒤 적용
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-06-04 PIN 입력 실패(❗미결 — 사용자 지시로 제안값을 **잠정** 결정), MEMBER-06-01(4자리 PIN), MEMBER-04-02(여러 기기 로그인)
- ERD: DATABASE.md 9절(약속·참여자 기준 및 IP 기준 시도 제한), 「보안 보조 테이블」(이번 추가)
- API: MEMBER-API-04 보안 정보(제안값 참여자 5회/15분·IP 1분 10회), MEMBER-API-02·03·09 「IP 기준 레이트 리밋 [제안]」, API_CONVENTIONS 3절·7절
- 관련 미결·충돌: R-11(「시도 제한 구현하지 않음」 → 이번에 대체), **R-41 신설(잠정, 팀 확정 필요)**

## 사용자와 문제

4자리 PIN(1만 조합)이라 링크를 받은 사람이 방장 닉네임으로 계속 시도하면 로그인할 수 있다(MEMBER-API-04 보안 정보). 인증 없이 부르는 쓰기 API(링크 발급·방장 등록·참여자 등록·로그인)에 요청 수 제한도 없다. 공개 배포 전 필수 항목.

## 목표와 범위

- 이번에 구현할 동작:
  - 로그인 PIN 시도 제한: 같은 참여자 + 같은 IP 1시간 안 5번 연속 실패 → 15분, 참여자 전체 1시간 20번 초과 → 15분, 참여자 전체 24시간 50번 → 24시간(하루 상한, 2026-11-17 추가). 잠긴 동안 PIN이 맞아도 429 `TOO_MANY_ATTEMPTS`, `Retry-After`·`details.retryAfterSeconds`. 성공하면 그 IP의 연속 실패 초기화
  - IP 기준 레이트 리밋: 링크 발급 1분 10회, 방장 등록·참여자 등록·로그인 각 1분 30회 → 429 `RATE_LIMITED`·`Retry-After` (처음 5회·10회에서 2026-11-17 완화 — 같은 공인 IP를 쓰는 여러 사람, R-41)
  - 미리보기 `@smoke`: 429 `RATE_LIMITED`면 Retry-After만큼 기다렸다 다시 보냄(실행 전체 대기 상한 3분, 대기 횟수·시간 출력)
  - 화면 안내: 로그인 잠금 「PIN을 여러 번 틀려 잠시 막혔어요. N분 뒤에 다시 시도해 주세요.」(남은 시도 횟수 없음), 429 `RATE_LIMITED` 「요청이 너무 많아요. 잠시 후 다시 시도해 주세요.」
  - 저장: DB 보조 테이블 2개(추가형, FK 없음), 오래된 행은 요청 때 정리
- 이번에 구현하지 않을 동작: 세션 API·GET(폴링)의 레이트 리밋(member.md·time.md [제안] 그대로), 미리보기 전용 기준, PIN 분실 복구(MEMBER-06-02), 외부 저장소(Redis 등)

## 선행 작업

없음(034 완료 기록이 첫 커밋). 미결 MEMBER-06-04는 사용자가 제안값을 잠정 결정으로 쓰라고 지시(R-41).

## 사용자 흐름

- 로그인: 닉네임·PIN 입력 → (IP 1분 30회 초과면 「요청이 너무 많아요」) → 약속 상태 판정 → 잠겼으면 「PIN을 여러 번 틀려 잠시 막혔어요. N분(1시간 넘으면 N시간) 뒤에…」(로그인 화면 그대로) → 아니면 PIN 비교(틀리면 「닉네임 또는 PIN이 맞지 않아요.」)
- 새 약속 만들기·방장 등록·참여자 등록: 1분 기준 초과면 버튼·폼 아래 「요청이 너무 많아요. 잠시 후 다시 시도해 주세요.」
- 등록 409 `NICKNAME_TAKEN` 뒤의 자동 로그인 1회가 429면 같은 잠금·요청 수 안내

## 수용 기준

- [x] AC-1 (MEMBER-06-04 잠정): 같은 참여자·같은 IP로 5번 연속 실패하면 PIN이 맞아도 15분 동안 429 `TOO_MANY_ATTEMPTS`, `Retry-After`와 `details.retryAfterSeconds`. 15분 뒤 해제
- [x] AC-2: 다른 IP는 ①에 영향 없음. 성공하면 그 IP의 실패 횟수 초기화
- [x] AC-3: IP와 관계없이 한 참여자 실패가 1시간에 20번을 넘으면 15분 잠금(모든 IP). 24시간에 50번이면 24시간 잠금(하루 상한). 잠겨도 이미 받은 세션은 그대로
- [x] AC-4: 잠긴 동안의 요청은 PIN을 비교하지 않고 실패로 세지 않는다. 없는 닉네임도 같은 잠금(존재 비노출). 남은 시도 횟수를 응답·화면에 내지 않는다
- [x] AC-5: 링크 발급 1분 10회, 방장 등록·참여자 등록·로그인 각 1분 30회 초과 → 429 `RATE_LIMITED`·`Retry-After`, no-store, 다른 IP는 영향 없음
- [x] AC-6: 화면 안내 두 가지(로그인 잠금 N분, 요청 수 초과). 분기는 에러 코드
- [x] AC-7: 순수 함수 — 잠금 판단 `resolveLoginLock`, 요청 수 판단 `resolveRateLimit`, IP 구하기 `clientIpKey`·`normalizeIp`, 화면 문구 `loginLockedMessage`
- [x] AC-8: 스키마는 추가형(새 테이블 2개·인덱스만). 예전 배포 코드가 새 스키마에서 그대로 동작
- [x] AC-9: 명세(member.md·API_CONVENTIONS·GUARD_MATRIX·DATABASE.md)와 DECISION_CONFLICTS R-41(잠정), MOBILE_CHECKLIST 12절

## 데이터와 인터페이스

- 마이그레이션 `20261117050841_login_rate_limit`: `login_failures(id, promise_id, normalized_nickname, ip_key, failed_at)`, `rate_limit_hits(id, bucket, ip_key, hit_at)` + 인덱스 4개. ALTER·DROP 없음, FK 없음(DATABASE.md 「보안 보조 테이블」)
- 에러: 429 `RATE_LIMITED`, 429 `TOO_MANY_ATTEMPTS` — `{ code, message, details: { retryAfterSeconds } }` + `Retry-After` 헤더
- 가드 순서: Origin 403 → 본문 400·422 → 429 `RATE_LIMITED` → (로그인) promiseId 400·404·상태 409·410 → 429 `TOO_MANY_ATTEMPTS` → PIN 401 → 참여자 403 → 200

## 구현 계획

1. 스키마·마이그레이션(개발 DB·e2e DB 적용)
2. 순수 함수 `lib/limit/login-lock.ts`·`rate-limit.ts`·`client-ip.ts`·`notice.ts`
3. 로그인 서비스 `lib/member/login.ts` `checkPin`(advisory lock 트랜잭션: 판정 → PIN → 실패 기록·성공 초기화), 레이트 리밋 저장 `lib/limit/rate-limit-store.ts`
4. Route 4개, `lib/api-error.ts` 429 헬퍼
5. 화면: `lib/participate/failure.ts`, `create-promise-button.tsx`, `register-host-card.tsx`
6. e2e 도우미(요청별 시험용 IP, 보조 테이블 스냅샷 제외·정리), 새 통합 테스트

## 검증 계획

- 단위: `lib/limit/*.test.ts`, `lib/member/login.test.ts`, 라우트 4개 테스트, `lib/participate/failure.test.ts`
- 개발 DB 실제 호출: `scripts/verify/035-login-rate-limit.mjs`(Git 제외)
- 예전 배포 호환: `origin/main` worktree의 통합 테스트를 새 스키마 e2e DB에 대고 실행
- 통합: 기존 세 프로젝트 전체 1회 + `tests/e2e/api/rate-limit.spec.ts`·`tests/e2e/login-limit.spec.ts`
- 실기기: MOBILE_CHECKLIST 12절

## 미정 사항

- **R-41 전체가 잠정 — 팀 확정 필요:** 기준값(하루 상한 포함), 「참여자」 = (약속, 정규화 닉네임), 밀어 가는 1시간 창(풀린 뒤 창 안에서 또 틀리면 바로 15분), 성공은 그 IP만 초기화, 레이트 리밋 위치(입력 검사 뒤), 거절된 요청 미집계, 세션 API·GET 미적용
- 하루 상한의 대가: 공격자가 IP 3개 이상으로 50번 틀리면 그 참여자(방장 포함)의 새 로그인을 24시간 막을 수 있음(이미 받은 세션은 계속 씀) — R-41, 팀 확정 필요
- 미리보기 `@smoke`의 429 대기는 함수만 흉내 내 확인(미리보기 배포에서 실제 실행은 미리보기 DB 마이그레이션 뒤)
- Vercel이 x-forwarded-for를 덮어쓰는 동작은 Vercel 문서 기준. 미리보기 배포에서 직접 확인은 미리보기 DB 마이그레이션 뒤

## 결과

검증 근거는 `context/current-feature.md` 참고.
