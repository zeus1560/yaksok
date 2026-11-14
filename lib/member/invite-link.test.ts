import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/prisma/generated/client";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { promiseLink: { create } } }));

import { buildInviteUrl, generateInviteToken, issueInviteLink } from "./invite-link";

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.10.0",
  });
}

describe("generateInviteToken", () => {
  it("128비트 난수를 base64url 22자로 만든다", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateInviteToken()).not.toBe(token);
  });
});

describe("buildInviteUrl", () => {
  it("BASE_URL 끝 슬래시 유무와 관계없이 /p/{token}을 붙인다", () => {
    expect(buildInviteUrl("http://localhost:3000", "abc")).toBe("http://localhost:3000/p/abc");
    expect(buildInviteUrl("http://localhost:3000/", "abc")).toBe("http://localhost:3000/p/abc");
  });
});

describe("issueInviteLink", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3000");
    create.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("전달받은 source로 promise_links에만 저장하고 토큰과 주소를 돌려준다", async () => {
    create.mockResolvedValueOnce({ id: "link-1" });

    const result = await issueInviteLink("web");

    expect(create).toHaveBeenCalledTimes(1);
    const { data } = create.mock.calls[0][0];
    expect(data).toEqual({ inviteToken: result.inviteToken, source: "web" });
    expect(result.inviteUrl).toBe(`http://localhost:3000/p/${result.inviteToken}`);
  });

  it("토큰 충돌(P2002)이면 새 토큰으로 1회 재시도한다", async () => {
    create.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce({ id: "link-1" });

    const result = await issueInviteLink("web");

    expect(create).toHaveBeenCalledTimes(2);
    const first = create.mock.calls[0][0].data.inviteToken;
    const second = create.mock.calls[1][0].data.inviteToken;
    expect(second).not.toBe(first);
    expect(result.inviteToken).toBe(second);
  });

  it("두 번 연속 충돌하면 더 시도하지 않고 오류를 던진다", async () => {
    create.mockRejectedValue(uniqueViolation());

    await expect(issueInviteLink("web")).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("UNIQUE 위반이 아닌 DB 오류는 재시도하지 않는다", async () => {
    create.mockRejectedValue(new Error("connection lost"));

    await expect(issueInviteLink("web")).rejects.toThrow("connection lost");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("로컬·운영은 요청 Origin과 관계없이 NEXT_PUBLIC_BASE_URL로 만든다", async () => {
    create.mockResolvedValueOnce({ id: "link-1" });

    const result = await issueInviteLink("web", "https://other.example");

    expect(result.inviteUrl).toBe(`http://localhost:3000/p/${result.inviteToken}`);
  });

  it("미리보기(VERCEL_ENV=preview)는 요청이 온 배포 주소로 만든다 (032)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "yaksok-abc123-team.vercel.app");
    create.mockResolvedValueOnce({ id: "link-1" });

    const result = await issueInviteLink("web", "https://yaksok-abc123-team.vercel.app");

    expect(result.inviteUrl).toBe(`https://yaksok-abc123-team.vercel.app/p/${result.inviteToken}`);
  });

  it("NEXT_PUBLIC_BASE_URL이 없으면 저장하지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");

    await expect(issueInviteLink("web")).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
