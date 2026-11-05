import { beforeEach, describe, expect, it, vi } from "vitest";

const promiseFindUnique = vi.hoisted(() => vi.fn());
const sessionFindUnique = vi.hoisted(() => vi.fn());
const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    promise: { findUnique: promiseFindUnique },
    participantSession: { findUnique: sessionFindUnique },
    $queryRaw: queryRaw,
  },
}));

import { hashSessionToken } from "./session";
import {
  authenticatePromiseSession,
  findActivePromiseSession,
  readCookie,
  withSessionCookie,
  type PromiseSession,
} from "./session-auth";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const OTHER_PROMISE_ID = "0e2a9d61-3b7c-4f15-8a40-6c1d2e9f7b33";
const NOW = new Date("2026-11-04T12:00:00.400+09:00");
const TOKEN = "session-token-abc";
const COOKIE = `ys_session_${PROMISE_ID}`;

function request(cookie?: string) {
  return new Request(`http://localhost:3000/api/v1/promises/${PROMISE_ID}/start`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

function mockPromise(status = "draft") {
  promiseFindUnique.mockResolvedValueOnce({ id: PROMISE_ID, status, promiseLinkId: "l-1" });
  queryRaw.mockResolvedValueOnce([{ now: NOW }]);
}

function mockSession(overrides: { expiresAt?: Date; status?: string; promiseId?: string } = {}) {
  sessionFindUnique.mockResolvedValueOnce({
    id: "s-1",
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 60_000),
    participant: {
      id: "pt-1",
      promiseId: overrides.promiseId ?? PROMISE_ID,
      role: "host",
      status: overrides.status ?? "active",
    },
  });
}

describe("readCookie", () => {
  it("여러 쿠키 중 이름이 정확히 같은 값만 고른다", () => {
    const req = request(`a=1; ${COOKIE}x=bad; ${COOKIE}=${TOKEN}; b=2`);
    expect(readCookie(req, COOKIE)).toBe(TOKEN);
  });

  it("없거나 빈 값이면 null", () => {
    expect(readCookie(request(), COOKIE)).toBeNull();
    expect(readCookie(request(`${COOKIE}=`), COOKIE)).toBeNull();
  });
});

describe("authenticatePromiseSession (세션 인증 공통)", () => {
  beforeEach(() => {
    for (const fn of [promiseFindUnique, sessionFindUnique, queryRaw]) fn.mockReset();
  });

  it("UUID 형식 오류 → invalid_request, DB 조회 없음", async () => {
    expect(await authenticatePromiseSession(request(), "not-a-uuid")).toEqual({
      kind: "invalid_request",
    });
    expect(promiseFindUnique).not.toHaveBeenCalled();
  });

  it("없는 약속 → not_found", async () => {
    promiseFindUnique.mockResolvedValueOnce(null);
    queryRaw.mockResolvedValueOnce([{ now: NOW }]);
    expect(await authenticatePromiseSession(request(), PROMISE_ID)).toEqual({ kind: "not_found" });
  });

  it("cancelled 약속은 쿠키가 없어도 세션 검사 전에 cancelled", async () => {
    mockPromise("cancelled");
    expect(await authenticatePromiseSession(request(), PROMISE_ID)).toEqual({ kind: "cancelled" });
    expect(sessionFindUnique).not.toHaveBeenCalled();
  });

  it("allowCancelled: cancelled 약속도 세션 검사를 이어서 한다 (MEMBER-API-05)", async () => {
    mockPromise("cancelled");
    mockSession();
    const result = await authenticatePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID, {
      allowCancelled: true,
    });
    expect(result).toMatchObject({
      kind: "ok",
      promise: { id: PROMISE_ID, status: "cancelled" },
      participant: { id: "pt-1", role: "host" },
    });
  });

  it("allowCancelled: cancelled 약속이어도 쿠키가 없으면 unauthenticated", async () => {
    mockPromise("cancelled");
    expect(
      await authenticatePromiseSession(request(), PROMISE_ID, { allowCancelled: true }),
    ).toEqual({ kind: "unauthenticated" });
  });

  it("쿠키 없음 → unauthenticated", async () => {
    mockPromise();
    expect(await authenticatePromiseSession(request(), PROMISE_ID)).toEqual({
      kind: "unauthenticated",
    });
    expect(sessionFindUnique).not.toHaveBeenCalled();
  });

  it("위조 토큰(해시 일치 행 없음) → unauthenticated, 원문 대신 SHA-256 해시로 조회", async () => {
    mockPromise();
    sessionFindUnique.mockResolvedValueOnce(null);
    expect(await authenticatePromiseSession(request(`${COOKIE}=forged`), PROMISE_ID)).toEqual({
      kind: "unauthenticated",
    });
    expect(sessionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionTokenHash: hashSessionToken("forged") } }),
    );
  });

  it("만료 경계: expires_at = DB 시각이면 unauthenticated", async () => {
    mockPromise();
    mockSession({ expiresAt: NOW });
    expect((await authenticatePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID)).kind).toBe(
      "unauthenticated",
    );
  });

  it("cancelled 참여자 → unauthenticated (C-07)", async () => {
    mockPromise();
    mockSession({ status: "cancelled" });
    expect((await authenticatePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID)).kind).toBe(
      "unauthenticated",
    );
  });

  it("다른 약속의 세션 → forbidden", async () => {
    mockPromise();
    mockSession({ promiseId: OTHER_PROMISE_ID });
    expect((await authenticatePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID)).kind).toBe(
      "forbidden",
    );
  });

  it("성공하면 약속·참여자·세션·판정 시각을 돌려준다", async () => {
    mockPromise();
    mockSession();
    expect(await authenticatePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID)).toEqual({
      kind: "ok",
      promise: { id: PROMISE_ID, status: "draft", promiseLinkId: "l-1" },
      participant: { id: "pt-1", role: "host" },
      session: { id: "s-1", token: TOKEN, expiresAt: new Date(NOW.getTime() + 60_000) },
      now: NOW,
    });
  });

  it("대문자 promiseId 경로여도 쿠키 이름은 DB의 소문자 id", async () => {
    mockPromise();
    mockSession();
    const result = await authenticatePromiseSession(
      request(`${COOKIE}=${TOKEN}`),
      PROMISE_ID.toUpperCase(),
    );
    expect(result.kind).toBe("ok");
  });
});

