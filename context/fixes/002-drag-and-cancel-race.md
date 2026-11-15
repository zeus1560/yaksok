# 드래그 마지막 칸 누락(WebKit)과 취소와 겹친 조회의 401

브랜치: `ahn/fix-drag-and-cancel-race` (`origin/main` a393e87에서 생성). 첫 커밋 72aa535 `docs: 032 완료 기록`

## 환경과 증상

### 1. 드래그 마지막 칸 누락 (WebKit)

- 발견: 031 통합 테스트(2026-11-11). webkit 데스크톱에서만 재현, `test.fail`로 표시해 둠
- 기대: 마우스로 18:00 → 19:00을 끌고 19:00 칸에 들어간 직후(0ms) 놓아도 18:00·18:30·19:00 3칸이 선택된다
- 실제: 1칸 또는 2칸만 선택된다(마지막 칸, 때로는 그 앞 칸까지 빠짐). 들어간 뒤 50ms 기다렸다 놓으면 정상

### 2. 취소와 겹친 조회의 401 (R-37)

- 발견: 032 2부 미리보기 배포 확인(2026-11-12, 함수 지역 `iad1` 배포 2회차)
- 기대: 취소된 약속의 세션 API는 세션 상태와 관계없이 409 `PROMISE_CANCELLED`(STATE-API-00 「cancelled가 세션보다 우선」)
- 실제: 취소 커밋과 겹친 조회가 401 `UNAUTHENTICATED`를 받음. 화면은 401 뒤 링크를 다시 조회해 취소 안내로 가므로 사용자 결과는 같음

## 재현

1. 드래그: `tests/e2e/availability-sync.spec.ts` 「드래그 마지막 칸에 들어간 직후(0ms) 놓아도 3칸이 선택된다 (마우스)」 — 칸 중심에서 `mouse.down` → 8단계로 2칸 아래까지 `mouse.move` → 바로 `mouse.up`
2. 401: 약속 상태 읽기(collecting) → 그 사이 취소 커밋(세션 `expires_at` = 취소 시각) → 세션 읽기(만료) → 401. 단위 테스트에서 Prisma 응답 순서로 재현

## 원인과 수정 범위

### 1. 드래그

- **원인(실행으로 확인):** `components/availability/my-grid.tsx`는 놓기 처리(`finish`)를 `useEffect` 안에서 window에 달고, `finish`는 그 효과가 실행된 렌더의 `drag`를 붙든다. 칸에 들어갈 때의 `setDrag`는 pointerenter(React 연속 우선순위)라 렌더와 효과가 이벤트 뒤로 밀린다. 마지막 칸에 들어간 직후 놓으면 효과가 다시 달리기 전의 `finish`가 불려 앞 칸 기준으로 확정된다
  - 확인 방법: 임시 `console.log`(렌더·pointerenter·finish의 `current` 행과 `performance.now()`)를 넣어 빌드하고 webkit 데스크톱 3회 실행, trace의 콘솔 기록을 읽음(로그는 확인 뒤 삭제)
  - 실패 회차(repeat1): `render current=10 t=4616.0` → `finish pointerup current=9 t=4619.0` — 화면은 마지막 칸(10)까지 그렸는데 3ms 뒤 불린 놓기 리스너는 앞 칸(9)을 읽음. 통과 회차는 마지막 렌더(4158.0·3301.0) 뒤 약 40~50ms 지나 놓기가 와서 효과가 이미 다시 달려 있었음
  - 첫 RED 실행의 `Received: 1`은 두 번의 이동이 모두 반영되기 전(누른 칸만 있는 리스너)에 놓기가 온 경우
