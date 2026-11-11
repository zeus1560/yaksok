// 공통 상태 가드 (STATE-API-09) — scripts/verify/026-common-guard.mjs에서 옮김
// 잠금 대기 중 세션 변화는 DB 도우미 withRowLocked(다른 연결이 행을 잠근 채 요청을 보냄)로 만든다
import { test, expect } from "../support/fixtures";
import {
  as,
  call,
  cookieOf,
  isClearedCookie,
  login,
  nick,
  setCookieOf,
  seoulDate,
  startBody,
  type ApiResponse,
  type Draft,
} from "../support/api";
import {
  ageDraft,
  expireSession,
  participantsMd5,
  passDeadline,
  promiseMd5,
  promiseRow,
  promisesOfLink,
  sessionExists,
  sessionRow,
  sessionsMd5,
  slotCount,
  withRowLocked,
} from "../support/db";

function expectError(label: string, res: ApiResponse, status: number, code: string) {
  expect([res.status, res.json?.code], `${label}: ${res.text}`).toEqual([status, code]);
  expect(res.cacheControl, `${label} no-store`).toBe("no-store");
}
const registerHost = (inviteToken: string, nickname = nick("h"), origin?: string | null) =>
  call("POST", `/api/v1/links/${inviteToken}/host`, { body: { nickname, pin: "1357" }, origin });
const start = (D: Pick<Draft, "promiseId">, token?: string) =>
  call("POST", `/api/v1/promises/${D.promiseId}/start`, {
    cookie: token ? cookieOf(D.promiseId, token) : undefined,
    body: startBody(threeHoursLater()),
  });
// 026과 같은 설정: 마감 3시간 뒤(30분 단위 올림)
function threeHoursLater() {
  const ms = Math.ceil((Date.now() + 3 * 3600e3) / 1800e3) * 1800e3;
  return {
    dateRange: { startDate: seoulDate(1), endDate: seoulDate(3) },
    votingDeadlineAt: `${new Date(ms + 9 * 3600e3).toISOString().slice(0, 19)}+09:00`,
  };
}
const rowsOf = async (promiseId: string) => [
  await promiseMd5(promiseId),
  await participantsMd5(promiseId),
  await sessionsMd5(promiseId),
];

test.describe("취소된 링크에 방장 등록 (MEMBER-API-02, R-25)", () => {
  test("draft를 취소한 링크 → 409 PROMISE_CANCELLED, 새 약속 없음", async ({ seed }) => {
    const A = await seed.draft();
    expect((await as(A.promiseId, A.hostToken).send("POST", "/cancel")).status).toBe(200);
    const before = await rowsOf(A.promiseId);
    const reg = await registerHost(A.inviteToken);
    expectError("취소된 draft 링크에 방장 등록", reg, 409, "PROMISE_CANCELLED");
    expect(reg.setCookies, "Set-Cookie 없음").toEqual([]);
    expect(await rowsOf(A.promiseId), "약속·참여자·세션 행 그대로").toEqual(before);
    expect(await promisesOfLink(A.inviteToken), "새 약속이 생기지 않음").toBe(1);
    const look = await call("GET", `/api/v1/links/${A.inviteToken}`, { origin: null });
    expect([look.status, look.json.promiseStatus, look.json.nextAction]).toEqual([
      200,
      "cancelled",
      "cancelled",
    ]);
  });

  test("collecting을 취소한 링크 → 409, 형식 검사는 여전히 먼저", async ({ seed }) => {
    const B = await seed.draft();
    expect((await start(B, B.hostToken)).status).toBe(200);
    expectError(
      "취소 전(대조군)",
      await registerHost(B.inviteToken),
      409,
      "HOST_ALREADY_REGISTERED",
    );
    expect((await as(B.promiseId, B.hostToken).send("POST", "/cancel")).status).toBe(200);
    const md5 = await promiseMd5(B.promiseId);
    expectError(
      "취소된 collecting 링크",
      await registerHost(B.inviteToken),
      409,
      "PROMISE_CANCELLED",
    );
    expect(await promiseMd5(B.promiseId)).toBe(md5);
    expectError(
      "닉네임 형식 오류",
      await registerHost(B.inviteToken, "a"),
      422,
      "VALIDATION_FAILED",
    );
    expectError(
      "Origin 없음",
      await registerHost(B.inviteToken, nick("h"), null),
      403,
      "INVALID_ORIGIN",
    );
  });
});

