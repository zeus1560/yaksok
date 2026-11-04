import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const submitAvailability = vi.hoisted(() => vi.fn());
vi.mock("@/lib/time/submit-availability", () => ({ submitAvailability }));

import { PUT } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-10T12:00:00.400+09:00");
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "member" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(NOW.getTime() + 3600_000) },
  now: NOW,
};
const SLOT = "2026-11-10T14:00:00+09:00";
const BODY = { baseVersion: 0, slots: [SLOT] };
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;
const AUTH_COOKIE = `${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3600`;
const keep = { session: { expiresAt: AUTH.session.expiresAt, now: NOW } };

function call(
  body: unknown,
  headers: Record<string, string> = { origin: BASE_URL },
  init: RequestInit = {},
) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${PROMISE_ID}/me/availability`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
  return PUT(request, { params: Promise.resolve({ promiseId: PROMISE_ID }) });
}

describe("PUT /api/v1/promises/[promiseId]/me/availability (TIME-API-01)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    submitAvailability.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200: 명세 본문(submittedAt 밀리초 3자리, slots +09:00), 쿠키 갱신, no-store", async () => {
    submitAvailability.mockResolvedValueOnce({
      kind: "ok",
      version: 4,
      submittedAt: new Date("2026-11-10T12:00:00.027+09:00"),
      slots: [new Date("2026-11-10T11:00:00+09:00"), new Date(SLOT)],
      droppedSlotCount: 1,
      session: { expiresAt: AUTH.session.expiresAt, now: new Date(NOW.getTime() + 2000) },
    });

    const res = await call({ baseVersion: 3, slots: [SLOT, `${SLOT.slice(0, 19)}.000+09:00`] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 4,
      submitted: true,
      submittedAt: "2026-11-10T12:00:00.027+09:00",
      slots: ["2026-11-10T11:00:00+09:00", SLOT],
      droppedSlotCount: 1,
    });
    // 같은 시각은 합쳐서 넘긴다
    expect(submitAvailability).toHaveBeenCalledWith(AUTH, {
      baseVersion: 3,
      slots: [Date.parse(SLOT)],
    });
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 인증 없음, no-store", async (_, headers) => {
    const res = await call(BODY, headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it("Content-Length가 256KB를 넘으면 본문을 읽기 전에 413", async () => {
    const res = await call(BODY, { origin: BASE_URL, "content-length": String(256 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("PAYLOAD_TOO_LARGE");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it("Content-Length 없이 실제로 읽은 크기가 256KB를 넘어도 413", async () => {
    const big = new TextEncoder().encode(`{"baseVersion":0,"slots":["${"x".repeat(256 * 1024)}"]}`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < big.length; i += 16 * 1024)
          controller.enqueue(big.slice(i, i + 16 * 1024));
        controller.close();
      },
    });
    const res = await call(stream as unknown as string, { origin: BASE_URL }, {
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it("256KB 이하는 통과한다", async () => {
    submitAvailability.mockResolvedValueOnce({
      kind: "ok",
      version: 1,
      submittedAt: NOW,
      slots: [],
      droppedSlotCount: 0,
      ...keep,
    });
    const slots = Array(5000).fill(`${SLOT.slice(0, 19)}.000+09:00`);
    const text = JSON.stringify({ baseVersion: 0, slots });
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(256 * 1024);
    expect((await call(text)).status).toBe(200);
  });

  it.each([
    ["invalid_request", 400, "INVALID_REQUEST"],
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
    ["forbidden", 403, "FORBIDDEN"],
  ])("세션 인증 %s → %i %s, 쿠키 없음", async (kind, status, code) => {
    authenticatePromiseSession.mockResolvedValueOnce({ kind });
    const res = await call(BODY);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["깨진 JSON", "{"],
    ["배열 본문", "[]"],
    ["null 본문", "null"],
    ["빈 본문", ""],
    ["baseVersion 누락", { slots: [] }],
    ["slots 누락", { baseVersion: 0 }],
    ["baseVersion 음수", { baseVersion: -1, slots: [] }],
    ["baseVersion 소수", { baseVersion: 1.5, slots: [] }],
    ["baseVersion 문자열", { baseVersion: "1", slots: [] }],
    ["slots 문자열", { baseVersion: 0, slots: SLOT }],
    ["slots에 숫자", { baseVersion: 0, slots: [SLOT, 1] }],
  ])("%s → 400 INVALID_REQUEST, 쿠키 갱신", async (_, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(res.headers.get("set-cookie")).toBe(AUTH_COOKIE);
    expect(submitAvailability).not.toHaveBeenCalled();
  });

  it("5,001개 → 422 SLOT_LIMIT_EXCEEDED, 쿠키 갱신", async () => {
    const res = await call({ baseVersion: 0, slots: Array(5001).fill(SLOT) });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("SLOT_LIMIT_EXCEEDED");
    expect(res.headers.get("set-cookie")).toBe(AUTH_COOKIE);
    expect(submitAvailability).not.toHaveBeenCalled();
  });

  it("형식 오류 → 422 INVALID_SLOT_FORMAT, 쿠키 갱신", async () => {
    const res = await call({ baseVersion: 0, slots: [SLOT, "2026-11-10T14:15:00+09:00"] });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("INVALID_SLOT_FORMAT");
    expect(res.headers.get("set-cookie")).toBe(AUTH_COOKIE);
    expect(submitAvailability).not.toHaveBeenCalled();
  });

  it("409 AVAILABILITY_VERSION_CONFLICT: details의 slots도 200과 같은 초 단위 표기", async () => {
    submitAvailability.mockResolvedValueOnce({
      kind: "version_conflict",
      currentVersion: 5,
      submitted: true,
      slots: [new Date(SLOT)],
      ...keep,
    });
    const res = await call(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "AVAILABILITY_VERSION_CONFLICT",
      message: "다른 기기에서 먼저 저장했어요. 최신 내용을 확인해 주세요.",
      details: { currentVersion: 5, submitted: true, slots: ["2026-11-10T14:00:00+09:00"] },
    });
    expect(res.headers.get("set-cookie")).toBe(AUTH_COOKIE);
  });

  it.each([
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["draft_expired", 410, "DRAFT_EXPIRED"],
    ["not_open", 409, "PROMISE_NOT_OPEN"],
    ["voting_closed", 409, "VOTING_CLOSED"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
  ])("서비스 %s → %i %s, 쿠키 갱신", async (kind, status, code) => {
    submitAvailability.mockResolvedValueOnce({ kind, ...keep });
    const res = await call(BODY);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(AUTH_COOKIE);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("세션 행이 지워졌거나 만료됐으면 쿠키를 Max-Age=0으로 지운다", async () => {
    submitAvailability.mockResolvedValueOnce({
      kind: "unauthenticated",
      session: { expiresAt: NOW, now: NOW },
    });
    const res = await call(BODY);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`);
  });

  it("처리 중 오류는 500이고 원문·토큰을 로그에 남기지 않는다", async () => {
    submitAvailability.mockRejectedValueOnce(new Error("postgres://secret tok"));
    const res = await call(BODY, { origin: BASE_URL, cookie: `${COOKIE_PREFIX}tok` });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("INTERNAL_ERROR");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const logged = JSON.stringify(
      (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
    );
    expect(logged).not.toMatch(/secret|tok/);
  });
});