- **수정:** 드래그 상태를 이벤트마다 즉시 바뀌는 순수 객체 `lib/availability/drag.ts` `createDragTracker`로 옮김(start·move·end, end는 한 번만 드래그를 돌려줌). 화면은 `onChange`로 받은 값을 `drag` 상태로 그리기만 한다. 놓기 리스너(pointerup·pointercancel·blur)는 pointerdown에서 바로 달고 tracker에서 마지막 칸을 읽는다(누르자마자 놓아도 놓치지 않음). 드래그 중 화면이 사라지면 리스너만 뗀다. 선택 기준은 누른 시점의 선택(드래그 중에는 폴링 반영을 보류하므로 바뀌지 않음)
- **보존:** 드래그한 사각형을 첫 칸의 반대 상태로 통일, 지난 칸 제외, 그리드 밖·창 밖에서 놓아도 끝남, 터치·펜·키보드 탭 토글, 드래그 중 폴링 보류(`onDragActive`), 텍스트 선택 방지

### 2. 401

- **원인:** `lib/member/session-auth.ts` `authenticatePromiseSession`이 약속 상태와 세션을 따로(잠금·트랜잭션 없이) 읽는다. 상태를 읽은 뒤 취소가 커밋되면 세션은 취소가 만료시킨 값이라 「무효 → 401」
- **수정:** 세션이 무효(`none`)해 401을 내기 직전에, `allowCancelled`가 아니면 약속 상태를 한 번 더 읽어 cancelled면 `cancelled`(라우트에서 409 `PROMISE_CANCELLED`). 다시 읽은 약속이 없으면(만료 draft 삭제) 401 그대로
- **쿼리 수:** 401 경로에만 1번 늘고 정상(ok)·다른 약속 세션(forbidden)·처음부터 cancelled 경로는 그대로(단위 테스트로 호출 횟수 확인)
- **바꾸지 않음:** `/me`(MEMBER-05, `allowCancelled` — C-12), 로그아웃(MEMBER-07, 공통 인증 미사용 — R-31). 잠금 후·트랜잭션 안 재확인은 원래 취소 409를 세션 401보다 먼저 봄
- 문서: `docs/development/GUARD_MATRIX.md` 「이후 수정」 절, `DECISION_CONFLICTS.md` R-37

## 수용 기준과 회귀 확인

- [x] 드래그 RED: `test.fail`을 지우고 webkit 데스크톱 5회 → 4회 실패
- [x] 드래그 GREEN: webkit 데스크톱 5회 모두 통과, chromium 통과, 50ms를 두던 기존 드래그 테스트도 통과
- [x] 401 RED: 「약속 상태를 읽은 뒤 취소가 커밋되고 세션이 만료됐으면 401이 아니라 409 PROMISE_CANCELLED (R-37)」가 고치기 전 코드에서 실패
- [x] 401 GREEN과 예외: 같은 테스트 통과, `/me`·로그아웃 기존 테스트 그대로 통과
- [x] 로컬 `test:e2e` 세 프로젝트 1회 — 100 통과·2 건너뜀·실패 0 (031에서 `test.fail`이던 webkit 0ms 드래그 포함)
- [x] 미리보기 배포 `@smoke` 2회 — 배포 b83f322(함수 지역 `sin1`)에서 9/9 연속 2회(그 전 1회도 9/9, 사이의 1회는 PC 네트워크 끊김으로 무효)

## 실제 결과

2026-11-15, Node.js 24, Playwright 1.64.1

