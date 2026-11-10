import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const reopenPromise = vi.hoisted(() => vi.fn());
vi.mock("@/lib/state/reopen-promise", () => ({ reopenPromise }));

import { POST } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-08T12:00:00.400+09:00");
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "closed", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(NOW.getTime() + 3600_000) },
  now: NOW,
};
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;
const BODY = {
  votingDeadlineAt: "2026-11-09T18:00:00+09:00",
  dateRange: { startDate: "2026-11-10", endDate: "2026-11-13" },
};
const IMPACT = {
  hasAddedSelectableSlots: true,
  submissionsReset: true,
  removedSlotCount: 0,
  versionChangedParticipantCount: 3,
  confirmationCleared: true,
};

function call(
  body: unknown = BODY,
  headers: Record<string, string> = { origin: BASE_URL, "content-type": "application/json" },
  promiseId = PROMISE_ID,
) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/reopen`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ promiseId }) });
}

describe("POST /api/v1/promises/[promiseId]/reopen (STATE-API-06)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    reopenPromise.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200 { promiseId, promiseStatus: collecting, currentConfirmation: null, changeImpact }, 쿠키 갱신, no-store", async () => {
    const renewed = new Date(NOW.getTime() + 7200_000);
    reopenPromise.mockResolvedValueOnce({
      kind: "ok",
      changeImpact: IMPACT,
      session: { expiresAt: renewed, now: NOW },
    });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      promiseId: PROMISE_ID,
      promiseStatus: "collecting",
      currentConfirmation: null,
      changeImpact: IMPACT,
    });
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=7200`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(reopenPromise).toHaveBeenCalledWith(AUTH, {
      votingDeadlineAt: new Date(BODY.votingDeadlineAt),
      dateRange: BODY.dateRange,
    });
  });

  it.each([
    ["Origin 없음", { "content-type": "application/json" }],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 인증·저장 없음", async (_n, headers) => {
    const res = await call(BODY, headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it.each([
    ["promiseId 형식", BODY, "not-a-uuid"],
    ["JSON 아님", "{not json", PROMISE_ID],
    ["마감 없음", { participantLimit: 5 }, PROMISE_ID],
    ["오프셋 없는 마감", { votingDeadlineAt: "2026-11-09T18:00:00" }, PROMISE_ID],
    ["부분 dateRange", { ...BODY, dateRange: { startDate: "2026-11-10" } }, PROMISE_ID],
  ])("%s → 400, 인증보다 먼저(쿠키 없음)", async (_n, body, promiseId) => {
    const res = await call(body, undefined, promiseId);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it.each([
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
    expect(reopenPromise).not.toHaveBeenCalled();
  });

  const reread = { expiresAt: AUTH.session.expiresAt, now: new Date(NOW.getTime() + 2000) };

  it.each([
    [{ kind: "cancelled" }, 409, "PROMISE_CANCELLED"],
    [{ kind: "forbidden" }, 403, "FORBIDDEN"],
    [{ kind: "unauthenticated" }, 401, "UNAUTHENTICATED"],
  ])("잠금 후 %o → %i %s, 쿠키 갱신", async (result, status, code) => {
    reopenPromise.mockResolvedValueOnce({ ...result, session: reread });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
  });

  it("허용되지 않은 상태 → 409 INVALID_PROMISE_STATE, allowedStates closed·confirmed", async () => {
    reopenPromise.mockResolvedValueOnce({
      kind: "invalid_state",
      promiseStatus: "collecting",
      session: reread,
    });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "INVALID_PROMISE_STATE",
      message: expect.any(String),
      details: { promiseStatus: "collecting", allowedStates: ["closed", "confirmed"] },
    });
  });

  it("정원 < active 인원 → 422 CAPACITY_BELOW_ACTIVE_COUNT", async () => {
    reopenPromise.mockResolvedValueOnce({
      kind: "validation_failed",
      violation: { field: "participantLimit", message: "x", code: "CAPACITY_BELOW_ACTIVE_COUNT" },
      session: reread,
    });
    const res = await call();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      code: "CAPACITY_BELOW_ACTIVE_COUNT",
      message: "정원은 현재 참여 인원보다 적을 수 없습니다.",
      details: { field: "participantLimit" },
    });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=3598");
  });

  it("그 밖의 규칙 위반 → 422 VALIDATION_FAILED { field }", async () => {
    reopenPromise.mockResolvedValueOnce({
      kind: "validation_failed",
      violation: { field: "votingDeadlineAt", message: "응답 마감은 현재보다 이후여야 합니다." },
      session: reread,
    });
    const res = await call();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      code: "VALIDATION_FAILED",
      message: "응답 마감은 현재보다 이후여야 합니다.",
      details: { field: "votingDeadlineAt" },
    });
  });

  it.each([
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
  ])("%s(세션 행 없음) → %i %s, 쿠키 Max-Age=0", async (kind, status, code) => {
    reopenPromise.mockResolvedValueOnce({ kind, session: { expiresAt: null, now: NOW } });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`);
  });

  it("처리 중 오류는 500이고 원문을 응답·로그에 남기지 않는다", async () => {
    reopenPromise.mockRejectedValueOnce(new Error("update failed host=secret-host"));
    const res = await call();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-host");
  });
});
