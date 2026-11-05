import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const getMyParticipation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/me", () => ({ getMyParticipation }));

import { GET } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-10T12:00:00.400+09:00");
const EXPIRES = new Date(NOW.getTime() + 3600_000);
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-me", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: EXPIRES },
  now: NOW,
};
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;
const CLEAR_COOKIE = `${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`;

const PERMISSIONS = {
  canEditAvailability: true,
  canSubmit: true,
  canManagePromise: true,
  canLeave: true,
};
function okResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    participantId: "pt-me",
    nickname: "방장",
    role: "host",
    status: "active",
    availabilitySubmittedAt: null,
    promiseStatus: "collecting",
    deadlinePassed: false,
    permissions: PERMISSIONS,
    sessionExpiresAt: EXPIRES,
    session: { expiresAt: EXPIRES, now: new Date(NOW.getTime() + 2000) },
    ...overrides,
  };
}

function call(promiseId = PROMISE_ID, headers: Record<string, string> = {}) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/me`, {
    method: "GET",
    headers,
  });
  return GET(request, { params: Promise.resolve({ promiseId }) });
}

describe("GET /api/v1/promises/[promiseId]/me (MEMBER-API-05)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    getMyParticipation.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200: 명세 본문(미제출 null, 세션 만료 초 단위 +09:00), 쿠키 갱신, no-store", async () => {
    getMyParticipation.mockResolvedValueOnce(okResult());

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      participantId: "pt-me",
      nickname: "방장",
      role: "host",
      status: "active",
      availabilitySubmittedAt: null,
      promiseStatus: "collecting",
      deadlinePassed: false,
      permissions: PERMISSIONS,
      sessionExpiresAt: "2026-11-10T13:00:00+09:00",
    });
    // 취소된 약속도 세션을 확인하도록 allowCancelled로 인증한다
    expect(authenticatePromiseSession).toHaveBeenCalledWith(expect.any(Request), PROMISE_ID, {
      allowCancelled: true,
    });
    expect(getMyParticipation).toHaveBeenCalledWith(AUTH);
    // Max-Age는 응답 시점의 판정 시각 기준 남은 초
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("제출 시각은 밀리초 3자리 +09:00", async () => {
    getMyParticipation.mockResolvedValueOnce(
      okResult({ availabilitySubmittedAt: new Date("2026-11-10T03:35:10.027Z") }),
    );
    const res = await call();
    expect((await res.json()).availabilitySubmittedAt).toBe("2026-11-10T12:35:10.027+09:00");
  });

  it("취소된 약속도 200으로 promiseStatus=cancelled를 내보낸다", async () => {
    getMyParticipation.mockResolvedValueOnce(
      okResult({
        promiseStatus: "cancelled",
        permissions: {
          canEditAvailability: false,
          canSubmit: false,
          canManagePromise: false,
          canLeave: false,
        },
      }),
    );
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).promiseStatus).toBe("cancelled");
  });

  it("Origin 없음·다른 Origin이어도 검사하지 않는다 (GET)", async () => {
    getMyParticipation.mockResolvedValue(okResult());
    expect((await call()).status).toBe(200);
    expect((await call(PROMISE_ID, { origin: "https://evil.example" })).status).toBe(200);
  });

  describe("세션 인증 실패 — 쿠키 없음, no-store", () => {
    it.each([
      ["invalid_request", 400, "INVALID_REQUEST"],
      ["not_found", 404, "PROMISE_NOT_FOUND"],
      ["unauthenticated", 401, "UNAUTHENTICATED"],
      ["forbidden", 403, "FORBIDDEN"],
    ])("%s → %i %s", async (kind, status, code) => {
      authenticatePromiseSession.mockResolvedValueOnce({ kind });
      const res = await call();
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(code);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(getMyParticipation).not.toHaveBeenCalled();
    });

    it("promiseId 형식 오류 → 실제 인증 모듈이 400", async () => {
      const actual = await vi.importActual<typeof import("@/lib/member/session-auth")>(
        "@/lib/member/session-auth",
      );
      authenticatePromiseSession.mockImplementationOnce(actual.authenticatePromiseSession);
      const res = await call("not-a-uuid");
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_REQUEST");
    });
  });

  describe("재조회 판정 실패 → 401", () => {
    it("세션 행이 사라짐 → 쿠키 삭제", async () => {
      getMyParticipation.mockResolvedValueOnce({
        kind: "unauthenticated",
        session: { expiresAt: null, now: NOW },
      });
      const res = await call();
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("UNAUTHENTICATED");
      expect(res.headers.get("set-cookie")).toBe(CLEAR_COOKIE);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("세션이 만료됨(탈퇴·내보내기) → 쿠키 삭제", async () => {
      getMyParticipation.mockResolvedValueOnce({
        kind: "unauthenticated",
        session: { expiresAt: NOW, now: NOW },
      });
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBe(CLEAR_COOKIE);
    });
  });

  it("DB 오류 → 500 INTERNAL_ERROR, 원문·토큰을 응답·로그에 남기지 않음, no-store", async () => {
    getMyParticipation.mockRejectedValueOnce(
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
