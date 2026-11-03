# 현재 기능: 웹 초대 링크 발급 API (MEMBER-API-09)

## 상태

완료

## 스펙

`context/features/001-link-issue-api.md`

## 목표

웹 「새 약속 만들기」에서 `POST /api/v1/links`로 초대 링크만 발급하고 발급자를 `/p/{inviteToken}` 방장 등록 화면으로 보낼 수 있게 한다.

## 수용 기준

- [x] AC-1 201 `{ inviteToken, inviteUrl, nextAction }`, `source='web'` 저장, `promiseId` 없음
- [x] AC-2 약속·참여자 미생성
- [x] AC-3 요청 본문 무시
- [x] AC-4 `inviteUrl` 조립 (끝 슬래시)
- [x] AC-5 P2002 1회 재시도, 이후 500 `INTERNAL_ERROR`, 원시 오류 미노출
- [x] AC-6 Origin 없음·불일치 → 403 `INVALID_ORIGIN`, 삽입 없음
- [x] AC-7 128비트 암호학적 난수 토큰

## 작업 기준점

- 브랜치: `ahn/feat-링크발급-api` (`main` 9b27cc3에서 생성)
- 시작 시 작업 트리: 깨끗함

## 검증 결과

2026-11-03, Node.js v24.20.0

| 명령 | 결과 |
| --- | --- |
| `npm run test` | 통과 — 2 파일, 15 테스트 |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 — `/api/v1/links` 동적(ƒ) |
| `npx prettier --check` (새 파일) | 새 파일 통과. 기존 `lib/prisma.ts`, `app/layout.tsx`, `docs/specs/API_CONVENTIONS.md` 경고는 이 기능 이전부터 있던 재포맷 백로그 |
| dev 서버 + curl (본인 개발 DB) | 정상 Origin 201 / 본문 `source:kakao` 201·DB `web` / Origin 없음 403 / 다른 Origin 403 |
| 개발 DB 확인 스크립트 | 발급 행 `source=web`, `promise=null`, `promises`·`participants` 0행, 같은 토큰 재삽입 → P2002 |

DB 스키마 변경 없음 → `db:status` 해당 없음. UI 변경 없음 → 브라우저 확인 해당 없음.

## 메모

- curl로 만든 테스트 링크 2개(`54w5dfgPh2TuiG703WRQuA`, `f-gvluRynSK3zWN7hc_Jtg`)가 개발 DB에 남아 있다. 이후 MEMBER-API-01·02 확인용으로 재사용 가능.
- 확인 스크립트 실행 시 `pg`가 `sslmode=require`를 `verify-full`로 취급한다는 경고를 냈다. 연결 문자열 형식 문제이며 이 기능 범위 밖.

## 완료 이력

이후 기록은 오래된 것부터 최신 순서로 맨 아래에 추가한다. 기존 기록을 삭제하지 않는다.

### 2026-11-04 — 웹 초대 링크 발급 API (MEMBER-API-09)

- 스펙: `context/features/001-link-issue-api.md`
- 브랜치: `ahn/feat-링크발급-api`
- 변경: `POST /api/v1/links` Route Handler, 내부 발급 함수 `lib/member/invite-link.ts`(source 인자, 웹은 `'web'` 고정, P2002 1회 재시도), 공통 헬퍼 `lib/api-error.ts`·`lib/origin.ts`, 공통 에러 코드 403 `INVALID_ORIGIN` 신설(API_CONVENTIONS·member.md), DECISION_CONFLICTS A-09 기록
- 검증: Vitest 15건 통과(2026-11-04 재실행), lint·typecheck·build 통과, 본인 개발 DB dev 서버 curl 201·403 확인, 실제 중복 삽입 P2002 확인
- 남은 제한: MEMBER-API-02·03·04·07의 Origin 실패 코드 통일(A-09), 미리보기 배포 Origin 허용 미정, IP 레이트 리밋 [제안] 미구현
