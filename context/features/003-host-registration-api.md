# 방장 등록 API (MEMBER-API-02)

## 식별자와 상태

- 스펙 ID: `003-host-registration-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-02-01(먼저 등록 완료한 사람이 방장), MEMBER-04-01, MEMBER-05-01·05-03·05-04(닉네임), MEMBER-06-01(PIN), MEMBER-06-03(세션), MEMBER-01-02(링크 만료), STATE-02-01, STATE-02-02(만료 draft 삭제)
- ERD: DATABASE.md 8.1(생성 원자성), 10절(draft 물리 삭제 예외), 11절 체크리스트
- API: MEMBER-API-02 (`docs/specs/api/member.md`), API_CONVENTIONS 3절·4.1·4.2·5절·7절
- 관련 미결·충돌: A-09(Origin 코드 통일 — 이번에 02 반영), R-10(이번 결정 기록)

## 사용자와 문제

링크를 연 사람이 닉네임·PIN을 입력해 방장이 되고, 약속 초안(draft)과 세션을 함께 받아야 한다. 같은 링크에 여러 사람이 동시에 등록해도 방장은 한 명이어야 한다.

## 목표와 범위

- 이번에 구현할 동작: `POST /api/v1/links/[inviteToken]/host`, 닉네임 검증, PIN 해시·검증 모듈, 세션 토큰·쿠키 모듈, 서울 시각 표기, 문서 갱신
- 이번에 구현하지 않을 동작: `/p/[inviteToken]` 화면, MEMBER-API-04(로그인 — `verifyPin`만 준비), 레이트 리밋([제안]), 03·04·07의 `INVALID_ORIGIN`

## 선행 작업

002-link-lookup-api (`resolveLinkStatus` 재사용), 001-link-issue-api (`isAllowedOrigin`, 에러 헬퍼). 병합 확인: main 228a678.

## 사용자 흐름

방장 등록 화면에서 닉네임·PIN 입력 → `POST …/host` → Origin 검증 → 본문 검증 → PIN 해시(잠금 전) → 트랜잭션: 링크 잠금 → 약속 잠금 → `clock_timestamp()` → `resolveLinkStatus` 판정 → (만료 draft 삭제) → 약속·방장·세션 생성 → 201 + 세션 쿠키. 409면 클라이언트는 MEMBER-API-04 재인증 분기(명세 6장).

## 수용 기준

- [ ] AC-1 (API_CONVENTIONS 7절, A-09): Origin 없음·불일치 → 403 `INVALID_ORIGIN`, DB 변경 없음
- [ ] AC-2 (API_CONVENTIONS 3절): JSON 파싱 실패·필드 누락·문자열 아님 → 400 `INVALID_REQUEST`
- [ ] AC-3 (MEMBER-05-01·05-03·05-04): 닉네임 trim → NFC 후 grapheme 2~12자, 이모지 거절, 중간 공백·대소문자 보존, `nickname`·`normalized_nickname` = trim·NFC 값. 위반 → 422 `VALIDATION_FAILED`
- [ ] AC-4 (MEMBER-06-01): PIN `^[0-9]{4}$`, 위반 → 422
- [ ] AC-5 (API_CONVENTIONS 4.1·4.2): 링크 → 약속 순서 `FOR UPDATE`, 잠금 후 `clock_timestamp()` 판정, `resolveLinkStatus` 재사용(API-01과 결과 동일)
- [ ] AC-6 (MEMBER-01-02): 링크 만료 → 410 `LINK_EXPIRED`, 없는 토큰 → 404
- [ ] AC-7 (STATE-02-02): 10분 지난 draft → 세션 → 방장 → promise 물리 삭제 후 등록 진행
- [ ] AC-8 (MEMBER-02-01): 진행 중 draft·그 외 상태 → 409 `HOST_ALREADY_REGISTERED`. `promise_link_id` P2002도 409. 동시 2건이면 하나만 201
- [ ] AC-9 (ERD 8.1): draft 약속(설정 NULL) + host/active 참여자 + 세션을 한 트랜잭션으로 생성, 실패 시 전체 롤백
- [ ] AC-10 (MEMBER-06-01): PIN은 scrypt 해시만 저장, `verifyPin` 왕복, salt마다 다른 해시
- [ ] AC-11 (API_CONVENTIONS 5절): 세션 토큰 32바이트, DB엔 SHA-256 hex만, 만료 DB 시각 + 24시간, 쿠키 속성 명세대로
- [ ] AC-12 (MEMBER-API-02): 201 본문 6개 필드, `draftExpiresAt` = created_at + 10분 `+09:00`
- [ ] AC-13: PIN·세션 토큰 원문이 로그·오류 응답에 없음

## 데이터와 인터페이스

스키마 변경 없음. 쓰기: `promises`, `participants`, `participant_sessions` 생성, 만료 draft의 세 테이블 행 삭제. 계약은 MEMBER-API-02 참조(400·403 행 추가).

## 구현 계획

1. `lib/member/nickname.ts`, `lib/member/pin.ts`, `lib/member/session.ts`, `lib/time/seoul.ts`
2. `lib/member/host-registration.ts`: `registerHost(inviteToken, input, options)` 트랜잭션
3. `lib/api-error.ts`: 400·422·409 헬퍼
4. `app/api/v1/links/[inviteToken]/host/route.ts`
5. 문서: member.md, API_CONVENTIONS 5.2, DECISION_CONFLICTS(R-10, A-09 진행)

## 검증 계획

- Vitest: nickname·pin·session·seoul 단위, host-registration(가짜 tx로 잠금·판정·삭제 순서·P2002·실패 전파), route(상태 코드·쿠키·로그)
- lint / typecheck / test / build
- dev 서버 + 개발 DB: 병렬 등록 2건, 만료 draft 재등록, 410·404·403, 실제 DB 롤백(세션 해시 UNIQUE 위반 주입), 확인 후 데이터 삭제
- DATABASE.md 11절: "두 사용자가 같은 링크를 동시에 선점", "만료 draft에 새 방장의 쓰기 요청"

## 미정 사항

- 결정(R-10, 2026-11-04 수정): scrypt **N=2^15**·r=8·p=1, maxmem 64MiB 명시. 처음에는 OWASP Password Storage Cheat Sheet의 scrypt 최소값 N=2^17(128MiB, 기준 PC 223ms)로 구현했으나 **의도적으로 낮췄다.** 근거: PIN은 1만 조합이라 해시 강도로는 유출 시 대입을 막지 못하고, 요청당 128MiB는 동시 요청 시 배포 인스턴스 메모리 부족과 MEMBER-API-04 로그인 반복을 통한 서비스 거부 위험이 된다. 실제 방어는 시도 제한(MEMBER-06-04 ❗미결)이 맡는다. N=2^15는 요청당 32MiB, 기준 PC 약 54~64ms. Node 기본 maxmem(32MiB)은 128·N·r과 같아 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`로 거절되므로 64MiB를 지정한다. 저장 형식에 매개변수가 있어 나중에 바꿔도 기존 해시를 검증할 수 있다.
- 해석: 약속 `created_at`은 DB 기본값(`now()` = 트랜잭션 시작) 대신 잠금 후 판정 시각으로 넣는다.
- 해석: 만료 draft 삭제는 그 약속의 모든 세션·참여자를 지운다. draft에는 방장 외 참여자가 생길 수 없다(MEMBER-03-02). 가능 시간 슬롯이 남아 있으면 FK RESTRICT로 실패·롤백(500)한다 — draft에서는 슬롯을 입력할 수 없어 발생하지 않는다.
- 해석: `draftExpiresAt`은 초 단위로 표기하고 밀리초는 버린다(명세 예시 형식). 실제 만료보다 최대 1초 이르게 보인다.
- 해결(R-10, 2026-11-04): 닉네임 처리 순서를 trim → NFC → 길이·이모지 검증으로 정했다. `nickname`·`normalized_nickname` 모두 NFC 값으로 저장하고, 조합형 "ᄀ+ᅡ"는 완성형 "가"로 저장·한 글자로 센다. NFKC는 쓰지 않는다. 근거: 03 중복 판정·04 로그인이 닉네임 일치에 의존하므로 입력 기기에 따른 조합형 차이가 로그인 실패·중복 판정 오류로 이어진다. `normalizeNickname`을 내보내 03·04가 재사용한다.
- 미결: `©`·`®`·`™`도 `Extended_Pictographic`이라 거절된다.
- 미결: 잘못된 UTF-8 본문은 `request.json()`이 U+FFFD로 바꿔 통과시킨다(확인 중 Windows 셸 인코딩으로 재현). 거절 여부는 MEMBER-05-02(허용 문자 ❗미결)와 함께 정한다.
- [제안] 레이트 리밋 미구현.

