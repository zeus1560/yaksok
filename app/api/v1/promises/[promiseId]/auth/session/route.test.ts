import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IP 기준 레이트 리밋(035)은 기본으로 통과시킨다. 429는 아래 「레이트 리밋」 테스트에서 따로 본다
const rateLimitResponse = vi.hoisted(() => vi.fn());
vi.mock("@/lib/limit/rate-limit-store", () => ({ rateLimitResponse }));

const loginParticipant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/login", () => ({ loginParticipant }));
// 로그아웃 서비스만 바꾸고 allDevices 파싱·promiseId 형식은 실제 함수를 쓴다. DB 클라이언트는 만들지 않는다
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const logoutSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/logout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member/logout")>()),
  logoutSession,
}));

import { DELETE, POST } from "./route";

const BASE_URL = "http://localhost:3000";
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";

function call(
  body: unknown,
  headers: Record<string, string> = { origin: BASE_URL },
  promiseId = PROMISE_ID,
) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ promiseId }) });
}

const VALID = { nickname: "  혜승 ", pin: "1357" };

describe("POST /api/v1/promises/[promiseId]/auth/session (MEMBER-API-04)", () => {
  beforeEach(() => {
    rateLimitResponse.mockReset().mockResolvedValue(null);
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    loginParticipant.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("200으로 명세 본문과 세션 쿠키를 돌려준다", async () => {
    loginParticipant.mockResolvedValueOnce({
      kind: "ok",
      promiseId: PROMISE_ID,
      participantId: "2d81c6b7-7f54-4a19-b0c8-3e5a1f9d4b22",
      nickname: "혜승",
      role: "member",
      status: "active",
      promiseStatus: "collecting",
      sessionExpiresAt: new Date("2026-10-26T14:00:00.500Z"),
      sessionToken: "secret-session-token",
      sessionMaxAgeSeconds: 123456,
    });

    const res = await call(VALID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      participantId: "2d81c6b7-7f54-4a19-b0c8-3e5a1f9d4b22",
      nickname: "혜승",
      role: "member",
      status: "active",
      promiseStatus: "collecting",
      sessionExpiresAt: "2026-10-26T23:00:00+09:00",
    });
    expect(res.headers.get("set-cookie")).toBe(
      `ys_session_${PROMISE_ID}=secret-session-token; HttpOnly; Secure; SameSite=Lax; ` +
        `Path=/api/v1/promises/${PROMISE_ID}; Max-Age=123456`,
    );
    expect(loginParticipant).toHaveBeenCalledWith(
      PROMISE_ID,
      { nickname: "혜승", pin: "1357" },
      { ipKey: "unknown" },
    );
  });

  it("조합형 닉네임은 NFC 완성형으로 바꿔 조회한다", async () => {
    loginParticipant.mockResolvedValueOnce({ kind: "invalid_credentials" });
    await call({ nickname: "혜승", pin: "1357" });
    expect(loginParticipant).toHaveBeenCalledWith(
      PROMISE_ID,
      { nickname: "혜승", pin: "1357" },
      { ipKey: "unknown" },
    );
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 인증 시도 없음", async (_name, headers) => {
    const res = await call(VALID, headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(loginParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON 파싱 실패", "{nickname:"],
    ["nickname 누락", { pin: "1357" }],
    ["pin 누락", { nickname: "혜승" }],
    ["pin이 숫자 타입", { nickname: "혜승", pin: 1357 }],
    ["본문 null", "null"],
  ])("%s → 400 INVALID_REQUEST", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(loginParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["닉네임 1자", { nickname: "혜", pin: "1357" }, "nickname"],
    ["닉네임 이모지", { nickname: "혜승😀", pin: "1357" }, "nickname"],
    ["PIN 3자리", { nickname: "혜승", pin: "135" }, "pin"],
    ["PIN 문자", { nickname: "혜승", pin: "13a7" }, "pin"],
  ])("%s → 422 VALIDATION_FAILED", async (_name, body, field) => {
    const res = await call(body);
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.details).toEqual({ field });
    expect(JSON.stringify(json)).not.toContain(body.pin);
    expect(loginParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "PROMISE_NOT_FOUND"],
    ["cancelled", 409, "PROMISE_CANCELLED"],
    ["expired", 410, "ACCESS_PERIOD_EXPIRED"],
    ["draft_expired", 410, "DRAFT_EXPIRED"],
    ["invalid_credentials", 401, "INVALID_CREDENTIALS"],
    ["participant_cancelled", 403, "PARTICIPANT_CANCELLED"],
  ])("%s → %i %s, 쿠키 없음", async (kind, status, code) => {
    loginParticipant.mockResolvedValueOnce({ kind });
    const res = await call(VALID);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("UUID 형식 오류는 서비스의 invalid_request를 받아 400 INVALID_REQUEST, 쿠키 없음", async () => {
    loginParticipant.mockResolvedValueOnce({ kind: "invalid_request" });
    const res = await call(VALID, { origin: BASE_URL }, "not-a-uuid");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(loginParticipant).toHaveBeenCalledWith(
      "not-a-uuid",
      expect.anything(),
      expect.anything(),
    );
  });

  it("없는 닉네임과 틀린 PIN은 같은 401 본문이다 (서비스가 같은 kind를 돌려준다)", async () => {
    loginParticipant.mockResolvedValue({ kind: "invalid_credentials" });
    const a = await (await call({ nickname: "없는사람", pin: "1357" })).text();
    const b = await (await call({ nickname: "혜승", pin: "0000" })).text();
    expect(a).toBe(b);
    expect(a).not.toContain("0000");
  });

  it("처리 중 오류는 500이고 PIN·원문을 응답과 로그에 남기지 않는다", async () => {
    loginParticipant.mockRejectedValueOnce(new Error("insert failed pin=1357 host=secret-host"));
    const res = await call(VALID);
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain("1357");
    expect(text).not.toContain("secret-host");
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("1357");
  });

  const OK = {
    kind: "ok",
    promiseId: PROMISE_ID,
    participantId: "pt",
    nickname: "혜승",
    role: "member",
    status: "active",
    promiseStatus: "collecting",
    sessionExpiresAt: new Date(),
    sessionToken: "t",
    sessionMaxAgeSeconds: 60,
  };
  it.each([
    ["200", VALID, { origin: BASE_URL }, OK, 200],
    ["403 Origin", VALID, {}, null, 403],
    ["400 본문", "{x", { origin: BASE_URL }, null, 400],
    ["422 PIN", { nickname: "혜승", pin: "1" }, { origin: BASE_URL }, null, 422],
    ["400 형식", VALID, { origin: BASE_URL }, { kind: "invalid_request" }, 400],
    ["401", VALID, { origin: BASE_URL }, { kind: "invalid_credentials" }, 401],
    ["403 cancelled 참여자", VALID, { origin: BASE_URL }, { kind: "participant_cancelled" }, 403],
    ["404", VALID, { origin: BASE_URL }, { kind: "not_found" }, 404],
    ["409", VALID, { origin: BASE_URL }, { kind: "cancelled" }, 409],
    ["410 접근 기간", VALID, { origin: BASE_URL }, { kind: "expired" }, 410],
    ["410 draft", VALID, { origin: BASE_URL }, { kind: "draft_expired" }, 410],
    ["500", VALID, { origin: BASE_URL }, new Error("db"), 500],
    [
      "429 PIN 시도 제한",
      VALID,
      { origin: BASE_URL },
      { kind: "too_many_attempts", retryAfterSeconds: 61 },
      429,
    ],
  ])("%s 응답도 Cache-Control: no-store", async (_name, body, headers, result, status) => {
    if (result instanceof Error) loginParticipant.mockRejectedValueOnce(result);
    else if (result) loginParticipant.mockResolvedValueOnce(result);
    const res = await call(body, headers);
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  describe("시도 제한·레이트 리밋 (035, R-41)", () => {
    it("too_many_attempts → 429 TOO_MANY_ATTEMPTS, Retry-After와 details.retryAfterSeconds, 쿠키 없음", async () => {
      loginParticipant.mockResolvedValueOnce({ kind: "too_many_attempts", retryAfterSeconds: 754 });
      const res = await call(VALID);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("754");
      expect(res.headers.get("set-cookie")).toBeNull();
      const body = await res.json();
      expect(body).toEqual({
        code: "TOO_MANY_ATTEMPTS",
        message: "PIN을 여러 번 틀려 잠시 로그인할 수 없습니다.",
        details: { retryAfterSeconds: 754 },
      });
      // 남은 시도 횟수는 알려 주지 않는다
      expect(JSON.stringify(body)).not.toMatch(/remaining|attempts":/);
    });

    it("x-forwarded-for 첫 값을 IP 키로 넘긴다", async () => {
      loginParticipant.mockResolvedValueOnce({ kind: "invalid_credentials" });
      await call(VALID, { origin: BASE_URL, "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
      expect(loginParticipant).toHaveBeenCalledWith(PROMISE_ID, expect.anything(), {
        ipKey: "203.0.113.7",
      });
    });

    it("레이트 리밋에 걸리면 그 429를 그대로 돌려주고 로그인 처리(PIN 비교)를 하지 않는다", async () => {
      rateLimitResponse.mockResolvedValueOnce(
        Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "12" } }),
      );
      const res = await call(VALID);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("12");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(rateLimitResponse).toHaveBeenCalledWith(expect.any(Request), "login");
      expect(loginParticipant).not.toHaveBeenCalled();
    });

    it("Origin·입력 형식 오류는 레이트 리밋을 세기 전에 거절한다", async () => {
      expect((await call(VALID, {})).status).toBe(403);
      expect((await call({ nickname: "혜승", pin: "1" })).status).toBe(422);
      expect(rateLimitResponse).not.toHaveBeenCalled();
    });

    it("레이트 리밋 저장 오류는 500이다", async () => {
      rateLimitResponse.mockRejectedValueOnce(new Error("db down"));
      expect((await call(VALID)).status).toBe(500);
      expect(loginParticipant).not.toHaveBeenCalled();
    });
  });
});

function logout(
  query = "",
  headers: Record<string, string> = { origin: BASE_URL },
  promiseId = PROMISE_ID,
) {
  const request = new Request(`${BASE_URL}/api/v1/promises/${promiseId}/auth/session${query}`, {
    method: "DELETE",
    headers,
  });
  return DELETE(request, { params: Promise.resolve({ promiseId }) });
}

const CLEARED = `ys_session_${PROMISE_ID}=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/${PROMISE_ID}; Max-Age=0`;

describe("DELETE /api/v1/promises/[promiseId]/auth/session (MEMBER-API-07)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    logoutSession.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("204 본문 없음, 쿠키 Max-Age=0, no-store. allDevices 기본값 false", async () => {
    logoutSession.mockResolvedValueOnce({ kind: "ok", promiseId: PROMISE_ID });

    const res = await logout("", { origin: BASE_URL, cookie: `ys_session_${PROMISE_ID}=abc` });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("set-cookie")).toBe(CLEARED);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(logoutSession).toHaveBeenCalledWith(expect.any(Request), PROMISE_ID, {
      allDevices: false,
    });
  });

  it.each([
    ["?allDevices=true", true],
    ["?allDevices=false", false],
  ])("%s → allDevices %s로 넘긴다", async (query, allDevices) => {
    logoutSession.mockResolvedValueOnce({ kind: "ok", promiseId: PROMISE_ID });
    const res = await logout(query);
    expect(res.status).toBe(204);
    expect(logoutSession).toHaveBeenCalledWith(expect.any(Request), PROMISE_ID, { allDevices });
  });

  it("대문자 promiseId로 와도 쿠키 이름·Path는 서비스가 돌려준 DB id(소문자)로 지운다", async () => {
    logoutSession.mockResolvedValueOnce({ kind: "ok", promiseId: PROMISE_ID });
    const res = await logout("", { origin: BASE_URL }, PROMISE_ID.toUpperCase());
    expect(res.headers.get("set-cookie")).toBe(CLEARED);
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 서비스 호출 없음·쿠키 변경 없음", async (_name, headers) => {
    const res = await logout("", headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(logoutSession).not.toHaveBeenCalled();
  });

  it("Origin이 promiseId 형식보다 먼저다", async () => {
    const res = await logout("", {}, "not-a-uuid");
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
  });

  it("promiseId 형식 오류 → 400 INVALID_REQUEST, allDevices보다 먼저", async () => {
    const res = await logout("?allDevices=yes", { origin: BASE_URL }, "not-a-uuid");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(logoutSession).not.toHaveBeenCalled();
  });

  it.each([
    "?allDevices=1",
    "?allDevices=TRUE",
    "?allDevices=",
    "?allDevices=true&allDevices=false",
  ])("%s → 400 INVALID_REQUEST, 약속 조회 전에 거절", async (query) => {
    const res = await logout(query);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(logoutSession).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "not_found" }, 404, "PROMISE_NOT_FOUND"],
    [{ kind: "unauthenticated" }, 401, "UNAUTHENTICATED"],
    [{ kind: "forbidden" }, 403, "FORBIDDEN"],
  ])("%o → %i %s, 쿠키를 건드리지 않는다", async (result, status, code) => {
    logoutSession.mockResolvedValueOnce(result);
    const res = await logout();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("DB 오류 → 500, 토큰을 응답·로그에 남기지 않는다", async () => {
    logoutSession.mockRejectedValueOnce(new Error("token secret-token-value"));
    const res = await logout("", {
      origin: BASE_URL,
      cookie: `ys_session_${PROMISE_ID}=secret-token-value`,
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("secret-token-value");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-token-value");
  });
});
