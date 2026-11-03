import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/prisma/generated/client";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { promiseLink: { create } } }));

import { POST } from "./route";

const BASE_URL = "http://localhost:3000";

function linkRequest(headers: Record<string, string> = { origin: BASE_URL }, body?: string) {
  return new Request(`${BASE_URL}/api/v1/links`, { method: "POST", headers, body });
}

describe("POST /api/v1/links (MEMBER-API-09)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
    create.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("201로 inviteToken·inviteUrl·nextAction만 돌려주고 source='web'으로 저장한다", async () => {
    create.mockResolvedValueOnce({ id: "link-1" });

    const res = await POST(linkRequest());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Object.keys(body).sort()).toEqual(["inviteToken", "inviteUrl", "nextAction"]);
    expect(body.nextAction).toBe("register_host");
    expect(body.inviteUrl).toBe(`${BASE_URL}/p/${body.inviteToken}`);
    expect(create.mock.calls[0][0].data).toEqual({ inviteToken: body.inviteToken, source: "web" });
  });

  it("본문의 source 등은 무시한다", async () => {
    create.mockResolvedValueOnce({ id: "link-1" });

    const res = await POST(
      linkRequest(
        { origin: BASE_URL, "content-type": "application/json" },
        JSON.stringify({ source: "kakao", inviteToken: "chosen" }),
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.inviteToken).not.toBe("chosen");
    expect(create.mock.calls[0][0].data.source).toBe("web");
  });

  it("Origin 헤더가 없으면 403 INVALID_ORIGIN이고 저장하지 않는다", async () => {
    const res = await POST(linkRequest({}));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INVALID_ORIGIN");
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example", "http://localhost:3001", "null"])(
    "Origin이 %s이면 403 INVALID_ORIGIN이고 저장하지 않는다",
    async (origin) => {
      const res = await POST(linkRequest({ origin }));

      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("INVALID_ORIGIN");
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("토큰 충돌이 두 번 이어지면 500 INTERNAL_ERROR이고 원시 오류를 노출하지 않는다", async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed on invite_token", {
        code: "P2002",
        clientVersion: "7.10.0",
      }),
    );

    const res = await POST(linkRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ code: "INTERNAL_ERROR", message: "처리 중 오류가 발생했습니다." });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("그 밖의 DB 오류도 500 INTERNAL_ERROR로 감싼다", async () => {
    create.mockRejectedValue(new Error("connect ECONNREFUSED secret-host"));

    const res = await POST(linkRequest());
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain("secret-host");
  });
});
