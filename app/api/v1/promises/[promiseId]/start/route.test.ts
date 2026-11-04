import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const startCollecting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/state/start-collecting", () => ({ startCollecting }));

import { parseStartSettings } from "@/lib/state/start-settings";
import { POST } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-04T12:00:00.400+09:00");
const DAY = 24 * 60 * 60 * 1000;
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "draft", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(NOW.getTime() + 3600_000) },
  now: NOW,
};
const BODY = {
  participantLimit: 8,
  dateRange: { startDate: "2026-11-10", endDate: "2026-11-20" },
  dailyTimeRange: { startTime: "09:00", endTime: "24:00" },
  durationMinutes: 60,
  votingDeadlineAt: "2026-11-09T18:00:00.250+09:00",
};
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;

function call(body: unknown, headers: Record<string, string> = { origin: BASE_URL }) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${PROMISE_ID}/start`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ promiseId: PROMISE_ID }) });
}

describe("POST /api/v1/promises/[promiseId]/start (STATE-API-02)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    startCollecting.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200: 명세 본문, 24:00 표기, 마감 +09:00, 쿠키 Max-Age = 마감 + 7일까지 남은 초", async () => {
    const input = parseStartSettings(BODY)!;
    const sessionExpiresAt = new Date(input.votingDeadlineAt.getTime() + 7 * DAY);
    startCollecting.mockResolvedValueOnce({
      kind: "ok",
      settings: input,
      session: { expiresAt: sessionExpiresAt, now: NOW },
    });

    const res = await call(BODY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      promiseId: PROMISE_ID,
      promiseStatus: "collecting",
      settings: {
        participantLimit: 8,
        dateRange: { startDate: "2026-11-10", endDate: "2026-11-20" },
        dailyTimeRange: { startTime: "09:00", endTime: "24:00" },
        durationMinutes: 60,
        votingDeadlineAt: "2026-11-09T18:00:00+09:00",
      },
    });
    const maxAge = Math.floor((sessionExpiresAt.getTime() - NOW.getTime()) / 1000);
    expect(res.headers.get("set-cookie")).toBe(
      `${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=${maxAge}`,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(startCollecting).toHaveBeenCalledWith(AUTH, input);
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 인증·저장 없음, no-store", async (_name, headers) => {
    const res = await call(BODY, headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_request", 400, "INVALID_REQUEST"],
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
    ["forbidden", 403, "FORBIDDEN"],
  ])("인증 %s → %i %s, 쿠키 없음, 저장 없음", async (kind, status, code) => {
    authenticatePromiseSession.mockResolvedValueOnce({ kind });
    const res = await call(BODY);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(startCollecting).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON 파싱 실패", "{participantLimit:"],
    ["오프셋 없는 마감", { ...BODY, votingDeadlineAt: "2026-11-09T18:00:00" }],
    ["필드 누락", { ...BODY, durationMinutes: undefined }],
  ])("%s → 400, 인증 성공했으므로 쿠키 갱신(인증 시점 기준)", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3600`);
    expect(startCollecting).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "cancelled" }, 409, "PROMISE_CANCELLED"],
    [{ kind: "forbidden" }, 403, "FORBIDDEN"],
    [{ kind: "invalid_state", promiseStatus: "collecting" }, 409, "INVALID_PROMISE_STATE"],
    [
      { kind: "validation_failed", violation: { field: "dateRange", message: "m" } },
      422,
      "VALIDATION_FAILED",
    ],
  ])("잠금 후 %o → %i %s, 쿠키는 잠금 후 시각 기준으로 갱신", async (result, status, code) => {
    const lockNow = new Date(NOW.getTime() + 2000);
    startCollecting.mockResolvedValueOnce({
      ...result,
      session: { expiresAt: AUTH.session.expiresAt, now: lockNow },
    });
    const res = await call(BODY);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
  });

  it("재요청 409는 현재 상태와 허용 상태를 details로 알린다", async () => {
    startCollecting.mockResolvedValueOnce({
      kind: "invalid_state",
      promiseStatus: "collecting",
      session: { expiresAt: AUTH.session.expiresAt, now: NOW },
    });
    const json = await (await call(BODY)).json();
    expect(json.details).toEqual({ promiseStatus: "collecting", allowedStates: ["draft"] });
  });

  it("422는 위반 필드를 details.field로 알린다", async () => {
    startCollecting.mockResolvedValueOnce({
      kind: "validation_failed",
      violation: { field: "votingDeadlineAt", message: "응답 마감은 현재보다 이후여야 합니다." },
      session: { expiresAt: AUTH.session.expiresAt, now: NOW },
    });
    const json = await (await call(BODY)).json();
    expect(json).toEqual({
      code: "VALIDATION_FAILED",
      message: "응답 마감은 현재보다 이후여야 합니다.",
      details: { field: "votingDeadlineAt" },
    });
  });

  it.each([
    ["draft_expired", 410, "DRAFT_EXPIRED"],
    ["not_found", 404, "PROMISE_NOT_FOUND"],
  ])("%s(세션 행 삭제됨) → %i %s, 쿠키를 Max-Age=0으로 지운다", async (kind, status, code) => {
    startCollecting.mockResolvedValueOnce({ kind, session: { expiresAt: null, now: NOW } });
    const res = await call(BODY);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`);
  });

  it("처리 중 오류는 500이고 원문을 응답·로그에 남기지 않는다", async () => {
    startCollecting.mockRejectedValueOnce(new Error("update failed host=secret-host"));
    const res = await call(BODY);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-host");
  });
});
