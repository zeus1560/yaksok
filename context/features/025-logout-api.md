# 로그아웃 API (MEMBER-API-07)

## 식별자와 상태

- 스펙 ID: `025-logout-api`
- 상태: 검토 중

## 근거

- 비즈니스 규칙: MEMBER-04-02(기기별 세션·다시 로그인), MEMBER-06-03(세션 쿠키)
- ERD: DATABASE.md 3.5(명시적 로그아웃은 세션 행 삭제, 탈퇴·내보내기·취소는 `expires_at` 변경), 8절
- API: MEMBER-API-07 (`docs/specs/api/member.md`), API_CONVENTIONS 5절·5.2
- 관련 미결·충돌: R-11(cancelled 409 세션보다 우선 — 이번 API는 예외), A-09(Origin 403 `INVALID_ORIGIN`), R-30 끝 문단(07 보안 정보 "세션 전부 삭제" 문구), C-07. 이번 결정은 R-31

## 사용자와 문제

공용 PC나 친구 휴대폰에서 로그인한 뒤 그 기기의 로그인만 끊을 방법이 없다. 쿠키만 지우면 서버 세션이 남아 탈취된 토큰이 계속 유효하다. 기기를 잃어버렸으면 다른 기기 세션까지 한 번에 끊어야 한다.

## 목표와 범위

- 이번에 구현할 동작: `DELETE /api/v1/promises/{promiseId}/auth/session[?allDevices=true|false]` — 쿠키 세션 행 삭제(allDevices=true면 같은 참여자의 모든 세션 행 삭제), 204·쿠키 Max-Age=0
- 이번에 하지 않을 일: 화면(로그아웃 버튼·로컬 입력 삭제), DB 스키마 변경, 탈퇴·내보내기·취소의 세션 처리 변경(행 유지·`expires_at` 변경 그대로)

## 선행 작업

004(재인증 API — 같은 경로의 POST, 로그아웃 뒤 다시 로그인), 005(`session-auth.ts`의 쿠키 읽기·해시), 022·024(탈퇴·내보내기 뒤 남은 만료 세션)

## 사용자 흐름

1. 브라우저가 세션 쿠키·Origin과 함께 DELETE를 보낸다(본문 없음)
2. 서버가 쿠키 해시로 세션 행을 찾아 이 약속의 세션이면 지운다
3. 204와 Max-Age=0 쿠키 → 브라우저 쿠키 제거. 다시 들어오면 닉네임·PIN으로 로그인(MEMBER-API-04)
4. 같은 요청을 다시 보내면(응답 유실) 행이 없으므로 204

## 수용 기준

- [x] AC-1 (MEMBER-04-02, ERD 3.5): allDevices 없음·false → 쿠키의 세션 행만 삭제, 204 본문 없음, 쿠키 Max-Age=0. 참여자 행(status·role·닉네임·PIN 해시)·슬롯·제출 시각·버전과 다른 기기 세션 행은 그대로
- [x] AC-2 (ERD 3.5 전체 로그아웃): allDevices=true → 같은 참여자의 세션 행 모두 삭제(다른 참여자 세션 그대로). 이후 다른 기기 쿠키는 401
- [x] AC-3 (멱등): 행이 없거나 만료된 세션, 탈퇴·내보내진 참여자의 남은 세션도 204·쿠키 제거. 같은 요청 반복 204
- [x] AC-4 (사용자 지시, R-31): 취소된 약속도 409가 아니라 204·쿠키 제거(R-11 예외)
- [x] AC-5 (사용자 지시): 쿠키 세션이 다른 약속 소속이면 403 `FORBIDDEN`, 그 세션 행은 삭제하지 않음
- [x] AC-6: 400 `INVALID_REQUEST`(promiseId 형식·allDevices가 `true`/`false` 한 개가 아님), 401 `UNAUTHENTICATED`(쿠키 없음), 403 `INVALID_ORIGIN`, 404 `PROMISE_NOT_FOUND`, 모든 응답 no-store
- [x] AC-7: 로그아웃 뒤 같은 닉네임·PIN으로 재로그인 200(새 세션)
- [x] AC-8: 세션 행이 사라진 경우를 다른 세션 API가 401·쿠키 Max-Age=0으로 처리하는지 코드로 확인

## 데이터와 인터페이스

- DB 변경 없음. `participant_sessions` 행 DELETE만
- 204: 본문 없음, `Set-Cookie: ys_session_{promiseId}=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/{promiseId}; Max-Age=0`
- 에러: 400 `INVALID_REQUEST`, 401 `UNAUTHENTICATED`, 403 `INVALID_ORIGIN`·`FORBIDDEN`, 404 `PROMISE_NOT_FOUND`

## 구현 계획

1. RED: 대표 테스트 2건(이 기기 세션만 삭제·나머지 보존, allDevices=true 같은 참여자 전부 삭제) + 빈 구현
2. GREEN: `lib/member/logout.ts` `logoutSession`·`parseAllDevices`
3. REFACTOR: 거절·순서·멱등·다른 약속·만료 세션 테스트, `auth/session/route.ts` DELETE와 테스트
4. 문서: member.md MEMBER-API-07(에러 표·보안 정보 문구·구현 결정), member.md 690행 문구, API_CONVENTIONS 5.2 로그아웃 행, DECISION_CONFLICTS R-31·A-09

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`, lint·typecheck·build
- 개발 DB 실제 호출(`scripts/verify/`, Git 제외): AC-1~7 전부, 확인용 데이터 삭제·스냅샷 비교

## 미정 사항

- 결정(사용자 지시): 행 삭제, 취소된 약속 204, 다른 약속 세션 403·삭제 안 함, 만료·탈퇴자 세션 204
- 이번 구현 판단(R-31): 아래 결과 참고

## 결과

AC-1~8 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고(Vitest 1509건, 개발 DB 139개 항목).

- 구현: `lib/member/logout.ts`(`logoutSession`·`parseAllDevices`), `app/api/v1/promises/[promiseId]/auth/session/route.ts`(DELETE 추가, POST 그대로)
- 테스트: `logout.test.ts` 31건, `auth/session/route.test.ts` DELETE 16건. POST 기존 테스트 수정 없음
- 이번 구현 판단(R-31): allDevices=true는 유효 세션일 때만 같은 참여자 전체 삭제, allDevices는 `true`·`false` 한 개만, 거절 응답은 쿠키 변경 없음, 401 메시지는 공통 헬퍼 문구
- AC-8: 공통 인증·잠금 후 재확인 12개 API·`/me`가 행 없음을 401·Max-Age=0으로 처리함을 코드로 확인. 설정 완료는 재확인이 없어 겹치면 지워진 토큰 쿠키를 다시 심을 수 있음(다음 요청 401, 고치지 않음)
