import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IP 기준 레이트 리밋(035)은 기본으로 통과시킨다. 429는 아래 「레이트 리밋」 테스트에서 따로 본다
const rateLimitResponse = vi.hoisted(() => vi.fn());
vi.mock("@/lib/limit/rate-limit-store", () => ({ rateLimitResponse }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const registerParticipant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/participant-registration", () => ({ registerParticipant }));
const authenticatePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/session-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/session-auth")>()),
  authenticatePromiseSession,
}));
const getParticipantList = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/participant-list", () => ({ getParticipantList }));

import { GET, POST } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const BODY = { nickname: "  혜승 ", pin: "1357" };
const CREATED = {
  kind: "created",
  promiseId: PROMISE_ID,
  participantId: "2d81c6b7-7f54-4a19-b0c8-3e5a1f9d4b22",
  nickname: "혜승",
  currentParticipantCount: 4,
  participantLimit: 6,
  sessionToken: "secret-session-token",
  sessionMaxAgeSeconds: 1124255,
};

function call(
  body: unknown,
  headers: Record<string, string> = { origin: BASE_URL },
  promiseId = PROMISE_ID,
) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/participants`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ promiseId }) });
}

describe("POST /api/v1/promises/[promiseId]/participants (MEMBER-API-03)", () => {
  beforeEach(() => {
    rateLimitResponse.mockReset().mockResolvedValue(null);
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    registerParticipant.mockReset().mockResolvedValue(CREATED);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("201: 명세 본문 그대로(설정 값 없음), Set-Cookie 속성과 Max-Age, no-store", async () => {
    const res = await call(BODY);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      participantId: CREATED.participantId,
      nickname: "혜승",
      role: "member",
      status: "active",
      availabilitySubmittedAt: null,
      currentParticipantCount: 4,
      participantLimit: 6,
    });
    expect(res.headers.get("set-cookie")).toBe(
      `ys_session_${PROMISE_ID}=secret-session-token; HttpOnly; Secure; SameSite=Lax; ` +
        `Path=/api/v1/promises/${PROMISE_ID}; Max-Age=1124255`,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    // 정규화(trim → NFC)한 닉네임을 넘긴다
    expect(registerParticipant).toHaveBeenCalledWith(expect.any(Request), PROMISE_ID, {
      nickname: "혜승",
      pin: "1357",
    });
  });

  it("조합형 닉네임은 NFC로 정규화해 넘긴다", async () => {
    await call({ nickname: "혜승".normalize("NFD"), pin: "1357" });
    expect(registerParticipant.mock.calls[0][2].nickname).toBe("혜승".normalize("NFC"));
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 처리 없음, no-store", async (_name, headers) => {
    const res = await call(BODY, headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(registerParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON 파싱 실패", "{nickname:"],
    ["null 본문", "null"],
    ["닉네임 누락", { pin: "1357" }],
    ["PIN이 숫자", { nickname: "혜승", pin: 1357 }],
  ])("%s → 400 INVALID_REQUEST", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(registerParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["닉네임 1자", { nickname: "혜", pin: "1357" }, "nickname"],
    ["닉네임 13자", { nickname: "가나다라마바사아자차카타파", pin: "1357" }, "nickname"],
    ["닉네임 이모지", { nickname: "혜승😀", pin: "1357" }, "nickname"],
    ["PIN 3자리", { nickname: "혜승", pin: "135" }, "pin"],
    ["PIN 문자", { nickname: "혜승", pin: "13a7" }, "pin"],
  ])("%s → 422 VALIDATION_FAILED(details.field=%s)", async (_name, body, field) => {
    const res = await call(body);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.details).toEqual({ field });
    expect(registerParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_request", 400, "INVALID_REQUEST"],
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["already_participant", 409, "ALREADY_PARTICIPANT"],
    ["draft_expired", 410, "DRAFT_EXPIRED"],
    ["not_open", 409, "PROMISE_NOT_OPEN"],
    ["deadline_passed", 409, "DEADLINE_PASSED"],
    ["nickname_taken", 409, "NICKNAME_TAKEN"],
    ["full", 409, "PROMISE_FULL"],
  ])("%s → %i %s, 쿠키 없음, no-store", async (kind, status, code) => {
    registerParticipant.mockResolvedValueOnce({ kind });
    const res = await call(BODY);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("형식이 틀린 promiseId도 그대로 넘겨 400을 받는다", async () => {
    registerParticipant.mockResolvedValueOnce({ kind: "invalid_request" });
    const res = await call(BODY, { origin: BASE_URL }, "not-a-uuid");
    expect(res.status).toBe(400);
    expect(registerParticipant.mock.calls[0][1]).toBe("not-a-uuid");
  });

  it("closed·confirmed 409는 현재 상태와 허용 상태를 details로 알린다", async () => {
    registerParticipant.mockResolvedValueOnce({ kind: "invalid_state", promiseStatus: "closed" });
    const res = await call(BODY);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "INVALID_PROMISE_STATE",
      details: { promiseStatus: "closed", allowedStates: ["collecting"] },
    });
  });

  it("NICKNAME_TAKEN은 로그인 안내 문구와 details.field", async () => {
    registerParticipant.mockResolvedValueOnce({ kind: "nickname_taken" });
    expect(await (await call(BODY)).json()).toEqual({
      code: "NICKNAME_TAKEN",
      message: "이미 사용 중인 닉네임입니다. 본인이 등록했다면 로그인해 주세요.",
      details: { field: "nickname" },
    });
  });

  it("처리 중 오류는 500이고 원문·PIN·토큰을 응답·로그에 남기지 않는다", async () => {
    registerParticipant.mockRejectedValueOnce(new Error("insert failed host=secret-host pin=1357"));
    const res = await call(BODY);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
    expect(text).not.toContain("1357");
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("secret-host");
    expect(logged).not.toContain("1357");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  describe("레이트 리밋 (035, R-41)", () => {
    it("IP 기준 요청 수를 넘으면 429를 그대로 돌려주고 registerParticipant를 부르지 않는다", async () => {
      rateLimitResponse.mockResolvedValueOnce(
        Response.json(
          { code: "RATE_LIMITED", details: { retryAfterSeconds: 30 } },
          { status: 429, headers: { "Retry-After": "30" } },
        ),
      );
      const res = await call(BODY);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("30");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(rateLimitResponse).toHaveBeenCalledWith(expect.any(Request), "participants");
      expect(registerParticipant).not.toHaveBeenCalled();
    });

    it("Origin이 틀리면 레이트 리밋을 세지 않는다", async () => {
      expect((await call(BODY, {})).status).toBe(403);
      expect(rateLimitResponse).not.toHaveBeenCalled();
    });
  });
});

describe("GET /api/v1/promises/[promiseId]/participants (MEMBER-API-06)", () => {
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
  const keepSession = { expiresAt: AUTH.session.expiresAt, now: NOW };
  const PEOPLE = [
    {
      participantId: "b9a4c7e1-0000-4000-8000-000000000001",
      nickname: "승주",
      role: "host",
      isMe: false,
    },
    { participantId: "pt-me", nickname: "혜승", role: "member", isMe: true },
    {
      participantId: "7f20a3dd-0000-4000-8000-000000000003",
      nickname: "철수",
      role: "member",
      isMe: false,
    },
  ];

  function get(promiseId = PROMISE_ID, headers: Record<string, string> = {}) {
    const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/participants`, {
      method: "GET",
      headers,
    });
    return GET(request, { params: Promise.resolve({ promiseId }) });
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    authenticatePromiseSession.mockReset().mockResolvedValue(AUTH);
    getParticipantList.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200: 명세 본문(정원·인원 = 배열 길이·명단), Origin 없이도 처리, 쿠키 갱신, no-store", async () => {
    getParticipantList.mockResolvedValueOnce({
      kind: "ok",
      participantLimit: 6,
      participants: PEOPLE,
      session: { expiresAt: AUTH.session.expiresAt, now: new Date(NOW.getTime() + 2000) },
    });

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      participantLimit: 6,
      currentParticipantCount: 3,
      participants: PEOPLE,
    });
    expect(getParticipantList).toHaveBeenCalledWith(AUTH);
    expect(res.headers.get("set-cookie")).toBe(`${COOKIE_PREFIX}tok${COOKIE_ATTRS}; Max-Age=3598`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("응답에 제출 여부·status·PIN·세션 정보를 넣지 않는다", async () => {
    getParticipantList.mockResolvedValueOnce({
      kind: "ok",
      participantLimit: 6,
      participants: PEOPLE,
      session: keepSession,
    });
    const text = await (await get()).text();
    expect(text).not.toMatch(/submitted|status|pin|hash|session|normalized|tok/i);
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
      const res = await get();
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(code);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(getParticipantList).not.toHaveBeenCalled();
    });

    it("형식이 틀린 promiseId는 공통 인증 모듈이 400으로 판정하고, 취소는 세션보다 먼저다", async () => {
      authenticatePromiseSession.mockResolvedValueOnce({ kind: "invalid_request" });
      const res = await get("not-a-uuid");
      expect(res.status).toBe(400);
      expect(authenticatePromiseSession.mock.calls[0][1]).toBe("not-a-uuid");
      // allowCancelled를 넘기지 않는다
      expect(authenticatePromiseSession.mock.calls[0][2]).toBeUndefined();
    });
  });

  describe("인증 뒤 트랜잭션 판정 (쿠키 갱신)", () => {
    it.each([
      ["not_found", 404, "PROMISE_NOT_FOUND", CLEAR_COOKIE, { expiresAt: null, now: NOW }],
      ["cancelled", 409, "PROMISE_CANCELLED", AUTH_COOKIE, keepSession],
      ["unauthenticated", 401, "UNAUTHENTICATED", CLEAR_COOKIE, { expiresAt: null, now: NOW }],
      ["forbidden", 403, "FORBIDDEN", AUTH_COOKIE, keepSession],
    ])("%s → %i %s", async (kind, status, code, cookie, session) => {
      getParticipantList.mockResolvedValueOnce({ kind, session });
      const res = await get();
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code });
      expect(res.headers.get("set-cookie")).toBe(cookie);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  it("예외 → 500 INTERNAL_ERROR, no-store, 원문 메시지를 로그에 남기지 않는다", async () => {
    getParticipantList.mockRejectedValueOnce(new Error("postgresql://secret@host/db"));
    const res = await get();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("INTERNAL_ERROR");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });
});