## 결과

2026-11-04 구현·검증, 판단 1~3·scrypt N=2^15·NFC 정규화 승인 후 완료

| 수용 기준 | 결과 | 근거 |
| --- | --- | --- |
| AC-1 | 충족 | `route.test.ts` Origin 없음·다른 도메인 403, 등록 시도 없음 / curl 403 |
| AC-2 | 충족 | `route.test.ts` JSON 파싱 실패·누락·숫자 타입·null 본문 400 |
| AC-3 | 충족 | `nickname.test.ts` 경계·trim·조합형 NFC·NFKC 미적용·이모지 / curl 조합형 "가나" → 응답 완성형(U+AC00 U+B098) |
| AC-4 | 충족 | `pin.test.ts` 형식, `route.test.ts` 422 `details.field` |
| AC-5 | 충족 | `host-registration.test.ts` SQL 순서(링크·약속 `FOR UPDATE` → `clock_timestamp()`), `resolveLinkStatus` 재사용 |
| AC-6 | 충족 | 단위 테스트 / curl 8일 지난 링크 410, 없는 토큰 404 |
| AC-7 | 충족 | 삭제 순서 단위 테스트 / 개발 DB에서 20분 지난 draft 재등록 → 이전 약속·방장·세션 삭제 |
| AC-8 | 충족 | 단위 테스트(진행 중 draft·4개 상태·P2002) / 개발 DB 병렬 2건 → 201 1건·409 1건 |
| AC-9 | 충족 | 개발 DB에 세션 해시 UNIQUE 위반 주입 → 약속·참여자 0건 |
| AC-10 | 충족 | `pin.test.ts` 왕복·salt / 개발 DB 저장값 `scrypt$32768$8$1$…`, `verifyPin` 확인 |
| AC-11 | 충족 | `session.test.ts` / curl 쿠키 속성, DB 해시 64자·24시간 |
| AC-12 | 충족 | `route.test.ts` 본문 6개 필드·`+09:00` / curl 201 본문 |
| AC-13 | 충족 | `route.test.ts` 500 응답·로그에 PIN·원문 없음 / dev 서버 로그 확인 |

최종 `npm run test` 112건, lint·typecheck·build 통과.
