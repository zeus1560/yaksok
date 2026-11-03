import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registerHost = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/host-registration", () => ({ registerHost }));

import { POST } from "./route";

const BASE_URL = "http://localhost:3000";
const TOKEN = "k3Zq8vTb1mRak3Zq8vTb1m";

function call(body: unknown, headers: Record<string, string> = { origin: BASE_URL }) {
  const request = new Request(`${BASE_URL}/api/v1/links/${TOKEN}/host`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ inviteToken: TOKEN }) });
}

const VALID = { nickname: "  승주 ", pin: "4827" };

describe("POST /api/v1/links/[inviteToken]/host (MEMBER-API-02)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    registerHost.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("201로 명세 본문과 세션 쿠키를 돌려준다", async () => {
    registerHost.mockResolvedValueOnce({
      kind: "created",
      promiseId: "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42",
      participantId: "b9a4c7e1-2f03-4a88-91ad-5c7e6b2d1f90",
      nickname: "승주",
      draftExpiresAt: new Date("2026-10-11T03:10:00.123Z"),
      sessionToken: "secret-session-token",
      sessionMaxAgeSeconds: 86400,
    });

    const res = await call(VALID);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      promiseId: "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42",
      participantId: "b9a4c7e1-2f03-4a88-91ad-5c7e6b2d1f90",
      nickname: "승주",
      role: "host",
      promiseStatus: "draft",
      draftExpiresAt: "2026-10-11T12:10:00+09:00",
    });
    expect(res.headers.get("set-cookie")).toBe(
      "ys_session_7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42=secret-session-token; HttpOnly; Secure; " +
        "SameSite=Lax; Path=/api/v1/promises/7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42; Max-Age=86400",
    );
    expect(registerHost).toHaveBeenCalledWith(TOKEN, { nickname: "승주", pin: "4827" });
  });

  it.each([
    ["Origin 없음", {}],
    ["다른 Origin", { origin: "https://evil.example" }],
  ])("%s → 403 INVALID_ORIGIN, 등록 시도 없음", async (_name, headers) => {
    const res = await call(VALID, headers);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(registerHost).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON 파싱 실패", "{nickname:"],
    ["nickname 누락", { pin: "4827" }],
    ["pin 누락", { nickname: "승주" }],
    ["pin이 숫자 타입", { nickname: "승주", pin: 4827 }],
    ["본문 null", "null"],
  ])("%s → 400 INVALID_REQUEST", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_REQUEST");
    expect(registerHost).not.toHaveBeenCalled();
  });

  it.each([
    ["닉네임 1자", { nickname: "가", pin: "4827" }, "nickname"],
    ["닉네임 13자", { nickname: "가나다라마바사아자차카타파", pin: "4827" }, "nickname"],
    ["닉네임 이모지", { nickname: "승주😀", pin: "4827" }, "nickname"],
    ["PIN 3자리", { nickname: "승주", pin: "482" }, "pin"],
    ["PIN 문자", { nickname: "승주", pin: "48a7" }, "pin"],
  ])("%s → 422 VALIDATION_FAILED", async (_name, body, field) => {
    const res = await call(body);
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.details).toEqual({ field });
    expect(JSON.stringify(json)).not.toContain(body.pin);
    expect(registerHost).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "LINK_NOT_FOUND"],
    ["already_registered", 409, "HOST_ALREADY_REGISTERED"],
    ["expired", 410, "LINK_EXPIRED"],
  ])("%s → %i %s, 쿠키 없음", async (kind, status, code) => {
    registerHost.mockResolvedValueOnce({ kind });
    const res = await call(VALID);
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("처리 중 오류는 500이고 PIN·원문을 응답과 로그에 남기지 않는다", async () => {
    registerHost.mockRejectedValueOnce(new Error("insert failed pin=4827 host=secret-host"));
    const res = await call(VALID);
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain("4827");
    expect(text).not.toContain("secret-host");
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("4827");
  });
});
