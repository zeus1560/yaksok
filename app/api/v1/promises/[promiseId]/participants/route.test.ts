import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const registerParticipant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/participant-registration", () => ({ registerParticipant }));

import { POST } from "./route";

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
});
