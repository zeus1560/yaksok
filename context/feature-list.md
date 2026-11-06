# 기능 스펙 목록

`context/features/`의 스펙과 진행 상태를 정리한다. 스펙을 작성한 것과 구현을 완료한 것을 구분한다.

| 순서 | 스펙 ID | 기능 | 스펙 | 선행 스펙·이유 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 1 | 001-link-issue-api | 웹 초대 링크 발급 (MEMBER-API-09) | `context/features/001-link-issue-api.md` | 없음 | 완료 |
| 2 | 002-link-lookup-api | 초대 링크 조회 (MEMBER-API-01) | `context/features/002-link-lookup-api.md` | 001 — 에러 헬퍼·토큰 형식 재사용 | 완료 |
| 3 | 003-host-registration-api | 방장 등록 (MEMBER-API-02) | `context/features/003-host-registration-api.md` | 002 — `resolveLinkStatus` 재사용, 001 — Origin·에러 헬퍼 | 완료 |
| 4 | 004-participant-login-api | 참여자 재인증 (MEMBER-API-04) | `context/features/004-participant-login-api.md` | 003 — `verifyPin`·`normalizeNickname`·세션 모듈, 002 — `linkExpiryBase` | 완료 |
| 5 | 005-start-collecting-api | 설정 완료와 모집 시작 (STATE-API-02) | `context/features/005-start-collecting-api.md` | 004 — `sessionMaxAgeSeconds`·에러 헬퍼, 003 — 잠금·만료 draft 삭제 순서 | 완료 |
| 6 | 006-participant-registration-api | 참여자 등록 (MEMBER-API-03) | `context/features/006-participant-registration-api.md` | 005 — `session-auth.ts`, 004 — `linkExpiryBase`·`sessionMaxAgeSeconds`, 003 — `normalizeNickname`·`hashPin` | 완료 |
| 7 | 007-availability-submit-api | 가능 시간 제출 (TIME-API-01) | `context/features/007-availability-submit-api.md` | 006 — `no-store`·`PROMISE_NOT_OPEN`, 005 — `session-auth.ts`·`withSessionCookie` | 완료 |
| 8 | 008-availability-status-api | 가능 시간 현황 조회 (TIME-API-02) | `context/features/008-availability-status-api.md` | 007 — 슬롯 표기·draft 판정 패턴, 005 — `session-auth.ts`·`minuteToTime` | 완료 |
| 9 | 009-create-promise-ui | 약속 만들기 화면 (홈 → 방장 등록·설정·완료) | `context/features/009-create-promise-ui.md` | 001·002·003·005 — 링크 발급·조회·방장 등록·설정 완료 API | 완료 |
| 10 | 010-me-api | 내 참여 정보 조회 (MEMBER-API-05)와 방장 복원 전환 — `/p/[inviteToken]`이 `/me`로 방장 설정 화면을 연다. 저장소는 카운트다운 기준값만 | `context/features/010-me-api.md` | 009 — 화면 분기·설정 화면, 005 — `session-auth.ts` | 완료 |
| 11 | 011-participate-ui | 참여 경로 화면 (참여자 등록·로그인·도착) — 닉네임 중복은 로그인 1회로 판별, draft 대기 화면 방장 로그인(009 이월 409 복구), 도착 화면은 `/me` 기준 | `context/features/011-participate-ui.md` | 010 — `/me` 기반 분기, 009 — 대기·설정 화면, 004·006 — 로그인·참여자 등록 API | 검토 중 |
