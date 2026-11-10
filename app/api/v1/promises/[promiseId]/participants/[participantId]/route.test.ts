import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const removeParticipant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/remove-participant", () => ({ removeParticipant }));

import { DELETE } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const TARGET_ID = "2d81c6b7-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const NOW = new Date("2026-11-09T12:00:00.400+09:00");
const AUTH = {
  kind: "ok",
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-host", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(NOW.getTime() + 3600_000) },
  now: NOW,
};
const COOKIE_PREFIX = `ys_session_${PROMISE_ID}=`;
const COOKIE_ATTRS = `; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}`;
const CLEARED = `${COOKIE_PREFIX}${COOKIE_ATTRS}; Max-Age=0`;
// 잠금 후 판정 시각이 2초 뒤면 남은 시간은 3598초
const LOCKED = { expiresAt: AUTH.session.expiresAt, now: new Date(NOW.getTime() + 2000) };
const REFRESHED = `${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`;

function call(
  { promiseId = PROMISE_ID, participantId = TARGET_ID } = {},
  headers: Record<string, string> = { origin: BASE_URL },
  body?: string,
) {
  const request = new Request(
    `${BASE_URL}/api/v1/promises/${promiseId}/participants/${participantId}`,
    {
      method: "DELETE",
      headers,
      body,
    },
  );
  return DELETE(request, { params: Promise.resolve({ promiseId, participantId }) });
}

describe("DELETE /api/v1/promises/[promiseId]/participants/[participantId] (MEMBER-API-08)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    removeParticipant.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200: 4개 필드, 요청자 쿠키는 잠금 후 세션 기준으로 갱신, no-store", async () => {
    removeParticipant.mockResolvedValueOnce({
      kind: "ok",
      participantId: TARGET_ID,
      currentParticipantCount: 3,
      participantLimit: 6,
      session: LOCKED,
    });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      participantId: TARGET_ID,
      participantStatus: "cancelled",
      currentParticipantCount: 3,
      participantLimit: 6,
    });
    expect(res.headers.get("set-cookie")).toBe(REFRESHED);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(removeParticipant).toHaveBeenCalledWith(AUTH, TARGET_ID);
  });

  it("본문은 읽지 않는다 (명세상 본문 없음, 보내도 무시)", async () => {
    removeParticipant.mockResolvedValueOnce({
      kind: "ok",
      participantId: TARGET_ID,
      currentParticipantCount: 3,
      participantLimit: 6,
      session: LOCKED,
    });
    const res = await call(
      {},
      { origin: BASE_URL, "content-type": "application/json" },
      "{not json",
    );
    expect(res.status).toBe(200);
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 인증·저장 없음, no-store", async (_n, headers) => {
    const res = await call({}, headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(authenticatePromiseSession).not.toHaveBeenCalled();
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["promiseId 형식 오류", { promiseId: "not-a-uuid" }],
    ["participantId 형식 오류", { participantId: "not-a-uuid" }],
    ["participantId 빈 UUID 꼴", { participantId: "12345678-1234-1234-1234-12345678" }],
  ])("%s → 400 INVALID_REQUEST, 인증 전, 쿠키 없음", async (_n, ids) => {
    const res = await call(ids);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
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
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["forbidden", 403, "FORBIDDEN"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
    ["deadline_passed", 409, "DEADLINE_PASSED"],
    ["participant_not_found", 404, "PARTICIPANT_NOT_FOUND"],
    ["cannot_remove_self", 409, "CANNOT_REMOVE_SELF"],
  ])("잠금 후 %s → %i %s, 쿠키 갱신, no-store", async (kind, status, code) => {
    removeParticipant.mockResolvedValueOnce({ kind, session: LOCKED });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(REFRESHED);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["draft", "closed", "confirmed"])(
    "%s → 409 INVALID_PROMISE_STATE, details { promiseStatus, allowedStates: [collecting] }",
    async (promiseStatus) => {
      removeParticipant.mockResolvedValueOnce({
        kind: "invalid_state",
        promiseStatus,
        session: LOCKED,
      });
      const res = await call();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: "INVALID_PROMISE_STATE",
        message: "현재 약속 상태에서는 요청할 수 없습니다.",
        details: { promiseStatus, allowedStates: ["collecting"] },
      });
      expect(res.headers.get("set-cookie")).toBe(REFRESHED);
    },
  );

  it("CANNOT_REMOVE_SELF 메시지는 탈퇴로 안내한다", async () => {
    removeParticipant.mockResolvedValueOnce({ kind: "cannot_remove_self", session: LOCKED });
    const res = await call();
    expect(await res.json()).toEqual({
      code: "CANNOT_REMOVE_SELF",
      message: "방장은 스스로를 내보낼 수 없습니다. 탈퇴를 이용해 주세요.",
    });
  });

  it.each([
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
  ])("%s(세션 행 없음) → %i %s, 쿠키를 Max-Age=0으로 지운다", async (kind, status, code) => {
    removeParticipant.mockResolvedValueOnce({ kind, session: { expiresAt: null, now: NOW } });
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBe(CLEARED);
  });

  it("처리 중 오류는 500이고 원문을 응답·로그에 남기지 않는다", async () => {
    removeParticipant.mockRejectedValueOnce(new Error("update failed host=secret-host"));
    const res = await call();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-host");
  });
});
