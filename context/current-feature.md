# 현재 기능: 방장 등록 API (MEMBER-API-02)

## 상태

완료

## 스펙

`context/features/003-host-registration-api.md`

## 목표

링크를 연 사람이 닉네임·PIN으로 방장이 되어 draft 약속과 세션을 받는다. 동시에 등록해도 방장은 한 명이고, 만료 draft는 잠금 후 정리하고 다시 등록할 수 있다.

## 수용 기준

- [x] AC-1 Origin 없음·불일치 → 403 `INVALID_ORIGIN`
- [x] AC-2 JSON·필드 오류 → 400 `INVALID_REQUEST`
- [x] AC-3 닉네임 trim → NFC, grapheme 2~12자·이모지 거절 → 422
- [x] AC-4 PIN 형식 → 422
- [x] AC-5 링크 → 약속 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, `resolveLinkStatus` 재사용
- [x] AC-6 410 / 404
- [x] AC-7 만료 draft 세션 → 방장 → promise 삭제 후 등록
- [x] AC-8 409 (진행 중 draft·그 외·P2002), 병렬 2건 중 1건만 201
- [x] AC-9 한 트랜잭션 생성, 실패 시 전체 롤백
- [x] AC-10 scrypt 해시·검증
- [x] AC-11 세션 토큰·해시·24시간·쿠키 속성
- [x] AC-12 201 본문 6개 필드, `draftExpiresAt` +09:00
- [x] AC-13 PIN·세션 토큰 원문 미노출

## 작업 기준점

- 브랜치: `ahn/feat-방장등록-api` (`main` 228a678에서 생성, MEMBER-API-01 병합 포함)
- 시작 시 작업 트리: 깨끗함

## 검증 결과

2026-11-04, Node.js v24.20.0

