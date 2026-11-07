import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const cancelPromise = vi.hoisted(() => vi.fn());
vi.mock("@/lib/state/cancel-promise", () => ({ cancelPromise }));

import { POST } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-08T12:00:00.400+09:00");
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(NOW.getTime() + 3600_000) },
  now: NOW,
};
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;

function call(headers: Record<string, string> = { origin: BASE_URL }, body?: string) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${PROMISE_ID}/cancel`, {
    method: "POST",
    headers,
    body,
  });
  return POST(request, { params: Promise.resolve({ promiseId: PROMISE_ID }) });
}

function ok() {
  const cancelledAt = new Date(NOW.getTime() + 1500);
  return {
    kind: "ok",
    promiseStatus: "cancelled",
    cancelledAt,
    session: { expiresAt: cancelledAt, now: cancelledAt },
  };
}

describe("POST /api/v1/promises/[promiseId]/cancel (STATE-API-07)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    cancelPromise.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200 { promiseId, promiseStatus, cancelledAt(초 단위 +09:00), message }, 요청자 쿠키 Max-Age=0, no-store", async () => {
    cancelPromise.mockResolvedValueOnce(ok());

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      promiseId: PROMISE_ID,
      promiseStatus: "cancelled",
      cancelledAt: "2026-11-08T12:00:01+09:00",
      message: "취소된 약속입니다.",
    });
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(cancelPromise).toHaveBeenCalledWith(AUTH);
  });

  it("본문은 읽지 않는다 (명세상 본문 없음, 보내도 무시)", async () => {
    cancelPromise.mockResolvedValueOnce(ok());
    const res = await call({ origin: BASE_URL, "content-type": "application/json" }, "{not json");
    expect(res.status).toBe(200);
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 인증·저장 없음, no-store", async (_n, headers) => {
    const res = await call(headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
    expect(cancelPromise).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_request", 400, "INVALID_REQUEST"],
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
    ["forbidden", 403, "FORBIDDEN"],
  ])("인증 %s → %i %s, 쿠키 없음, 저장 없음", async (kind, status, code) => {
    authenticatePromiseSession.mockResolvedValueOnce({ kind });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(cancelPromise).not.toHaveBeenCalled();
  });

  it.each([
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["forbidden", 403, "FORBIDDEN"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
    ["draft_expired", 410, "DRAFT_EXPIRED"],
  ])("잠금 후 %s → %i %s, 쿠키는 잠금 후 다시 읽은 세션 기준으로 갱신", async (kind, status, code) => {
    cancelPromise.mockResolvedValueOnce({
      kind,
      session: { expiresAt: AUTH.session.expiresAt, now: new Date(NOW.getTime() + 2000) },
    });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
  });

  it.each([
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
  ])("%s(세션 행 없음) → %i %s, 쿠키를 Max-Age=0으로 지운다", async (kind, status, code) => {
    cancelPromise.mockResolvedValueOnce({ kind, session: { expiresAt: null, now: NOW } });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`);
  });

  it("처리 중 오류는 500이고 원문을 응답·로그에 남기지 않는다", async () => {
    cancelPromise.mockRejectedValueOnce(new Error("update failed host=secret-host"));
    const res = await call();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-host");
  });
});