test.describe("설정 완료 잠금 후 재확인 (STATE-API-02, R-31·R-22)", () => {
  test("잠금 대기 중 로그아웃 → 401·쿠키 삭제·저장 없음, 다시 로그인하면 설정 완료", async ({
    seed,
  }) => {
    const C = await seed.draft();
    const md5 = await promiseMd5(C.promiseId);
    const { result, waited } = await withRowLocked(
      "link",
      C.promiseId,
      () => start(C, C.hostToken),
      async () => {
        const out = await call("DELETE", `/api/v1/promises/${C.promiseId}/auth/session`, {
          cookie: cookieOf(C.promiseId, C.hostToken),
        });
        expect(out.status, "잠금 대기 중 로그아웃 204").toBe(204);
      },
    );
    expect(waited, "준비: 설정 완료 요청이 인증을 통과해 잠금을 기다림").toBe(true);
    expectError("로그아웃과 겹친 설정 완료", result, 401, "UNAUTHENTICATED");
    expect(isClearedCookie(result, C.promiseId), "쿠키를 다시 심지 않고 Max-Age=0").toBe(true);
    expect(await promiseMd5(C.promiseId), "약속 행 그대로").toBe(md5);
    expect(await sessionExists(C.hostToken), "지운 세션이 되살아나지 않음").toBe(false);
    const re = await login(C.promiseId, C.hostNick, "1357");
    expect([re.res.status, re.res.json.role]).toEqual([200, "host"]);
    expect((await start(C, re.token!)).status).toBe(200);
    expect((await promiseRow(C.promiseId))?.status).toBe("collecting");
  });

  test("잠금 대기 중 세션 만료 → 401·쿠키 삭제·저장 없음", async ({ seed }) => {
    const D = await seed.draft();
    const md5 = await promiseMd5(D.promiseId);
    const { result, waited } = await withRowLocked(
      "link",
      D.promiseId,
      () => start(D, D.hostToken),
      () => expireSession(D.hostToken).then(() => undefined),
    );
    expect(waited).toBe(true);
    expectError("세션 만료와 겹친 설정 완료", result, 401, "UNAUTHENTICATED");
    expect(/Max-Age=0(;|$)/.test(setCookieOf(result, D.promiseId))).toBe(true);
    expect(await promiseMd5(D.promiseId)).toBe(md5);
  });

  test("겹치지 않는 정상·거절 경로 회귀", async ({ seed }) => {
    const E = await seed.draft();
    const ok = await start(E, E.hostToken);
    expect(ok.status, ok.text).toBe(200);
    const session = await sessionRow(E.hostToken);
    const row = await promiseRow(E.promiseId);
    expect(session!.expires_at.getTime(), "세션 = 마감 + 7일").toBe(
      row!.voting_deadline_at!.getTime() + 7 * 86400e3,
    );
    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookieOf(ok, E.promiseId))?.[1]);
    const expected = Math.floor((session!.expires_at.getTime() - Date.now()) / 1000);
    expect(
      Math.abs(maxAge - expected),
      "쿠키 Max-Age ≈ 마감 + 7일까지 남은 초(±10)",
    ).toBeLessThanOrEqual(10);
    expectError(
      "이미 collecting 재요청",
      await start(E, E.hostToken),
      409,
      "INVALID_PROMISE_STATE",
    );

    const F = await seed.draft();
    await ageDraft(F.promiseId);
    expectError("10분 지난 draft 설정 완료", await start(F, F.hostToken), 410, "DRAFT_EXPIRED");
    expect(await promiseRow(F.promiseId), "10분 지난 draft 삭제").toBeUndefined();

    const G = await seed.draft();
    await as(G.promiseId, G.hostToken).send("POST", "/cancel");
    expectError(
      "취소된 draft 설정 완료(세션보다 취소 우선)",
      await start(G),
      409,
      "PROMISE_CANCELLED",
    );
  });
});

