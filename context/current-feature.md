# 현재 기능: 초대 링크 조회 API (MEMBER-API-01)

## 상태

완료

## 스펙

`context/features/002-link-lookup-api.md`

## 목표

초대 링크를 연 사람이 약속 내용 없이 현재 단계와 다음 화면(`nextAction`)을 알 수 있게 `GET /api/v1/links/[inviteToken]`을 제공한다. GET은 계산만 하고 DB를 바꾸지 않는다.

## 수용 기준

- [x] AC-1 형식 오류·없는 토큰 → 404 `LINK_NOT_FOUND` (형식 오류는 DB 미조회)
- [x] AC-2 기준 시각 + 7일 ≤ 판정 시각 → 410 `LINK_EXPIRED` (기준 시각 3종, 재조율 새 마감)
- [x] AC-3 10분 지난 draft → 200 unclaimed / register_host / `draftExpired:true`
- [x] AC-4 상태별 `nextAction`·`pollAfterMs`, 응답 필드 6개
- [x] AC-5 잠금·쓰기·삭제 없음
- [x] AC-6 DB 시각 판정, 시각 주입 가능
- [x] AC-7 DB 오류 500, 원문 미노출

## 작업 기준점

- 브랜치: `ahn/feat-링크조회-api` (`main` 93a2036에서 생성, MEMBER-API-09 병합 포함)
- 시작 시 작업 트리: 깨끗함

## 검증 결과

2026-11-04, Node.js v24.20.0

| 명령 | 결과 |
| --- | --- |
| `npm run test` | 통과 — 5 파일, 50 테스트 (이번 기능 35건 추가, 마감 없는 cancelled 포함) |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 — `/api/v1/links/[inviteToken]` 동적(ƒ) |
| `npx prettier --check` (변경 파일) | 통과 |
| dev 서버 + curl (본인 개발 DB, 확인용 데이터) | unclaimed 200 / draft 200 `wait_setup`·`pollAfterMs:3000` / 20분 지난 draft 200 `draftExpired:true` / 8일 지난 링크 410 / 없는 토큰·형식 오류 2종 404 / 전 응답 `cache-control: no-store` |
| GET 전후 DB 비교 | `promise_links`·`promises`·`participants`·`participant_sessions` 행 수·md5 동일 |

DB 스키마 변경 없음 → `db:status` 해당 없음. UI 변경 없음 → 브라우저 확인 해당 없음.

## 메모

- 확인용 링크 3개와 draft 약속 2개는 확인 후 삭제했다. 개발 DB는 시작 시점(링크 2개, 약속 0개)으로 돌아갔다.
- 스펙과 다르게 판단한 부분·해석은 스펙의 미정 사항에 정리했다.

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
