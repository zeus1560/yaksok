import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const confirmSchedule = vi.hoisted(() => vi.fn());
vi.mock("@/lib/state/confirm-schedule", () => ({ confirmSchedule }));

import { POST } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-07T12:00:00.400+09:00");
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "closed", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(NOW.getTime() + 3600_000) },
  now: NOW,
};
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;
const START = new Date("2026-11-10T14:00:00+09:00");
const END = new Date("2026-11-10T15:00:00+09:00");
const LATER = new Date(NOW.getTime() + 2000);

function call(
  body: unknown = { startAt: "2026-11-10T14:00:00+09:00" },
  headers: Record<string, string> = { origin: BASE_URL, "content-type": "application/json" },
  promiseId = PROMISE_ID,
) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/confirmation`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ promiseId }) });
}

describe("POST /api/v1/promises/[promiseId]/confirmation (STATE-API-05)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    confirmSchedule.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("확정 → 200 { promiseId, promiseStatus, currentConfirmation }, 초 단위 +09:00, 갱신된 세션 기준 쿠키, no-store", async () => {
    const refreshed = new Date(START.getTime() + 7 * 24 * 3600_000);
    confirmSchedule.mockResolvedValueOnce({
      kind: "ok",
      startAt: START,
      endAt: END,
      session: { expiresAt: refreshed, now: LATER },
    });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      promiseId: PROMISE_ID,
      promiseStatus: "confirmed",
      currentConfirmation: {
        startAt: "2026-11-10T14:00:00+09:00",
        endAt: "2026-11-10T15:00:00+09:00",
      },
    });
    const maxAge = Math.floor((refreshed.getTime() - LATER.getTime()) / 1000);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=${maxAge}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(confirmSchedule).toHaveBeenCalledWith(AUTH, START);
  });

  it.each([
    ["+09:00", "2026-11-10T14:00:00+09:00"],
    ["Z", "2026-11-10T05:00:00Z"],
    ["Z 밀리초", "2026-11-10T05:00:00.000Z"],
    ["-05:00", "2026-11-10T00:00:00-05:00"],
    ["초 생략", "2026-11-10T14:00+09:00"],
  ])("startAt %s 표기도 같은 절대 시각으로 넘긴다", async (_n, startAt) => {
    confirmSchedule.mockResolvedValueOnce({
      kind: "ok",
      startAt: START,
      endAt: END,
      session: { expiresAt: AUTH.session.expiresAt, now: NOW },
    });
    const res = await call({ startAt });
    expect(res.status).toBe(200);
    expect(confirmSchedule.mock.calls[0][1]).toEqual(START);
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 인증·저장 없음", async (_n, headers) => {
    const res = await call(undefined, headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it.each([
    ["promiseId 형식 오류", { startAt: "2026-11-10T14:00:00+09:00" }, "not-a-uuid"],
    ["JSON 아님", "{not json", PROMISE_ID],
    ["배열", [], PROMISE_ID],
    ["null", "null", PROMISE_ID],
    ["startAt 없음", {}, PROMISE_ID],
    ["startAt 숫자", { startAt: 1762750800000 }, PROMISE_ID],
    ["startAt null", { startAt: null }, PROMISE_ID],
  ])("%s → 400 INVALID_REQUEST, 인증 전, 쿠키 없음", async (_n, body, promiseId) => {
    const res = await call(body, undefined, promiseId);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it.each([
    "2026-11-10T14:00:00", // 오프셋 없음
    "2026-11-10 14:00:00+09:00",
    "2026-11-10t14:00:00z",
    "2026-02-30T14:00:00+09:00",
    "2026-11-10T24:00:00+09:00",
    "2026-11-10T14:60:00+09:00",
    "2026-11-10T14:00:00+0900",
    "2026-11-10T14:00:00+15:00",
    "2026-11-10T14:00:00.0000+09:00",
    "",
    "내일 오후 2시",
  ])("startAt %j → 422 VALIDATION_FAILED(field startAt), 인증 전", async (startAt) => {
    const res = await call({ startAt });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      code: "VALIDATION_FAILED",
      message: "확정 시작 시각을 확인해 주세요.",
      details: { field: "startAt" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
    ["forbidden", 403, "FORBIDDEN"],
  ])("인증 %s → %i %s, 쿠키 없음, 확정 시도 없음", async (kind, status, code) => {
    authenticatePromiseSession.mockResolvedValueOnce({ kind });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(confirmSchedule).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "cancelled" }, 409, "PROMISE_CANCELLED"],
    [{ kind: "forbidden" }, 403, "FORBIDDEN"],
    [{ kind: "unauthenticated" }, 401, "UNAUTHENTICATED"],
    [{ kind: "invalid_candidate", reason: "not_future" }, 422, "INVALID_CONFIRMATION_CANDIDATE"],
  ])("잠금 후 %o → %i %s, 쿠키는 잠금 후 시각 기준으로 갱신", async (result, status, code) => {
    confirmSchedule.mockResolvedValueOnce({
      ...result,
      session: { expiresAt: AUTH.session.expiresAt, now: LATER },
    });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
  });

  it("422 INVALID_CONFIRMATION_CANDIDATE는 이유를 응답에 넣지 않는다", async () => {
    confirmSchedule.mockResolvedValueOnce({
      kind: "invalid_candidate",
      reason: "too_few_participants",
      session: { expiresAt: AUTH.session.expiresAt, now: NOW },
    });
    expect(await (await call()).json()).toEqual({
      code: "INVALID_CONFIRMATION_CANDIDATE",
      message: "후보가 변경되었거나 유효하지 않습니다. 최신 후보를 확인해 주세요.",
    });
  });

  it.each(["collecting", "confirmed", "draft"])("%s 409는 현재 상태와 허용 상태 [closed]를 details로 알린다", async (status) => {
    confirmSchedule.mockResolvedValueOnce({
      kind: "invalid_state",
      promiseStatus: status,
      session: { expiresAt: AUTH.session.expiresAt, now: NOW },
    });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "INVALID_PROMISE_STATE",
      message: "현재 약속 상태에서는 요청할 수 없습니다.",
      details: { promiseStatus: status, allowedStates: ["closed"] },
    });
  });

  it.each([
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
  ])("%s(세션 행 없음) → %i %s, 쿠키를 Max-Age=0으로 지운다", async (kind, status, code) => {
    confirmSchedule.mockResolvedValueOnce({ kind, session: { expiresAt: null, now: NOW } });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`);
  });

  it("처리 중 오류는 500이고 원문을 응답·로그에 남기지 않는다", async () => {
    confirmSchedule.mockRejectedValueOnce(new Error("update failed host=secret-host"));
    const res = await call();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-host");
  });
});
