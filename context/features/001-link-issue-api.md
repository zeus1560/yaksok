# 웹 초대 링크 발급 API (MEMBER-API-09)

## 식별자와 상태

- 스펙 ID: `001-link-issue-api`
- 상태: 완료
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 비즈니스 규칙: MEMBER-01-01, MEMBER-02-01, STATE-02-01 (`docs/specs/rules/`)
- ERD: DATABASE.md 3절 `promise_links` (`invite_token` UNIQUE, `source` CHECK web/kakao)
- API: MEMBER-API-09 (`docs/specs/api/member.md`), 공통 규약 3절·7절 (`docs/specs/API_CONVENTIONS.md`)
- US: US-CREAT-04 약속 생성 및 초대 링크 발급
- 관련 미결·충돌: R-09(해결됨), A-09(Origin 실패 코드 통일, 이번에 추가)

## 사용자와 문제

웹에서 「새 약속 만들기」를 누른 사람은 카카오 챗봇 없이도 초대 링크를 받아야 한다. 링크를 받은 뒤 바로 방장 등록 화면(`/p/{inviteToken}`)으로 이동해야 한다.

## 목표와 범위

- 이번에 구현할 동작:
  - `POST /api/v1/links` Route Handler
  - `lib/member/`의 내부 발급 함수 (`source`를 인자로 받음, 웹 라우트는 `'web'` 고정)
  - Origin 검증과 403 `INVALID_ORIGIN`
  - 공통 에러 응답 헬퍼 (이 API에 필요한 만큼)
  - 문서: API_CONVENTIONS 에러 표·member.md 09 에러 표에 `INVALID_ORIGIN` 추가, DECISION_CONFLICTS A-09 기록
- 이번에 구현하지 않을 동작:
  - `/p/[inviteToken]` 페이지, MEMBER-API-01·02, 챗봇 스킬 라우트, 「새 약속 만들기」 버튼 UI
  - IP 레이트 리밋, 미리보기 배포 Origin 허용

## 선행 작업

없음. ERD 스키마(`promise_links`)는 erd_v2 마이그레이션으로 적용되어 있다.

## 사용자 흐름

「새 약속 만들기」 → 브라우저가 `POST /api/v1/links` (Origin 포함) → 서버가 토큰 생성 후 `promise_links`에 `source='web'`으로 삽입 → 201 `{ inviteToken, inviteUrl, nextAction: "register_host" }` → 클라이언트가 `inviteUrl`로 이동 (이동 이후는 MEMBER-API-01·02 범위).

실패: Origin 없음·불일치 → 403 `INVALID_ORIGIN`. 토큰 충돌 재시도 실패·DB 오류 → 500 `INTERNAL_ERROR`.

## 수용 기준

- [ ] AC-1 (MEMBER-01-01, MEMBER-API-09): 허용 Origin으로 요청하면 201과 `{ inviteToken, inviteUrl, nextAction: "register_host" }`를 반환하고 `promise_links`에 행 하나가 `source='web'`으로 생긴다. 응답에 `promiseId`가 없다.
- [ ] AC-2 (STATE-02-01): 발급은 `promises`·`participants` 행을 만들지 않는다.
- [ ] AC-3 (MEMBER-API-09 내부 발급 함수): 요청 본문(`source: "kakao"` 등)은 읽지 않으며 저장되는 `source`에 영향을 주지 않는다.
- [ ] AC-4 (MEMBER-API-09): `inviteUrl`은 `NEXT_PUBLIC_BASE_URL + "/p/" + inviteToken`이며 BASE_URL 끝 슬래시가 있어도 `//`가 생기지 않는다.
- [ ] AC-5 (MEMBER-API-09): `invite_token` UNIQUE 위반(P2002)이면 새 토큰으로 1회 재시도한다. 두 번 연속 실패하거나 그 밖의 DB 오류면 500 `INTERNAL_ERROR`를 반환하고 원시 오류를 노출하지 않는다.
- [ ] AC-6 (API_CONVENTIONS 7절): Origin 헤더가 없거나 `NEXT_PUBLIC_BASE_URL`의 origin과 다르면 403 `INVALID_ORIGIN`을 반환하고 DB에 삽입하지 않는다.
- [ ] AC-7 (MEMBER-API-01 보안 정보): 토큰은 암호학적 난수(128비트)다.

