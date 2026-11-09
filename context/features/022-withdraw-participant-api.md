# 본인 탈퇴와 자동 승계 API (STATE-API-08)

## 식별자와 상태

- 스펙 ID: `022-withdraw-participant-api`
- 상태: 검토 중

## 근거

- 비즈니스 규칙: STATE-06-01~02(탈퇴·방장 승계), MEMBER-10-03(탈퇴 세션 즉시 만료), MEMBER-12-01·03·04(탈퇴자 보존·집계 제외), STATE-02-02(draft 폐기·링크 재사용)
- ERD: DATABASE.md 8절(잠금 순서), 10절(draft 물리 삭제 예외), 11절(세션)
- API: STATE-API-08, STATE-API-00 「탈퇴·취소·초안 폐기의 구분」·「잠금과 원자성」(`docs/specs/api/state.md`), API_CONVENTIONS 4.1-3·5.2
- 관련 미결·충돌: X-11(처리 순서 번호), C-07(cancelled 참여자 401 안), C-12(취소 뒤 `/me`), R-17, R-22, R-25. 이번 결정은 R-28

## 사용자와 문제

참여자는 약속에서 빠질 방법이 없었고, 방장은 나가면 약속을 이어 갈 사람이 없었다. 탈퇴자 처리(정원·닉네임·로그인·집계)는 그동안 DB 조작으로만 확인했다.

## 목표와 범위

- 이번에 구현할 동작: `DELETE /api/v1/promises/{promiseId}/participants/me` — draft 방장 폐기, 일반 참여자 탈퇴, 방장 자동 승계, 후임 없는 방장 → 약속 취소
- 공용화: draft 삭제(`lib/member/draft-discard.ts`, 방장 등록·설정 완료와 공유), 약속 취소 저장(`markPromiseCancelled`, 취소 API와 공유), 한 참여자 세션 만료(`expireParticipantSessions`)
- 이번에 하지 않을 일: 화면(탈퇴 버튼, 후임 방장 화면 갱신), DB 스키마 변경, 내보내기

## 선행 작업

019(`expireAllSessions`·취소 저장), 003·005(draft 삭제 순서), 016·017(잠금 후 재확인·마감 경과 closed 저장), 021(`closeIfDeadlinePassed`)

## 사용자 흐름

1. 참여자가 탈퇴를 요청한다(본문 없음, 세션 쿠키·Origin)
2. 서버가 링크 → 약속 순서로 잠그고 최신 상태·세션·역할을 확인한다
3. 분기 처리 후 요청자 쿠키를 지우고 200을 돌려준다. draft 폐기면 화면은 링크 첫 화면으로 돌아간다

## 수용 기준

- [x] AC-1 (STATE-API-08 처리 순서 2): 모든 분기에서 `promise_links` → `promises` 순서로 잠그고, 잠금 후 약속 없음 404(새 약속 대신 처리 안 함)·cancelled 409·세션·active 401·최신 role을 다시 확인한다
- [x] AC-2 (처리 순서 3, STATE-02-02): draft는 현재 active host만 세션 → 참여자 → promise 순서로 물리 삭제하고 링크를 남긴다. 응답 `{ result: "draft_discarded", promiseId: null }`
- [x] AC-3 (처리 순서 4): draft가 아니면 마감 지난 collecting을 closed로 먼저 저장한다
- [x] AC-4 (처리 순서 5, MEMBER-10-03): 일반 참여자는 `status=cancelled`·`cancelled_at`, 본인 세션만 즉시 만료
- [x] AC-5 (처리 순서 6·7, STATE-06): 방장은 본인 제외 active 중 `created_at ASC, id ASC` 첫 사람이 후임(제출 여부 무관). 옛 방장 member·cancelled·cancelled_at 한 UPDATE 먼저, 새 방장 host, 옛 방장 세션만 만료
- [x] AC-6 (처리 순서 8): 후임 없는 방장은 참여자를 그대로 두고 약속만 cancelled + cancelled_at, 이 약속의 모든 세션 만료. 취소 API와 같은 결과이고 취소 API 동작은 바뀌지 않는다
- [x] AC-7 (처리 순서 9·10, MEMBER-12): draft 폐기 외에는 닉네임·PIN 해시·슬롯·제출 시각·버전 보존, confirmed 유지(자동 해제 없음), 탈퇴자는 집계에서 제외
- [x] AC-8 (처리 순서 11): 성공 응답은 모두 요청자 쿠키 Max-Age=0, 200 7개 필드(시각 초 단위 +09:00), no-store
- [x] AC-9: Origin 없음 403, 401·404·400, cancelled 409(세션 없이도)

## 데이터와 인터페이스

- DB 변경 없음
- 200: `{ promiseId, promiseStatus, participantStatus, participantCancelledAt, hostTransferred, newHostParticipantId, promiseCancelledAt }` / draft: `{ result: "draft_discarded", promiseId: null }`
- 에러: 400 `INVALID_REQUEST`, 401 `UNAUTHENTICATED`, 403 `INVALID_ORIGIN`·`FORBIDDEN`, 404 `PROMISE_NOT_FOUND`, 409 `PROMISE_CANCELLED`

## 구현 계획

1. RED: 대표 테스트 2건(승계, 후임 없음)을 메모리 가짜 DB의 끝 상태로 작성 + 아무것도 바꾸지 않는 빈 구현
2. GREEN: 공용 함수 3개 추출·추가, 서비스 구현
3. REFACTOR: 분기·재확인 테스트, Route Handler와 `route.test.ts`
4. 문서: state.md 구현 결정, API_CONVENTIONS 5.2 탈퇴 행, DECISION_CONFLICTS R-28·C-12

## 검증 계획

- Vitest 전체, `TZ=UTC`·`TZ=America/Los_Angeles`, lint·typecheck·build
- 개발 DB 실제 호출: 네 분기 끝 상태, draft 폐기 뒤 링크·재등록, 처음 확인할 수 있는 탈퇴자·집계·후임 방장 항목, R-22 표, 동시성, 확인용 데이터 삭제·스냅샷 비교
- 브라우저: 후임 방장이 열어 둔 화면의 방장 버튼(코드 변경 없음)

## 미정 사항

- 결정(이번 구현, R-28): 10분 지난 draft 방장도 폐기(410 아님), draft 일반 참여자 403, 처리 순서 번호 해석(X-11)
- 팀 확인 필요(기존): C-07(탈퇴자 세션 401·로그인 403), C-12(후임 없는 방장 탈퇴 뒤 `/me` 401)
- 화면 PR 몫: 후임 방장이 열어 둔 화면은 새로고침해야 방장 버튼이 나타남

## 결과

AC-1~9 충족. 검증 근거는 `context/current-feature.md` 검증 결과 참고.

- 구현: `lib/state/withdraw-participant.ts`, `app/api/v1/promises/[promiseId]/participants/me/route.ts`, `lib/member/draft-discard.ts`(신설, 방장 등록·설정 완료가 사용), `lib/member/session-expiry.ts`(`expireParticipantSessions`), `lib/state/cancel-promise.ts`(`markPromiseCancelled` 꺼냄), `lib/state/settings-change.ts`(`closeIfDeadlinePassed` 인자 타입만 넓힘)
- 기존 테스트 기대값 수정 없음
