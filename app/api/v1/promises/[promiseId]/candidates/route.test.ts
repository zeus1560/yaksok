import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const getPromiseCandidates = vi.hoisted(() => vi.fn());
vi.mock("@/lib/state/promise-candidates", () => ({ getPromiseCandidates }));

import { GET } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-10T12:00:00.400+09:00");
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "closed", promiseLinkId: "l-1" },
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
// 정렬된 전체 후보 7개 (3명 2개 → 2명 5개)
const ALL = [
  ["2026-11-11T09:00:00.000+09:00", 3],
  ["2026-11-12T14:00:00+09:00", 3],
  ["2026-11-10T13:00:00+09:00", 2],
  ["2026-11-10T13:30:00+09:00", 2],
  ["2026-11-10T23:00:00+09:00", 2],
  ["2026-11-11T10:00:00+09:00", 2],
  ["2026-11-12T09:00:00+09:00", 2],
].map(([start, count]) => ({
  startAt: at(start as string),
  endAt: new Date(at(start as string).getTime() + 3600_000),
  availableParticipantCount: count,
}));

function okResult(candidates = ALL) {
  return {
    kind: "ok",
    calculatedAt: at("2026-11-10T12:00:02.311+09:00"),
    candidates,
    session: { expiresAt: AUTH.session.expiresAt, now: new Date(NOW.getTime() + 2000) },
  };
}