test.describe("가능 시간 제출 잠금 후 재확인 순서 (TIME-API-01, R-32 N-2)", () => {
  const submit = (P: { promiseId: string }, token: string) =>
    as(P.promiseId, token).submit([`${seoulDate(1)}T10:00:00+09:00`]);
  const logoutCall = (promiseId: string, token: string) =>
    call("DELETE", `/api/v1/promises/${promiseId}/auth/session`, {
      cookie: cookieOf(promiseId, token),
    });

  test("마감 지남 + 잠금 대기 중 로그아웃·세션 만료 → 401, closed 저장 없음", async ({ seed }) => {
    const S1 = await seed.collecting({ members: 1 });
    const m1 = S1.members[0];
    await passDeadline(S1.promiseId);
    const md5 = await promiseMd5(S1.promiseId);
    const r1 = await withRowLocked(
      "promise",
      S1.promiseId,
      () => submit(S1, m1.token),
      async () => expect((await logoutCall(S1.promiseId, m1.token)).status).toBe(204),
    );
    expect(r1.waited).toBe(true);
    expectError("마감 지남 + 로그아웃과 겹친 제출", r1.result, 401, "UNAUTHENTICATED");
    expect(isClearedCookie(r1.result, S1.promiseId)).toBe(true);
    expect(await promiseMd5(S1.promiseId), "closed 저장 없음(약속 행 그대로)").toBe(md5);
    expect(await slotCount(S1.promiseId)).toBe(0);
    // 대조군: 유효 세션이면 마감 지남 → closed 저장 + 409 VOTING_CLOSED
    expectError("마감 지남 + 유효 세션 제출", await submit(S1, S1.hostToken), 409, "VOTING_CLOSED");
    expect((await promiseRow(S1.promiseId))?.status).toBe("closed");

    const S2 = await seed.collecting({ members: 1 });
    const m2 = S2.members[0];
    await passDeadline(S2.promiseId);
    const r2 = await withRowLocked(
      "promise",
      S2.promiseId,
      () => submit(S2, m2.token),
      () => expireSession(m2.token).then(() => undefined),
    );
    expect(r2.waited).toBe(true);
    expectError("마감 지남 + 세션 만료와 겹친 제출", r2.result, 401, "UNAUTHENTICATED");
    expect(/Max-Age=0(;|$)/.test(setCookieOf(r2.result, S2.promiseId))).toBe(true);
    expect((await promiseRow(S2.promiseId))?.status).toBe("collecting");
  });

  test("조기 마감·마감 전 + 로그아웃과 겹친 제출 → 401, 정상 제출·취소 우선 회귀", async ({
    seed,
  }) => {
    const S3 = await seed.collecting({ members: 1 });
    const m3 = S3.members[0];
    expect((await as(S3.promiseId, S3.hostToken).send("POST", "/close")).status).toBe(200);
    const r3 = await withRowLocked(
      "promise",
      S3.promiseId,
      () => submit(S3, m3.token),
      async () => expect((await logoutCall(S3.promiseId, m3.token)).status).toBe(204),
    );
    expect(r3.waited).toBe(true);
    expectError("closed + 로그아웃과 겹친 제출", r3.result, 401, "UNAUTHENTICATED");
    expect(isClearedCookie(r3.result, S3.promiseId)).toBe(true);

    const S4 = await seed.collecting({ members: 1 });
    const ok = await submit(S4, S4.members[0].token);
    expect([ok.status, ok.json.version]).toEqual([200, 1]);
    expect(await slotCount(S4.promiseId)).toBe(1);

    const S5 = await seed.collecting({ members: 1 });
    const m5 = S5.members[0];
    const r5 = await withRowLocked(
      "promise",
      S5.promiseId,
      () => submit(S5, m5.token),
      async () => expect((await logoutCall(S5.promiseId, m5.token)).status).toBe(204),
    );
    expect(r5.waited).toBe(true);
    expectError("마감 전 + 로그아웃과 겹친 제출", r5.result, 401, "UNAUTHENTICATED");
    expect(isClearedCookie(r5.result, S5.promiseId)).toBe(true);
    expect(await slotCount(S5.promiseId)).toBe(0);

    await as(S4.promiseId, S4.hostToken).send("POST", "/cancel");
    expectError(
      "취소된 약속 제출",
      await submit(S4, S4.members[0].token),
      409,
      "PROMISE_CANCELLED",
    );
  });
});