| 명령 | 결과 |
| --- | --- |
| `npm run test` | 통과 — 11 파일, 112 테스트 (이번 기능 62건 추가, NFC 3건 포함) |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 (테스트의 정규식 `s` 플래그가 ES2017 target에서 실패 → 수정 후 재실행) |
| `npm run build` | 통과 — `/api/v1/links/[inviteToken]/host` 동적(ƒ) |
| `npx prettier --check` (변경 파일) | 통과 |
| dev 서버 + 개발 DB: 병렬 등록 2건 | 1건 201(쿠키 속성 명세대로), 1건 409. 이후 MEMBER-API-01 조회 → draft `wait_setup` |
| 저장값 확인 | `nickname`·`normalized_nickname` = trim 값, `password_hash` = `scrypt$131072$8$1$…` (N=2^17 시점), 세션 해시 64자, 만료 = 생성 + 24시간 |
| 만료 draft 재등록 | 20분 이전으로 옮긴 draft → API-01 `draftExpired:true` → 등록 201, 이전 약속·방장·세션 삭제 |
| 410 / 404 / 403 | 발급 8일 지난 링크 410, 없는 토큰 404, Origin 없음 403 |
| 실제 DB 롤백 | 세션 해시 UNIQUE 위반 주입 → P2002, 링크에 약속 없음, 참여자 0건 |
| 정리 | 확인용 링크 4개·약속 2개 삭제, 4개 테이블 스냅샷이 시작 상태와 동일 |
| scrypt N=2^15 변경 후 재검증 | `npm run test` 109건, lint·typecheck·build 통과. 기본 maxmem(32MiB)은 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`, 64MiB 지정 시 통과(평균 약 54ms). 개발 DB에 `registerHost`로 실제 저장 → `scrypt$32768$8$1$<salt 22자>$<hash 43자>` 형식 일치, `verifyPin` 맞는 PIN true·다른 PIN false. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일 |
| NFC 정규화 추가 후 재검증 | `npm run test` 112건, lint·typecheck·build 통과. dev 서버에 조합형 " 가나 "(UTF-8 파일) 등록 → 201, 응답 닉네임 완성형 `가나`(U+AC00 U+B098). DB 직접 조회 스크립트는 출력 없이 끝나 미확인 — 응답 값은 DB에 저장한 값과 같은 변수. 확인용 데이터 삭제, 스냅샷 시작 상태와 동일 |

DB 스키마 변경 없음 → `db:status` 해당 없음. UI 변경 없음 → 브라우저 확인 해당 없음.

## 메모

- 확인 중 Git Bash에서 curl `-d`로 한글을 보내면 CP949 바이트가 전달되어 닉네임이 U+FFFD로 저장됐다. UTF-8 파일(`--data-binary @file`)로 보내면 정상이다. 서버 문제는 아니지만 잘못된 UTF-8 거절 여부는 미결로 스펙에 남겼다.
- 스펙과 다르게 판단한 부분·미결은 스펙의 미정 사항에 정리했다.

## 완료 이력

이후 기록은 오래된 것부터 최신 순서로 맨 아래에 추가한다. 기존 기록을 삭제하지 않는다.

### 2026-11-04 — 웹 초대 링크 발급 API (MEMBER-API-09)

- 스펙: `context/features/001-link-issue-api.md`
- 브랜치: `ahn/feat-링크발급-api`
- 변경: `POST /api/v1/links` Route Handler, 내부 발급 함수 `lib/member/invite-link.ts`(source 인자, 웹은 `'web'` 고정, P2002 1회 재시도), 공통 헬퍼 `lib/api-error.ts`·`lib/origin.ts`, 공통 에러 코드 403 `INVALID_ORIGIN` 신설(API_CONVENTIONS·member.md), DECISION_CONFLICTS A-09 기록
- 검증: Vitest 15건 통과(2026-11-04 재실행), lint·typecheck·build 통과, 본인 개발 DB dev 서버 curl 201·403 확인, 실제 중복 삽입 P2002 확인
- 남은 제한: MEMBER-API-02·03·04·07의 Origin 실패 코드 통일(A-09), 미리보기 배포 Origin 허용 미정, IP 레이트 리밋 [제안] 미구현

### 2026-11-04 — 초대 링크 조회 API (MEMBER-API-01)

- 스펙: `context/features/002-link-lookup-api.md`
- 브랜치: `ahn/feat-링크조회-api`
- 변경: `GET /api/v1/links/[inviteToken]` Route Handler, 순수 판정 함수 `lib/member/link-status.ts`(기준 시각 3종 + 7일, draft 10분 만료 계산), 조회 서비스 `lib/member/link-lookup.ts`(형식 검사, DB 시각 `clock_timestamp()`), `isInviteTokenFormat`, `LINK_NOT_FOUND`·`LINK_EXPIRED` 헬퍼, 전 응답 `Cache-Control: no-store`, member.md 404 조건·no-store 명시
- 검증: Vitest 50건 통과, lint·typecheck·build 통과, 개발 DB 확인용 데이터로 curl 7건(200 3종·410·404 3종) 확인, GET 전후 4개 테이블 행 수·md5 동일, 확인용 데이터 삭제
- 남은 제한: IP 레이트 리밋 [제안] 미구현, 만료 draft 실제 삭제는 MEMBER-API-02 담당

### 2026-11-04 — 방장 등록 API (MEMBER-API-02)

- 스펙: `context/features/003-host-registration-api.md`
- 브랜치: `ahn/feat-방장등록-api`
- 변경: `POST /api/v1/links/[inviteToken]/host`, `registerHost` 트랜잭션(링크 → 약속 `FOR UPDATE`, 잠금 후 `clock_timestamp()`, `resolveLinkStatus` 재사용, 만료 draft 세션 → 방장 → promise 삭제, P2002 → 409), 닉네임 trim → NFC → grapheme 2~12자·이모지 거절(`normalizeNickname` 공개), PIN scrypt N=2^15·r=8·p=1·maxmem 64MiB(`verifyPin` 공개), 세션 32바이트·SHA-256·24시간·쿠키, `+09:00` 시각 표기, 400·409·422 헬퍼. 문서: member.md(400·403 행, 닉네임 규칙, scrypt), API_CONVENTIONS 5.2 확정, DECISION_CONFLICTS R-10 신설·A-09 진행
- 검증: Vitest 112건, lint·typecheck·build 통과. 개발 DB에서 병렬 등록 2건 중 1건만 201, 만료 draft 재등록, 410·404·403, 실제 롤백, 저장값 `scrypt$32768$8$1$…`, 조합형 닉네임 완성형 응답 확인. 확인용 데이터 삭제
- 남은 제한: PIN 시도 제한(MEMBER-06-04 ❗미결), 잘못된 UTF-8 본문 거절 여부·`©`·`®`·`™` 거절(MEMBER-05-02 ❗미결), 레이트 리밋 [제안], A-09의 03·04·07
