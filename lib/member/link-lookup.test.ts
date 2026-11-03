import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: { promiseLink: { findUnique }, $queryRaw: queryRaw },
}));

import { lookupInviteLink } from "./link-lookup";

const TOKEN = "k3Zq8vTb1mRak3Zq8vTb1m";
const CREATED = new Date("2026-11-01T10:00:00+09:00");

describe("lookupInviteLink", () => {
  beforeEach(() => {
    findUnique.mockReset();
    queryRaw.mockReset();
  });

  it.each(["short", "k3Zq8vTb1mRak3Zq8vTb1m!", "k3Zq8vTb1mRak3Zq8vTb1mX", ""])(
    "형식이 다른 토큰(%s)은 DB를 조회하지 않고 not_found",
    async (token) => {
      expect(await lookupInviteLink(token)).toEqual({ kind: "not_found" });
      expect(findUnique).not.toHaveBeenCalled();
      expect(queryRaw).not.toHaveBeenCalled();
    },
  );

  it("존재하지 않는 토큰은 not_found", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await lookupInviteLink(TOKEN, CREATED)).toEqual({ kind: "not_found" });
  });

  it("now를 넘기지 않으면 DB 시각(clock_timestamp)으로 판정한다", async () => {
    findUnique.mockResolvedValueOnce({ inviteToken: TOKEN, createdAt: CREATED, promise: null });
    queryRaw.mockResolvedValueOnce([
      { now: new Date(CREATED.getTime() + 7 * 24 * 60 * 60 * 1000) },
    ]);

    expect(await lookupInviteLink(TOKEN)).toEqual({ kind: "expired" });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("now를 넘기면 DB 시각을 읽지 않는다", async () => {
    findUnique.mockResolvedValueOnce({ inviteToken: TOKEN, createdAt: CREATED, promise: null });

    const result = await lookupInviteLink(TOKEN, CREATED);
    expect(result).toMatchObject({ kind: "ok", body: { promiseStatus: "unclaimed" } });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
