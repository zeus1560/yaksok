// 로그아웃 API (MEMBER-API-07) — scripts/verify/025-logout.mjs에서 옮김
import { test, expect } from "../support/fixtures";
import { as, call, cookieOf, join, login, nick, seoulDate, type ApiResponse } from "../support/api";
import {
  expireSession,
  participantsMd5,
  promiseStatus,
  sessionCount,
  sessionExists,
  promiseMd5,
  sessionsMd5,
  slotsMd5,
} from "../support/db";

const NO_PROMISE = "00000000-0000-4000-8000-000000000000";

const logout = (
  promiseId: string,
  token: string | null,
  query = "",
  opts: { origin?: string | null; cookie?: string } = {},
) =>
  call("DELETE", `/api/v1/promises/${promiseId}/auth/session${query}`, {
    cookie: opts.cookie ?? (token === null ? undefined : cookieOf(promiseId, token)),
    origin: opts.origin,
  });
const promiseRows = async (promiseId: string) => [
  await promiseMd5(promiseId),
  await participantsMd5(promiseId),
  await sessionsMd5(promiseId),
  await slotsMd5(promiseId),
];
const me = (promiseId: string, token: string) => as(promiseId, token).get("/me");

function expect204(label: string, res: ApiResponse, promiseId: string) {
  expect(res.status, `${label}: ${res.text}`).toBe(204);
  expect(res.text, `${label}: 본문 없음`).toBe("");
  expect(res.setCookies, `${label}: 쿠키 Max-Age=0(이름·Path 일치)`).toEqual([
    `ys_session_${promiseId}=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${promiseId}; Max-Age=0`,
  ]);
  expect(res.cacheControl, `${label}: no-store`).toBe("no-store");
}
function expectError(label: string, res: ApiResponse, status: number, code: string) {
  expect([res.status, res.json?.code], `${label}: ${res.text}`).toEqual([status, code]);
  expect(res.setCookies, `${label}: 쿠키 변경 없음`).toEqual([]);
  expect(res.cacheControl, `${label}: no-store`).toBe("no-store");
}

