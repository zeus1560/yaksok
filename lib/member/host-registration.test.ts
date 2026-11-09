import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/prisma/generated/client";
import { hashSessionToken } from "./session";

// 트랜잭션 콜백에 넘길 가짜 tx. $queryRaw는 링크 → 약속 → 시각 순서로 응답을 꺼낸다
const calls: string[] = [];
const queryResults: unknown[][] = [];
const tx = {
  $queryRaw: vi.fn(async () => queryResults.shift() ?? []),
  participantSession: {
    deleteMany: vi.fn(async () => (calls.push("session.deleteMany"), { count: 1 })),
    create: vi.fn(async () => (calls.push("session.create"), { id: "s-1" })),
  },
  participant: {
    deleteMany: vi.fn(async () => (calls.push("participant.deleteMany"), { count: 1 })),
    create: vi.fn(async () => (calls.push("participant.create"), { id: "pt-1" })),
  },
  promise: {
    delete: vi.fn(async () => (calls.push("promise.delete"), { id: "old" })),
    create: vi.fn(async ({ data }: { data: { createdAt: Date } }) => {
      calls.push("promise.create");
      return { id: "p-new", createdAt: data.createdAt };
    }),
  },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("./pin", () => ({ hashPin: vi.fn(async () => "scrypt$hashed") }));

import { registerHost } from "./host-registration";

const TOKEN = "k3Zq8vTb1mRak3Zq8vTb1m";
const LINK = { id: "l-1", created_at: new Date("2026-11-04T10:00:00+09:00") };
const NOW = new Date("2026-11-04T12:00:00+09:00");
const INPUT = { nickname: "승주", pin: "4827" };
const MIN = 60_000;

function draft(createdAt: Date) {
  return {
    id: "old",
    status: "draft",
    created_at: createdAt,
    voting_deadline_at: null,
    confirmed_start_at: null,
  };
}

function queue(link: unknown, promise: unknown, now = NOW) {
  queryResults.push(link ? [link] : [], promise ? [promise] : [], [{ now }]);
}

describe("registerHost (MEMBER-API-02)", () => {
  beforeEach(() => {
    calls.length = 0;
    queryResults.length = 0;
    vi.clearAllMocks();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("형식이 다른 토큰은 트랜잭션을 열지 않고 not_found", async () => {
    expect(await registerHost("bad", INPUT)).toEqual({ kind: "not_found" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("없는 링크는 not_found이고 아무것도 만들지 않는다", async () => {
    queue(null, null);
    expect(await registerHost(TOKEN, INPUT)).toEqual({ kind: "not_found" });
    expect(calls).toEqual([]);
  });

  it("unclaimed면 draft 약속·방장·세션을 만든다", async () => {
    queue(LINK, null);

    const result = await registerHost(TOKEN, INPUT, { sessionToken: "fixed-token" });

    expect(result).toEqual({
      kind: "created",
      promiseId: "p-new",
      participantId: "pt-1",
      nickname: "승주",
      draftExpiresAt: new Date(NOW.getTime() + 10 * MIN),
      sessionToken: "fixed-token",
      sessionMaxAgeSeconds: 86400,
    });
    expect(calls).toEqual(["promise.create", "participant.create", "session.create"]);
    expect(tx.promise.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { promiseLinkId: "l-1", status: "draft", createdAt: NOW } }),
    );
    expect(tx.participant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          promiseId: "p-new",
          nickname: "승주",
          normalizedNickname: "승주",
          passwordHash: "scrypt$hashed",
          role: "host",
          status: "active",
        },
      }),
    );
    expect(tx.participantSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          participantId: "pt-1",
          sessionTokenHash: hashSessionToken("fixed-token"),
          expiresAt: new Date(NOW.getTime() + 24 * 60 * MIN),
        },
      }),
    );
  });

  it("링크 → 약속 순서로 FOR UPDATE 잠금 후 clock_timestamp()를 읽는다", async () => {
    queue(LINK, null);
    await registerHost(TOKEN, INPUT);

    const sql = tx.$queryRaw.mock.calls
      .map((c) => (c as unknown[])[0] as string[])
      .map((s) => s.join("?").replace(/\s+/g, " "));
    expect(sql[0]).toMatch(/FROM promise_links .*FOR UPDATE/);
    expect(sql[1]).toMatch(/FROM promises .*FOR UPDATE/);
    expect(sql[2]).toMatch(/clock_timestamp\(\)/);
  });

  it("10분 안의 draft가 있으면 409이고 아무것도 바꾸지 않는다", async () => {
    queue(LINK, draft(new Date(NOW.getTime() - 9 * MIN)));
    expect(await registerHost(TOKEN, INPUT)).toEqual({ kind: "already_registered" });
    expect(calls).toEqual([]);
  });

  it("취소된 링크에 방장 등록하면 cancelled(409 PROMISE_CANCELLED)이고 아무것도 바꾸지 않는다 (R-25)", async () => {
    queue(LINK, {
      ...draft(LINK.created_at),
      status: "cancelled",
      voting_deadline_at: new Date("2026-11-10T18:00:00+09:00"),
    });
    expect(await registerHost(TOKEN, INPUT)).toEqual({ kind: "cancelled" });
    expect(calls).toEqual([]);
  });

  it("취소된 draft(10분 지남)도 지우지 않고 cancelled", async () => {
    queue(LINK, { ...draft(new Date(NOW.getTime() - 30 * MIN)), status: "cancelled" });
    expect(await registerHost(TOKEN, INPUT)).toEqual({ kind: "cancelled" });
    expect(calls).toEqual([]);
  });

  it.each(["collecting", "closed", "confirmed"])("%s 약속이면 409", async (status) => {
    queue(LINK, {
      ...draft(LINK.created_at),
      status,
      voting_deadline_at: new Date("2026-11-10T18:00:00+09:00"),
      confirmed_start_at: status === "confirmed" ? new Date("2026-11-12T19:00:00+09:00") : null,
    });
    expect(await registerHost(TOKEN, INPUT)).toEqual({ kind: "already_registered" });
    expect(calls).toEqual([]);
  });

  it("10분 지난 draft는 세션 → 방장 → 약속 순서로 지운 뒤 새로 만든다", async () => {
    queue(LINK, draft(new Date(NOW.getTime() - 10 * MIN)));

    const result = await registerHost(TOKEN, INPUT);

    expect(result.kind).toBe("created");
    expect(calls).toEqual([
      "session.deleteMany",
      "participant.deleteMany",
      "promise.delete",
      "promise.create",
      "participant.create",
      "session.create",
    ]);
    expect(tx.participantSession.deleteMany).toHaveBeenCalledWith({
      where: { participant: { promiseId: "old" } },
    });
    expect(tx.promise.delete).toHaveBeenCalledWith({ where: { id: "old" } });
  });

  it("링크 발급 + 7일이 지나면 expired이고 아무것도 바꾸지 않는다", async () => {
    queue(LINK, null, new Date(LINK.created_at.getTime() + 7 * 24 * 60 * MIN));
    expect(await registerHost(TOKEN, INPUT)).toEqual({ kind: "expired" });
    expect(calls).toEqual([]);
  });

  it("promise_link_id UNIQUE 위반(P2002)은 409로 바꾼다", async () => {
    queue(LINK, null);
    tx.promise.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.10.0",
      }),
    );
    expect(await registerHost(TOKEN, INPUT)).toEqual({ kind: "already_registered" });
  });

  it("중간 단계가 실패하면 트랜잭션 콜백이 예외로 끝나 롤백되고 오류를 그대로 던진다", async () => {
    queue(LINK, null);
    const failure = new Error("session insert failed");
    tx.participantSession.create.mockRejectedValueOnce(failure);

    await expect(registerHost(TOKEN, INPUT)).rejects.toBe(failure);
    await expect(transaction.mock.results[0].value).rejects.toBe(failure);
  });
});
