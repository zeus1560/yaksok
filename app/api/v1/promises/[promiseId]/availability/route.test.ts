import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const getAvailabilityStatus = vi.hoisted(() => vi.fn());
vi.mock("@/lib/time/availability-status", () => ({ getAvailabilityStatus }));

import { GET } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-10T12:00:00.400+09:00");
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-me", role: "member" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(NOW.getTime() + 3600_000) },
  now: NOW,
};
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;
const AUTH_COOKIE = `${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3600`;
const CLEAR_COOKIE = `${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`;
const keep = { session: { expiresAt: AUTH.session.expiresAt, now: NOW } };

const at = (iso: string) => new Date(iso);
function okResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    status: "collecting",
    serverTime: at("2026-11-10T12:00:02.311+09:00"),
    settings: {
      dateRangeStart: "2026-11-10",
      dateRangeEnd: "2026-11-12",
      dailyStartMinute: 540,
      dailyEndMinute: 1440,
      durationMinutes: 120,
      votingDeadlineAt: at("2026-11-11T18:00:00+09:00"),
    },
    participants: [
      {
        participantId: "pt-host",
        nickname: "방장",
        isHost: true,
        // DB 값은 밀리초 .000을 갖고 있어도 응답은 초 단위다
        availableSlots: [at("2026-11-10T14:00:00.000+09:00"), at("2026-11-10T23:30:00+09:00")],
      },
      { participantId: "pt-none", nickname: "미제출", isHost: false, availableSlots: [] },
      { participantId: "pt-me", nickname: "나", isHost: false, availableSlots: [] },
    ],
    me: {
      participantId: "pt-me",
      version: 4,
      submitted: false,
      slots: [at("2026-11-10T11:00:00+09:00"), at("2026-11-10T14:00:00+09:00")],
    },
    session: { expiresAt: AUTH.session.expiresAt, now: new Date(NOW.getTime() + 2000) },
    ...overrides,
  };
}

function call(promiseId = PROMISE_ID, headers: Record<string, string> = {}) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/availability`, {
    method: "GET",
    headers,
  });
  return GET(request, { params: Promise.resolve({ promiseId }) });
}

describe("GET /api/v1/promises/[promiseId]/availability (TIME-API-02)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    getAvailabilityStatus.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200: 명세 본문(serverTime 밀리초, 마감·슬롯 초 단위 +09:00, 24:00, 등록순), 쿠키 갱신, no-store", async () => {
    getAvailabilityStatus.mockResolvedValueOnce(okResult());

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "collecting",
      serverTime: "2026-11-10T12:00:02.311+09:00",
      settings: {
        dateRangeStart: "2026-11-10",
        dateRangeEnd: "2026-11-12",
        dailyStartTime: "09:00",
        dailyEndTime: "24:00",
        durationMinutes: 120,
        votingDeadlineAt: "2026-11-11T18:00:00+09:00",
      },
      totalParticipants: 3,
      participants: [
        {
          participantId: "pt-host",
          nickname: "방장",
          isHost: true,
          availableSlots: ["2026-11-10T14:00:00+09:00", "2026-11-10T23:30:00+09:00"],
        },
        { participantId: "pt-none", nickname: "미제출", isHost: false, availableSlots: [] },
        { participantId: "pt-me", nickname: "나", isHost: false, availableSlots: [] },
      ],
      me: {
        participantId: "pt-me",
        version: 4,
        submitted: false,
        slots: ["2026-11-10T11:00:00+09:00", "2026-11-10T14:00:00+09:00"],
      },
    });
    expect(getAvailabilityStatus).toHaveBeenCalledWith(AUTH);
    // Max-Age는 판정 시각 기준 남은 초
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("마감 경과로 계산된 closed를 그대로 내보낸다", async () => {
    getAvailabilityStatus.mockResolvedValueOnce(okResult({ status: "closed" }));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("closed");
  });

  it("Origin 없음·다른 Origin이어도 검사하지 않는다 (GET)", async () => {
    getAvailabilityStatus.mockResolvedValue(okResult());
    expect((await call()).status).toBe(200);
    expect((await call(PROMISE_ID, { origin: "https://evil.example" })).status).toBe(200);
  });

  describe("세션 인증 실패 — 쿠키 없음, no-store", () => {
    it.each([
      ["invalid_request", 400, "INVALID_REQUEST"],
      ["not_found", 404, "PROMISE_NOT_FOUND"],
      ["cancelled", 409, "PROMISE_CANCELLED"],
      ["unauthenticated", 401, "UNAUTHENTICATED"],
      ["forbidden", 403, "FORBIDDEN"],
    ])("%s → %i %s", async (kind, status, code) => {
      authenticatePromiseSession.mockResolvedValueOnce({ kind });
      const res = await call();
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(code);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(getAvailabilityStatus).not.toHaveBeenCalled();
    });

    it("promiseId 형식 오류 → 실제 인증 모듈이 400", async () => {
      const actual = await vi.importActual<typeof import("@/lib/member/session-auth")>(
        "@/lib/member/session-auth",
      );
      authenticatePromiseSession.mockImplementationOnce(actual.authenticatePromiseSession);
      const res = await call("not-a-uuid");
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_REQUEST");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("트랜잭션 판정 실패 — 쿠키 갱신, no-store", () => {
    it.each([
      ["cancelled", 409, "PROMISE_CANCELLED"],
      ["draft_expired", 410, "DRAFT_EXPIRED"],
      ["not_open", 409, "PROMISE_NOT_OPEN"],
      ["unauthenticated", 401, "UNAUTHENTICATED"],
    ])("%s → %i %s", async (kind, status, code) => {
      getAvailabilityStatus.mockResolvedValueOnce({ kind, ...keep });
      const res = await call();
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(code);
      expect(res.headers.get("set-cookie")).toBe(AUTH_COOKIE);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("약속 행이 사라짐 → 404, 쿠키 삭제", async () => {
      getAvailabilityStatus.mockResolvedValueOnce({
        kind: "not_found",
        session: { expiresAt: null, now: NOW },
      });
      const res = await call();
      expect(res.status).toBe(404);
      expect(res.headers.get("set-cookie")).toBe(CLEAR_COOKIE);
    });

    it("세션이 만료됨(탈퇴) → 401, 쿠키 삭제", async () => {
      getAvailabilityStatus.mockResolvedValueOnce({
        kind: "unauthenticated",
        session: { expiresAt: NOW, now: NOW },
      });
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBe(CLEAR_COOKIE);
    });
  });

  it("DB 오류 → 500 INTERNAL_ERROR, 원문·토큰을 응답·로그에 남기지 않음, no-store", async () => {
    getAvailabilityStatus.mockRejectedValueOnce(
      Object.assign(new Error("postgres://user:secret@host/db tok"), { code: "P1001" }),
    );

    const res = await call(PROMISE_ID, { cookie: `${COOKIE_PREFIX}tok` });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("secret");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const logged = JSON.stringify(
      (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
    );
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("tok");
  });
});