function call(query = "", promiseId = PROMISE_ID, headers: Record<string, string> = {}) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/candidates${query}`, {
    method: "GET",
    headers,
  });
  return GET(request, { params: Promise.resolve({ promiseId }) });
}

describe("GET /api/v1/promises/[promiseId]/candidates (STATE-API-10)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    getPromiseCandidates.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200 기본(limit 5·offset 0): 명세 본문, 초 단위 +09:00, 쿠키 갱신, no-store", async () => {
    getPromiseCandidates.mockResolvedValueOnce(okResult());

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      promiseId: PROMISE_ID,
      promiseStatus: "closed",
      calculatedAt: "2026-11-10T12:00:02+09:00",
      limit: 5,
      offset: 0,
      total: 7,
      hasMore: true,
      nextOffset: 5,
      candidates: [
        { startAt: "2026-11-11T09:00:00+09:00", endAt: "2026-11-11T10:00:00+09:00", availableParticipantCount: 3 },
        { startAt: "2026-11-12T14:00:00+09:00", endAt: "2026-11-12T15:00:00+09:00", availableParticipantCount: 3 },
        { startAt: "2026-11-10T13:00:00+09:00", endAt: "2026-11-10T14:00:00+09:00", availableParticipantCount: 2 },
        { startAt: "2026-11-10T13:30:00+09:00", endAt: "2026-11-10T14:30:00+09:00", availableParticipantCount: 2 },
        { startAt: "2026-11-10T23:00:00+09:00", endAt: "2026-11-11T00:00:00+09:00", availableParticipantCount: 2 },
      ],
    });
    expect(getPromiseCandidates).toHaveBeenCalledWith(AUTH);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("다음 페이지(offset 5): 남은 2개, hasMore=false·nextOffset=null", async () => {
    getPromiseCandidates.mockResolvedValueOnce(okResult());
    const body = await (await call("?limit=5&offset=5")).json();
    expect(body).toMatchObject({ limit: 5, offset: 5, total: 7, hasMore: false, nextOffset: null });
    expect(body.candidates.map((c: { startAt: string }) => c.startAt)).toEqual([
      "2026-11-11T10:00:00+09:00",
      "2026-11-12T09:00:00+09:00",
    ]);
  });

  it("limit 2·offset 2", async () => {
    getPromiseCandidates.mockResolvedValueOnce(okResult());
    const body = await (await call("?limit=2&offset=2")).json();
    expect(body).toMatchObject({ limit: 2, offset: 2, total: 7, hasMore: true, nextOffset: 4 });
    expect(body.candidates).toHaveLength(2);
  });

  it("offset ≥ total → 200 빈 배열, hasMore=false·nextOffset=null", async () => {
    getPromiseCandidates.mockResolvedValueOnce(okResult());
    const res = await call("?offset=7");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      total: 7,
      hasMore: false,
      nextOffset: null,
      candidates: [],
    });
  });

  it("후보 없음 → 200 total 0, 빈 배열", async () => {
    getPromiseCandidates.mockResolvedValueOnce(okResult([]));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      promiseId: PROMISE_ID,
      promiseStatus: "closed",
      calculatedAt: "2026-11-10T12:00:02+09:00",
      limit: 5,
      offset: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
      candidates: [],
    });
  });

  it("응답에 참여자 정보(닉네임·참여자 ID·슬롯·제출 여부)가 없다", async () => {
    getPromiseCandidates.mockResolvedValueOnce(okResult());
    const text = await (await call()).text();
    expect(text).not.toMatch(/nickname|participantId|participants|slots|submitted|pt-me/);
  });

  it("Origin이 달라도 검사하지 않는다 (GET)", async () => {
    getPromiseCandidates.mockResolvedValue(okResult());
    expect((await call("", PROMISE_ID, { origin: "https://evil.example" })).status).toBe(200);
  });

  describe("형식 검사 — 인증·DB 전에, 쿠키 없음, no-store", () => {
    it("promiseId 형식 오류 → 400 INVALID_REQUEST (쿼리 오류보다 먼저)", async () => {
      const res = await call("?limit=9", "not-a-uuid");
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_REQUEST");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(authenticatePromiseSession).not.toHaveBeenCalled();
    });

    it.each([
      ["?limit=0", "limit"],
      ["?limit=6", "limit"],
      ["?limit=abc", "limit"],
      ["?offset=-1", "offset"],
      ["?offset=1.5", "offset"],
    ])("%s → 422 VALIDATION_FAILED (details.field=%s)", async (query, field) => {
      const res = await call(query);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        code: "VALIDATION_FAILED",
        message: "후보 조회 범위를 확인해 주세요.",
        details: { field },
      });
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(authenticatePromiseSession).not.toHaveBeenCalled();
    });
  });

  describe("세션 인증 실패 — 쿠키 없음, no-store", () => {
    it.each([
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
      expect(getPromiseCandidates).not.toHaveBeenCalled();
    });
  });

  describe("트랜잭션 판정 실패 — 쿠키 갱신, no-store", () => {
    it.each(["collecting", "draft", "confirmed"])(
      "%s → 409 INVALID_PROMISE_STATE (details)",
      async (promiseStatus) => {
        getPromiseCandidates.mockResolvedValueOnce({ kind: "invalid_state", promiseStatus, ...keep });
        const res = await call();
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
          code: "INVALID_PROMISE_STATE",
          message: "현재 약속 상태에서는 요청할 수 없습니다.",
          details: { promiseStatus, allowedStates: ["closed"] },
        });
        expect(res.headers.get("set-cookie")).toBe(AUTH_COOKIE);
        expect(res.headers.get("cache-control")).toBe("no-store");
      },
    );

    it.each([
      ["cancelled", 409, "PROMISE_CANCELLED"],
      ["unauthenticated", 401, "UNAUTHENTICATED"],
    ])("%s → %i %s", async (kind, status, code) => {
      getPromiseCandidates.mockResolvedValueOnce({ kind, ...keep });
      const res = await call();
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(code);
      expect(res.headers.get("set-cookie")).toBe(AUTH_COOKIE);
    });

    it("약속 행이 사라짐 → 404, 쿠키 삭제", async () => {
      getPromiseCandidates.mockResolvedValueOnce({
        kind: "not_found",
        session: { expiresAt: null, now: NOW },
      });
      const res = await call();
      expect(res.status).toBe(404);
      expect(res.headers.get("set-cookie")).toBe(CLEAR_COOKIE);
    });

    it("세션이 만료됨(탈퇴) → 401, 쿠키 삭제", async () => {
      getPromiseCandidates.mockResolvedValueOnce({
        kind: "unauthenticated",
        session: { expiresAt: NOW, now: NOW },
      });
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBe(CLEAR_COOKIE);
    });
  });

  it("DB 오류 → 500 INTERNAL_ERROR, 원문·토큰을 응답·로그에 남기지 않음, no-store", async () => {
    getPromiseCandidates.mockRejectedValueOnce(
      Object.assign(new Error("postgres://user:secret@host/db tok"), { code: "P1001" }),
    );

    const res = await call("", PROMISE_ID, { cookie: `${COOKIE_PREFIX}tok` });

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