| 단계              | 명령·방법                                                                                                                    | 결과                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 드래그 RED        | `test.fail` 삭제 → `npx playwright test availability-sync -g "0ms" --project=webkit-desktop --repeat-each=5`                 | **4 failed, 1 passed**. `18:00·18:30·19:00 3칸` — `Expected: 3, Received: 1`(`Timeout 3000ms exceeded while waiting on the predicate`). 스냅샷 동일                                                                                                                                                                                                                                                              |
| 원인 확인         | 임시 로그 + `--repeat-each=3 --trace=on`, trace 콘솔                                                                         | 1 failed·2 passed. 실패 회차 `render current=10 t=4616.0` → `finish pointerup current=9 t=4619.0`(위 원인). 로그 삭제                                                                                                                                                                                                                                                                                            |
| 드래그 GREEN      | `npx playwright test availability-sync -g "0ms\|드래그" --project=webkit-desktop --project=chromium-desktop --repeat-each=5` | **20 passed**(1.8분) — 0ms 테스트·「빈 제출 확인 취소 직후 첫 드래그 반영, 드래그 뒤 글자 선택 없음 (마우스)」(50ms) × webkit·chromium × 5회. 스냅샷 동일                                                                                                                                                                                                                                                        |
| 드래그 단위       | `lib/availability/drag.test.ts`                                                                                              | 5개 통과 — 화면 반영 전에 끝내도 마지막 칸, 누르자마자 놓기, 두 번째 end는 null, 드래그 밖 이동 무시, 바뀔 때만 알림                                                                                                                                                                                                                                                                                             |
| 401 RED           | `npx vitest run lib/member/session-auth.test.ts`(고치기 전)                                                                  | **2 failed, 25 passed**. 「…409 PROMISE_CANCELLED (R-37)」 `AssertionError: expected { kind: 'unauthenticated' } to deeply equal { kind: 'cancelled' }`, 「401 직전에 다시 읽어도 취소가 아니면 unauthenticated」 `expected "vi.fn()" to be called 2 times, but got 1 times`                                                                                                                                     |
| 401 GREEN         | 같은 파일                                                                                                                    | 27/27(새 4개 + 정상 경로·forbidden이 약속을 한 번만 읽는지 확인 2곳)                                                                                                                                                                                                                                                                                                                                             |
| 예외 회귀         | `npx vitest run lib/member/me.test.ts lib/member/logout.test.ts promiseId]/me/route promiseId]/auth/session`                 | 4파일 104개 통과(기대값 수정 없음)                                                                                                                                                                                                                                                                                                                                                                               |
| 단위·정적         | `npm run test`(PowerShell), `TZ=UTC`·`TZ=America/Los_Angeles`, `npm run lint`, `npm run typecheck`, `npx prettier --check .` | 1676 통과(81파일, 이번 9건) ×3, 통과, 통과, 통과                                                                                                                                                                                                                                                                                                                                                                 |
| 로컬 통합         | `npx playwright test`(빌드 포함, chromium·webkit·webkit 모바일 1회, dev 서버 없음)                                           | **100 passed, 2 skipped**, 실패·「예상과 다름」 0, 18.3분. DB 스냅샷 시작 상태와 동일                                                                                                                                                                                                                                                                                                                            |
| 빌드·정리         | `npm run build`, 포트 3000·3100·3101과 `next`·playwright 프로세스                                                            | 통과(일반 빌드로 되돌림), 남은 포트·프로세스 없음                                                                                                                                                                                                                                                                                                                                                                |
| smoke 1회         | 배포 b83f322(Preview, 배포 고유 주소) `npm run test:e2e:preview`                                                             | **9 passed**, 3.3분. `/api/health 166ms, 함수 지역 sin1`. 스냅샷 동일                                                                                                                                                                                                                                                                                                                                            |
| smoke 2회(무효)   | 같은 명령                                                                                                                    | 7 passed·2 failed(webkit 데스크톱·모바일 전체 흐름), 1.9시간. trace: 02:39:56Z에 배포 주소·Neon 주소가 함께 `Could not resolve hostname`·`Failed sending data to the peer`로 실패하고 04:05:03Z까지 약 85분 동안 요청 없음 — 이 PC의 절전·네트워크 끊김(배포·코드 문제 아님). 401은 모두 제출 단계 전의 `GET /me`(참여 전, C-12 그대로)로 취소와 관계없음. 정리 단계도 DNS 실패로 못 돌아 테스트 링크 2개가 남음 |
| smoke 2회(재실행) | 같은 명령                                                                                                                    | **9 passed**, 2.1분. `/api/health 128ms, 함수 지역 sin1`. 시작 때 남은 테스트 링크 2개 정리(기록 10개), 스냅샷 동일                                                                                                                                                                                                                                                                                              |
| smoke 3회         | 같은 명령                                                                                                                    | **9 passed**, 2.1분. `/api/health 120ms, 함수 지역 sin1`. 스냅샷 동일, 남은 실행 기록 없음 — **연속 2회 통과**                                                                                                                                                                                                                                                                                                   |