test("이 기기·모든 기기 로그아웃과 재로그인, 참여자·슬롯 보존", async ({ seed }) => {
  // 준비: 약속(collecting) 방장 H, 참여자 A(두 기기)·B, A는 슬롯 제출
  const P = await seed.collecting({ members: 0 });
  const p = P.promiseId;
  const aNick = nick("a");
  const a1 = await join(p, aNick);
  const a2 = await login(p, aNick);
  const b1 = await join(p, nick("b"));
  const day = seoulDate(1);
  const submitted = await as(p, a1.token).submit([
    `${day}T10:00:00+09:00`,
    `${day}T10:30:00+09:00`,
  ]);
  expect(submitted.status).toBe(200);

  await test.step("이 기기만 로그아웃", async () => {
    const people = await participantsMd5(p);
    const slots = await slotsMd5(p);
    const others = await sessionsMd5(p, a1.id);
    expect204("A 기기1 로그아웃", await logout(p, a1.token), p);
    expect(await sessionExists(a1.token), "A 기기1 세션 행 삭제").toBe(false);
    expect(await sessionExists(a2.token!), "A 기기2 세션 행 그대로").toBe(true);
    expect(await sessionCount(a1.id)).toBe(1);
    expect(await sessionsMd5(p, a1.id), "다른 참여자 세션 그대로").toBe(others);
    expect(await participantsMd5(p), "참여자 행 전부 그대로").toBe(people);
    expect(await slotsMd5(p), "슬롯 그대로").toBe(slots);
    const a2me = await me(p, a2.token!);
    expect([a2me.status, a2me.json.status]).toEqual([200, "active"]);
    expect(a2me.json.availabilitySubmittedAt, "제출 시각 유지").not.toBeNull();
    expect((await me(p, a1.token)).status).toBe(401);
    const avail = await as(p, a2.token!).get("/availability");
    expect([avail.status, avail.json?.me?.slots?.length]).toEqual([200, 2]);
  });

  await test.step("같은 요청 반복: 204·이 약속의 행 변경 없음", async () => {
    // 다른 테스트가 같은 DB를 동시에 쓰므로 이 약속의 행만 비교한다
    const before = await promiseRows(p);
    expect204("반복", await logout(p, a1.token), p);
    expect(await promiseRows(p)).toEqual(before);
  });

  let reToken = "";
  await test.step("로그아웃 뒤 같은 닉네임·PIN 재로그인", async () => {
    const people = await participantsMd5(p);
    const re = await login(p, aNick);
    expect([re.res.status, re.res.json.status]).toEqual([200, "active"]);
    reToken = re.token!;
    expect(await sessionExists(reToken)).toBe(true);
    expect(await participantsMd5(p)).toBe(people);
  });

  await test.step("allDevices=true: 그 참여자 세션만 전부 삭제", async () => {
    const people = await participantsMd5(p);
    const slots = await slotsMd5(p);
    expect(await sessionCount(P.hostId)).toBe(1);
    expect204("A allDevices=true", await logout(p, a2.token!, "?allDevices=true"), p);
    expect(await sessionCount(a1.id)).toBe(0);
    expect((await me(p, a2.token!)).status).toBe(401);
    expect((await me(p, reToken)).status).toBe(401);
    expect((await as(p, a2.token!).submit([], 1)).status, "A 기기2 제출 401").toBe(401);
    expect((await me(p, P.hostToken)).status).toBe(200);
    expect(await sessionCount(P.hostId), "방장 세션 수 그대로").toBe(1);
    expect((await me(p, b1.token)).status).toBe(200);
    expect([await participantsMd5(p), await slotsMd5(p)]).toEqual([people, slots]);
    expect204("allDevices=true 반복", await logout(p, a2.token!, "?allDevices=true"), p);
  });

  await test.step("allDevices=false 명시", async () => {
    const re2 = await login(p, aNick);
    expect(re2.res.status).toBe(200);
    expect204("allDevices=false", await logout(p, re2.token!, "?allDevices=false"), p);
    expect(await sessionExists(re2.token!)).toBe(false);
  });
});

test("쿠키 없음·다른 이름·위조·만료 쿠키", async ({ seed }) => {
  const P = await seed.collecting({ members: 0 });
  const p = P.promiseId;
  const bNick = nick("b");
  const b1 = await join(p, bNick);

  expectError("쿠키 없음", await logout(p, null), 401, "UNAUTHENTICATED");
  expectError(
    "다른 약속 이름의 쿠키만",
    await logout(p, null, "", { cookie: `ys_session_${NO_PROMISE}=${b1.token}` }),
    401,
    "UNAUTHENTICATED",
  );
  expect(await sessionExists(b1.token), "다른 이름 쿠키의 세션 그대로").toBe(true);
  expect204("위조 토큰", await logout(p, "forged-token-value"), p);

  // 만료 쿠키는 allDevices=true여도 자기 행만 지운다(판단: 만료 토큰으로 전체 로그아웃 안 함)
  const b2 = await login(p, bNick);
  await expireSession(b1.token, "1 minute");
  expect((await me(p, b1.token)).status).toBe(401);
  expect204("만료 쿠키 allDevices=true", await logout(p, b1.token, "?allDevices=true"), p);
  expect(await sessionExists(b1.token)).toBe(false);
  expect(await sessionExists(b2.token!), "B 기기2 유효 세션 그대로").toBe(true);
  expect((await me(p, b2.token!)).status).toBe(200);
});