## 데이터와 인터페이스

- 테이블 변경 없음. `promise_links (invite_token, source)` 삽입만 한다.
- 계약: MEMBER-API-09 참조. 에러 표에 403 `INVALID_ORIGIN` 추가.

## 구현 계획

1. `lib/api-error.ts`: `{ code, message, details? }` 형식 응답 헬퍼
2. `lib/origin.ts`: 요청 Origin과 `NEXT_PUBLIC_BASE_URL` origin 비교
3. `lib/member/invite-link.ts`: 토큰 생성, `issueInviteLink(source)`, `buildInviteUrl(token)`
4. `app/api/v1/links/route.ts`: Origin 검증 → 발급 → 201
5. 문서 갱신 (API_CONVENTIONS, member.md, DECISION_CONFLICTS)

## 검증 계획

- Vitest: `lib/member/invite-link.test.ts`, `app/api/v1/links/route.test.ts` (prisma 모킹) — AC-1~7
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`
- 개발 DB로 dev 서버를 띄워 curl로 201·403 확인, 실제 UNIQUE 위반이 P2002인지 확인
- DATABASE.md 11절 체크리스트: 해당 항목 없음 (링크 발급은 선점·잠금과 무관)

## 미정 사항

- 합의됨: 403 `INVALID_ORIGIN` 신설. 02·03·04·07도 같은 코드로 맞출 것 (DECISION_CONFLICTS A-09)
- [제안] 토큰 형식: `crypto.randomBytes(16)` base64url, 22자. MEMBER-API-01은 inviteToken을 `string`으로만 정의하고 길이·문자 검증 규칙이 없어 충돌하지 않는다 (예시값 12자는 예시일 뿐)
- [제안] IP 레이트 리밋: 구현하지 않음. 공개 배포 전 재판단 (MEMBER-API-09 보안 정보)
- 범위 밖: 미리보기 배포(Vercel Preview)의 Origin 허용. 현재는 `NEXT_PUBLIC_BASE_URL`과 다른 도메인에서 403이 된다

## 결과

2026-11-03 구현·검증, 2026-11-04 검토 승인 후 완료 (재실행 `npm run test` 15건 통과)

| 수용 기준 | 결과 | 근거 |
| --- | --- | --- |
| AC-1 | 충족 | `route.test.ts` 201 응답 키 3개·`source='web'` / curl 201 / 개발 DB에서 `source=web` 행 확인 |
| AC-2 | 충족 | `issueInviteLink`는 `promiseLink.create`만 호출 / 개발 DB `promises`·`participants` 0행, 링크의 `promise=null` |
| AC-3 | 충족 | 라우트가 본문을 읽지 않음 / `route.test.ts` 본문 무시 / curl `{"source":"kakao"}` → DB `source=web` |
| AC-4 | 충족 | `invite-link.test.ts` buildInviteUrl 끝 슬래시 유무 |
| AC-5 | 충족 | `invite-link.test.ts` 재시도 1회·연속 충돌·기타 오류 무재시도 / `route.test.ts` 500 본문 고정·원문 미노출 / 개발 DB 실제 중복 삽입 → `PrismaClientKnownRequestError P2002` |
| AC-6 | 충족 | `route.test.ts` Origin 없음·다른 도메인·다른 포트·`null` → 403, 삽입 없음 / curl 403 2건 |
| AC-7 | 충족 | `randomBytes(16)` base64url, `invite-link.test.ts` 22자 형식 |

변경 파일: `app/api/v1/links/route.ts`, `lib/member/invite-link.ts`, `lib/api-error.ts`, `lib/origin.ts`, 테스트 2개, 문서 3개(API_CONVENTIONS, member.md, DECISION_CONFLICTS A-09).
