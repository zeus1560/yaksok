import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupInviteLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member/link-lookup", () => ({ lookupInviteLink }));

import { GET } from "./route";

const TOKEN = "k3Zq8vTb1mRak3Zq8vTb1m";

function call(inviteToken = TOKEN) {
  const request = new Request(`http://localhost:3000/api/v1/links/${inviteToken}`);
  return GET(request, { params: Promise.resolve({ inviteToken }) });
}

describe("GET /api/v1/links/[inviteToken] (MEMBER-API-01)", () => {
  beforeEach(() => {
    lookupInviteLink.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("200으로 판정 본문을 그대로 돌려주고 캐시하지 않는다", async () => {
    const body = {
      inviteToken: TOKEN,
      promiseStatus: "unclaimed",
      promiseId: null,
      nextAction: "register_host",
      pollAfterMs: null,
      draftExpired: true,
    };
    lookupInviteLink.mockResolvedValueOnce({ kind: "ok", body });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(lookupInviteLink).toHaveBeenCalledWith(TOKEN);
  });

  it("없는 토큰은 404 LINK_NOT_FOUND", async () => {
    lookupInviteLink.mockResolvedValueOnce({ kind: "not_found" });

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "LINK_NOT_FOUND",
      message: "유효하지 않은 링크입니다.",
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("만료 링크는 410 LINK_EXPIRED", async () => {
    lookupInviteLink.mockResolvedValueOnce({ kind: "expired" });

    const res = await call();

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ code: "LINK_EXPIRED", message: "만료된 링크입니다." });
  });

  it("DB 오류는 500 INTERNAL_ERROR이고 원문을 노출하지 않는다", async () => {
    lookupInviteLink.mockRejectedValueOnce(new Error("connect ECONNREFUSED secret-host"));

    const res = await call();
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
  });

  it.each([
    ["410", () => lookupInviteLink.mockResolvedValueOnce({ kind: "expired" }), 410],
    ["500", () => lookupInviteLink.mockRejectedValueOnce(new Error("db")), 500],
  ])("%s 응답도 Cache-Control: no-store", async (_name, setup, status) => {
    setup();
    const res = await call();
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