test("탈퇴·내보내진 참여자의 남은 쿠키, 다른 약속 세션 403", async ({ seed }) => {
  const P = await seed.collecting({ members: 0 });
  const p = P.promiseId;
  const cNick = nick("c");
  const c1 = await join(p, cNick);
  const c2 = await login(p, cNick);
  expect((await as(p, c1.token).send("DELETE", "/participants/me")).status, "C 탈퇴").toBe(200);
  const people = await participantsMd5(p);
  expect204("탈퇴자 쿠키", await logout(p, c1.token, "?allDevices=true"), p);
  expect(await sessionExists(c1.token)).toBe(false);
  expect(await sessionExists(c2.token!), "탈퇴자 다른 기기 행은 만료 상태로 남음").toBe(true);
  expect(await participantsMd5(p), "탈퇴자 참여자 행 그대로").toBe(people);
  expect((await login(p, cNick)).res.json?.code).toBe("PARTICIPANT_CANCELLED");

  const d1 = await join(p, nick("d"));
  expect((await as(p, P.hostToken).send("DELETE", `/participants/${d1.id}`)).status).toBe(200);
  expect204("내보내진 참여자 쿠키", await logout(p, d1.token), p);
  expect(await sessionExists(d1.token)).toBe(false);

  const Q = await seed.collecting({ members: 0 });
  const qSessions = await sessionsMd5(Q.promiseId);
  expectError(
    "다른 약속 세션",
    await logout(p, null, "?allDevices=true", { cookie: cookieOf(p, Q.hostToken) }),
    403,
    "FORBIDDEN",
  );
  expect(await sessionExists(Q.hostToken)).toBe(true);
  expect(await sessionsMd5(Q.promiseId)).toBe(qSessions);
  expect((await me(Q.promiseId, Q.hostToken)).status).toBe(200);
});

test("Origin·형식 오류·없는 약속·대문자 promiseId", async ({ seed }) => {
  const P = await seed.collecting({ members: 0 });
  const p = P.promiseId;
  const b = await join(p, nick("b"));
  expectError("Origin 없음", await logout(p, b.token, "", { origin: null }), 403, "INVALID_ORIGIN");
  expectError(
    "다른 Origin",
    await logout(p, b.token, "", { origin: "https://evil.example" }),
    403,
    "INVALID_ORIGIN",
  );
  expectError("promiseId 형식", await logout("not-a-uuid", b.token), 400, "INVALID_REQUEST");
  for (const q of [
    "?allDevices=1",
    "?allDevices=TRUE",
    "?allDevices=",
    "?allDevices=true&allDevices=false",
  ]) {
    expectError(`allDevices ${q}`, await logout(p, b.token, q), 400, "INVALID_REQUEST");
  }
  expectError("없는 약속", await logout(NO_PROMISE, b.token), 404, "PROMISE_NOT_FOUND");
  expect(await sessionExists(b.token), "거절 뒤 세션 그대로").toBe(true);
  // 대문자 promiseId: 쿠키 이름은 소문자 DB id
  const upper = await call("DELETE", `/api/v1/promises/${p.toUpperCase()}/auth/session`, {
    cookie: cookieOf(p, b.token),
  });
  expect204("대문자 promiseId", upper, p);
  expect(await sessionExists(b.token)).toBe(false);
});

test("취소된 약속·draft 방장 로그아웃", async ({ seed }) => {
  const P = await seed.collecting({ members: 1 });
  const p = P.promiseId;
  const e = P.members[0];
  expect((await as(p, P.hostToken).send("POST", "/cancel")).status).toBe(200);
  expect((await as(p, e.token).get()).json?.code).toBe("PROMISE_CANCELLED");
  expect204("cancelled 약속 참여자", await logout(p, e.token), p);
  expect(await sessionExists(e.token)).toBe(false);
  expect204("cancelled 약속 방장 allDevices", await logout(p, P.hostToken, "?allDevices=true"), p);
  expect(await promiseStatus(p)).toBe("cancelled");
  expectError("cancelled 약속 쿠키 없음", await logout(p, null), 401, "UNAUTHENTICATED");

  const D = await seed.draft();
  expect204("draft 방장 로그아웃", await logout(D.promiseId, D.hostToken), D.promiseId);
  expect((await me(D.promiseId, D.hostToken)).status).toBe(401);
  const re = await login(D.promiseId, D.hostNick, "1357");
  expect([re.res.status, re.res.json.role]).toEqual([200, "host"]);
  expect(await promiseStatus(D.promiseId)).toBe("draft");
});
