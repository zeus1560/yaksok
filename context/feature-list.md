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
| 11 | 011-participate-ui | 참여 경로 화면 (참여자 등록·로그인·도착) — 닉네임 중복은 로그인 1회로 판별, draft 대기 화면 방장 로그인(009 이월 409 복구), 도착 화면은 `/me` 기준 | `context/features/011-participate-ui.md` | 010 — `/me` 기반 분기, 009 — 대기·설정 화면, 004·006 — 로그인·참여자 등록 API | 완료 |
| 12 | 012-availability-input-ui | 가능 시간 입력 화면 (내 시간 입력·모두의 시간·5초 폴링 동기화) — SWR 폴링, 로컬 임시 입력 버전 비교, 마우스 드래그·터치 탭·날짜 하루 토글 | `context/features/012-availability-input-ui.md` | 011 — 도착 화면·링크 재조회 흐름, 007·008 — TIME-API-01·02 | 완료 |
| 13 | 013-candidates-api | 공식 시간 후보 조회 (STATE-API-10) — 후보 계산 순수 함수 `lib/state/candidates.ts`(05 확정 재검증에서 재사용), 읽기 트랜잭션 하나·계산 시각 `now()`, limit·offset 페이지 | `context/features/013-candidates-api.md` | 008 — 읽기 트랜잭션·effectiveStatus 패턴, 005 — `session-auth.ts`, 007 — 슬롯 형식 | 완료 |
| 14 | 014-promise-detail-api | 약속 상태와 설정 조회 (STATE-API-01) — effectiveStatus·draftExpired 계산, settings 매핑, 확정 구간 공통 가능 인원(`countAvailableParticipants`, 후보 계산과 같은 집계 코드)·`hostActionRequired` | `context/features/014-promise-detail-api.md` | 013 — 집계 기준·읽기 트랜잭션 패턴, 005 — `session-auth.ts` | 완료 |
| 15 | 015-access-expiry-refactor | 세션·링크 만료 계산 통합 리팩터링 — `accessExpiresAt`(링크 410·로그인·참여자 등록 공통), 세션 일괄 갱신 `refreshActiveSessions`(02 사용, 03·05 재사용 예정), C-10·C-11 잠정 기록. 동작 변경 없음 | `context/features/015-access-expiry-refactor.md` | 002·004·005·006 — 만료 계산이 흩어진 곳 | 완료 |
