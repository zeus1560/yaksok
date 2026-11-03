import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loginParticipant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/login", () => ({ loginParticipant }));

import { POST } from "./route";

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
    expect(loginParticipant).toHaveBeenCalledWith(PROMISE_ID, { nickname: "혜승", pin: "1357" });
  });

  it("조합형 닉네임은 NFC 완성형으로 바꿔 조회한다", async () => {
    loginParticipant.mockResolvedValueOnce({ kind: "invalid_credentials" });
    await call({ nickname: "혜승", pin: "1357" });
    expect(loginParticipant).toHaveBeenCalledWith(PROMISE_ID, { nickname: "혜승", pin: "1357" });
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
    ["invalid_credentials", 401, "INVALID_CREDENTIALS"],
    ["participant_cancelled", 403, "PARTICIPANT_CANCELLED"],
  ])("%s → %i %s, 쿠키 없음", async (kind, status, code) => {
    loginParticipant.mockResolvedValueOnce({ kind });
    const res = await call(VALID);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("UUID 형식 오류는 서비스의 not_found를 받아 404 PROMISE_NOT_FOUND", async () => {
    loginParticipant.mockResolvedValueOnce({ kind: "not_found" });
    const res = await call(VALID, { origin: BASE_URL }, "not-a-uuid");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("PROMISE_NOT_FOUND");
    expect(loginParticipant).toHaveBeenCalledWith("not-a-uuid", expect.anything());
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
});
