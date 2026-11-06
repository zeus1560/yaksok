import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const getPromiseDetail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/state/promise-detail", () => ({ getPromiseDetail }));

import { GET } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-10T12:00:00.400+09:00");
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "confirmed", promiseLinkId: "l-1" },
  participant: { id: "pt-me", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(NOW.getTime() + 3600_000) },
  now: NOW,
};
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;
const AUTH_COOKIE = `${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3600`;
const CLEAR_COOKIE = `${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`;
const keep = { session: { expiresAt: AUTH.session.expiresAt, now: NOW } };
const at = (iso: string) => new Date(iso);

function okResult(overrides: Record<string, unknown> = {}, promise: Record<string, unknown> = {}) {
  return {
    kind: "ok",
    now: at("2026-11-10T12:00:02.311+09:00"),
    promise: {
      id: PROMISE_ID,
      status: "confirmed",
      createdAt: at("2026-11-01T09:00:00+09:00"),
      participantLimit: 8,
      dateRangeStart: "2026-11-20",
      dateRangeEnd: "2026-11-30",
      dailyStartMinute: 540,
      dailyEndMinute: 1440,
      durationMinutes: 60,
      votingDeadlineAt: at("2026-11-09T18:00:00+09:00"),
      confirmedStartAt: at("2026-11-20T14:00:00+09:00"),
      ...promise,
    },
    requesterRole: "host",
    availableParticipantCount: 1,
    session: { expiresAt: AUTH.session.expiresAt, now: new Date(NOW.getTime() + 2000) },
    ...overrides,
  };
}

function call(promiseId = PROMISE_ID, headers: Record<string, string> = {}) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}`, {
    method: "GET",
    headers,
  });
  return GET(request, { params: Promise.resolve({ promiseId }) });
}

describe("GET /api/v1/promises/[promiseId] (STATE-API-01)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    getPromiseDetail.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200 confirmed 방장: 명세 본문(확정 예제 형태), 초 단위 +09:00, 24:00, 쿠키 갱신, no-store", async () => {
    getPromiseDetail.mockResolvedValueOnce(okResult());

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      promiseId: PROMISE_ID,
      promiseStatus: "confirmed",
      draftExpiresAt: null,
      draftExpired: false,
      settings: {
        participantLimit: 8,
        dateRange: { startDate: "2026-11-20", endDate: "2026-11-30" },
        dailyTimeRange: { startTime: "09:00", endTime: "24:00" },
        durationMinutes: 60,
        votingDeadlineAt: "2026-11-09T18:00:00+09:00",
      },
      currentConfirmation: {
        startAt: "2026-11-20T14:00:00+09:00",
        endAt: "2026-11-20T15:00:00+09:00",
        availableParticipantCount: 1,
        hostActionRequired: true,
      },
    });
    expect(getPromiseDetail).toHaveBeenCalledWith(AUTH);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("confirmed 일반 참여자는 1명이어도 hostActionRequired false", async () => {
    getPromiseDetail.mockResolvedValueOnce(okResult({ requesterRole: "member" }));
    const body = await (await call()).json();
    expect(body.currentConfirmation.hostActionRequired).toBe(false);
  });

  it("마감 지난 collecting: promiseStatus closed, 확정 null", async () => {
    getPromiseDetail.mockResolvedValueOnce(
      okResult(
        { availableParticipantCount: null },
        {
          status: "collecting",
          confirmedStartAt: null,
          votingDeadlineAt: at("2026-11-10T12:00:00+09:00"),
        },
      ),
    );
    const body = await (await call()).json();
    expect(body.promiseStatus).toBe("closed");
    expect(body.currentConfirmation).toBeNull();
  });

  it("draft 방장: draftExpiresAt·draftExpired 계산", async () => {
    getPromiseDetail.mockResolvedValueOnce(
      okResult(
        { availableParticipantCount: null },
        {
          status: "draft",
          createdAt: at("2026-11-10T11:50:01.900+09:00"),
          participantLimit: null,
          dateRangeStart: null,
          dateRangeEnd: null,
          dailyStartMinute: null,
          dailyEndMinute: null,
          durationMinutes: null,
          votingDeadlineAt: null,
          confirmedStartAt: null,
        },
      ),
    );
    const body = await (await call()).json();
    expect(body).toMatchObject({
      promiseStatus: "draft",
      draftExpiresAt: "2026-11-10T12:00:01+09:00",
      draftExpired: true,
      currentConfirmation: null,
    });
  });

  it("응답에 참여자 정보(닉네임·슬롯·제출 여부·ID)를 넣지 않는다", async () => {
    getPromiseDetail.mockResolvedValueOnce(okResult());
    const text = await (await call()).text();
    expect(text).not.toMatch(/nickname|participantId|slots|submitted|pt-me|role/i);
  });

  describe("인증 전 에러 (쿠키 갱신 없음)", () => {
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
      expect(getPromiseDetail).not.toHaveBeenCalled();
    });

    it("형식이 틀린 promiseId는 공통 인증 모듈이 400으로 판정한다", async () => {
      authenticatePromiseSession.mockResolvedValueOnce({ kind: "invalid_request" });
      const res = await call("not-a-uuid");
      expect(res.status).toBe(400);
      expect(authenticatePromiseSession.mock.calls[0][1]).toBe("not-a-uuid");
      // 취소 상태가 세션보다 먼저라 allowCancelled를 넘기지 않는다
      expect(authenticatePromiseSession.mock.calls[0][2]).toBeUndefined();
    });
  });

  describe("인증 뒤 트랜잭션 판정 (쿠키 갱신)", () => {
    it.each([
      ["not_found", 404, "PROMISE_NOT_FOUND", CLEAR_COOKIE, { expiresAt: null, now: NOW }],
      ["cancelled", 409, "PROMISE_CANCELLED", AUTH_COOKIE, keep.session],
      ["unauthenticated", 401, "UNAUTHENTICATED", CLEAR_COOKIE, { expiresAt: null, now: NOW }],
      ["forbidden", 403, "FORBIDDEN", AUTH_COOKIE, keep.session],
    ])("%s → %i %s", async (kind, status, code, cookie, session) => {
      getPromiseDetail.mockResolvedValueOnce({ kind, session });
      const res = await call();
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code });
      expect(res.headers.get("set-cookie")).toBe(cookie);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  it("예외 → 500 INTERNAL_ERROR, no-store, 원문 메시지를 로그에 남기지 않는다", async () => {
    getPromiseDetail.mockRejectedValueOnce(new Error("postgresql://secret@host/db"));
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("INTERNAL_ERROR");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });
});