describe("findActivePromiseSession (선택적 확인 모드)", () => {
  beforeEach(() => {
    for (const fn of [promiseFindUnique, sessionFindUnique, queryRaw]) fn.mockReset();
  });

  it("유효 세션 + active 참여자 → 참여자 id", async () => {
    mockSession();
    expect(await findActivePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID, NOW)).toEqual({
      participantId: "pt-1",
    });
  });

  it("쿠키 없음 → null, 세션 조회 없음", async () => {
    expect(await findActivePromiseSession(request(), PROMISE_ID, NOW)).toBeNull();
    expect(sessionFindUnique).not.toHaveBeenCalled();
  });

  it("위조 쿠키 → null", async () => {
    sessionFindUnique.mockResolvedValueOnce(null);
    expect(await findActivePromiseSession(request(`${COOKIE}=forged`), PROMISE_ID, NOW)).toBeNull();
  });

  it("만료 세션(expires_at = DB 시각) → null", async () => {
    mockSession({ expiresAt: NOW });
    expect(
      await findActivePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID, NOW),
    ).toBeNull();
  });

  it("cancelled 참여자의 세션 → null", async () => {
    mockSession({ status: "cancelled" });
    expect(
      await findActivePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID, NOW),
    ).toBeNull();
  });

  it("다른 약속의 세션 → null", async () => {
    mockSession({ promiseId: OTHER_PROMISE_ID });
    expect(
      await findActivePromiseSession(request(`${COOKIE}=${TOKEN}`), PROMISE_ID, NOW),
    ).toBeNull();
  });
});

describe("withSessionCookie", () => {
  const auth: PromiseSession = {
    promise: { id: PROMISE_ID, status: "draft", promiseLinkId: "l-1" },
    participant: { id: "pt-1", role: "host" },
    session: { id: "s-1", token: TOKEN, expiresAt: new Date(NOW.getTime() + 3_600_999) },
    now: NOW,
  };

  it("기본값은 인증 시점 expires_at까지 남은 초(내림)", () => {
    const res = withSessionCookie(new Response(null), auth);
    expect(res.headers.get("set-cookie")).toBe(
      `${COOKIE}=${TOKEN}; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}; Max-Age=3600`,
    );
  });

  it("같은 요청에서 바뀐 expires_at을 넘기면 그 값으로 계산한다", () => {
    const expiresAt = new Date(NOW.getTime() + 7 * 24 * 3600 * 1000);
    const res = withSessionCookie(new Response(null), auth, { expiresAt, now: NOW });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=604800");
  });

  it("세션이 지워졌으면(null) 빈 값과 Max-Age=0으로 쿠키를 지운다", () => {
    const res = withSessionCookie(new Response(null), auth, { expiresAt: null, now: NOW });
    expect(res.headers.get("set-cookie")).toBe(
      `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}; Max-Age=0`,
    );
  });
});
