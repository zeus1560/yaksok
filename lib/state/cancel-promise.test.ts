import { beforeEach, describe, expect, it, vi } from "vitest";

// 가짜 tx. $queryRaw는 약속 잠금 → 시각 → (세션 만료 UPDATE ... RETURNING) 순서로 응답을 꺼낸다
const calls: string[] = [];
const queryResults: unknown[][] = [];
const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    calls.push(strings.join("?").replace(/\s+/g, " ").trim().split(" ")[0]);
    return queryResults.shift() ?? [];
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
    calls.push(strings.join("?").replace(/\s+/g, " ").trim().split(" ")[0]);
    return 1;
  }),
  participantSession: { findUnique: vi.fn() },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { cancelPromise } from "./cancel-promise";

const MIN = 60_000;
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-08T12:00:00.400+09:00");
const CREATED = new Date("2026-11-01T10:00:00+09:00");
const SESSION_EXPIRES = new Date("2026-11-16T18:00:00+09:00");
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};

function queue(
  promise: { status?: string; created_at?: Date } | null,
  expired: { id: string }[] = [{ id: "s-1" }, { id: "s-2" }],
) {
  queryResults.push(
    promise ? [{ status: "collecting", created_at: CREATED, ...promise }] : [],
    [{ now: NOW }],
    expired,
  );
}

function sessionRow(
  over: { expiresAt?: Date; role?: string; status?: string; promiseId?: string; id?: string } = {},
) {
  return {
    expiresAt: over.expiresAt ?? SESSION_EXPIRES,
    participant: {
      id: over.id ?? "pt-1",
      promiseId: over.promiseId ?? PROMISE_ID,
      role: over.role ?? "host",
      status: over.status ?? "active",
    },
  };
}

function sqlTexts() {
  return [...tx.$queryRaw.mock.calls, ...tx.$executeRaw.mock.calls].map((c) =>
    (c[0] as unknown as string[]).join("?").replace(/\s+/g, " ").trim(),
  );
}

describe("cancelPromise (STATE-API-07)", () => {
  beforeEach(() => {
    calls.length = 0;
    queryResults.length = 0;
    vi.clearAllMocks();
    tx.participantSession.findUnique.mockReset().mockResolvedValue(sessionRow());
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("collecting이면 cancelled로 바꾸고 모든 세션을 만료한다", async () => {
    queue({});

    const result = await cancelPromise(AUTH);

    expect(result).toEqual({
      kind: "ok",
      promiseStatus: "cancelled",
      cancelledAt: NOW,
      session: { expiresAt: NOW, now: NOW },
    });
    const update = tx.$executeRaw.mock.calls.map(
      (c) => c as unknown as [string[], ...unknown[]],
    );
    expect(update).toHaveLength(1);
    expect(update[0][0].join("?").replace(/\s+/g, " ").trim()).toBe(
      "UPDATE promises SET status = 'cancelled', cancelled_at = ? WHERE id = ?::uuid AND status <> 'cancelled'",
    );
    expect(update[0].slice(1)).toEqual([NOW, PROMISE_ID]);
    const expire = sqlTexts().find((sql) => sql.startsWith("UPDATE participant_sessions"));
    expect(expire).toBeDefined();
    expect(expire).not.toMatch(/p\.status/);
  });

  it("참여자의 role·status·cancelled_at과 슬롯·제출 기록·확정 시각은 바꾸지 않는다", async () => {
    queue({ status: "confirmed" });

    const result = await cancelPromise(AUTH);

    expect(result.kind).toBe("ok");
    const all = sqlTexts().join(" ");
    expect(all).not.toMatch(/UPDATE participants\b|DELETE|participant_available_slots|confirmed_start_at|availability/);
    expect(all).toMatch(/UPDATE promises SET status = 'cancelled'/);
  });

  it.each([
    ["draft(10분 이내)", { status: "draft", created_at: new Date(NOW.getTime() - 10 * MIN + 1) }],
    ["collecting", { status: "collecting" }],
    ["closed", { status: "closed" }],
    ["confirmed", { status: "confirmed" }],
  ])("%s → cancelled 저장, 쿠키는 즉시 만료", async (_n, row) => {
    queue(row);
    expect(await cancelPromise(AUTH)).toEqual({
      kind: "ok",
      promiseStatus: "cancelled",
      cancelledAt: NOW,
      session: { expiresAt: NOW, now: NOW },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("마감이 지난 collecting도 closed를 거치지 않고 cancelled 한 번만 저장한다", async () => {
    queue({ status: "collecting" });
    await cancelPromise(AUTH);
    expect(sqlTexts().join(" ")).not.toMatch(/'closed'/);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("약속 행만 FOR UPDATE로 잠근 뒤 clock_timestamp() → 저장 → 세션 만료 순서 (링크는 잠그지 않음)", async () => {
    queue({});
    await cancelPromise(AUTH);
    const sql = tx.$queryRaw.mock.calls.map((c) =>
      (c[0] as unknown as string[]).join("?").replace(/\s+/g, " "),
    );
    expect(sql[0]).toMatch(/FROM promises WHERE id = \?::uuid FOR UPDATE/);
    expect(sql[1]).toMatch(/clock_timestamp\(\)/);
    expect(sql.join(" ")).not.toMatch(/promise_links/);
    expect(calls).toEqual(["SELECT", "SELECT", "UPDATE", "UPDATE"]);
  });

  it("세션 만료는 판정 시각과 같은 값, 참여자 상태와 관계없이 이 약속의 유효 세션 전부", async () => {
    queue({});
    await cancelPromise(AUTH);
    const [strings, ...values] = tx.$queryRaw.mock.calls[2] as unknown as [string[], ...unknown[]];
    const sql = strings.join("?").replace(/\s+/g, " ");
    expect(sql).toMatch(/UPDATE participant_sessions AS s SET expires_at = \?/);
    expect(sql).toMatch(/p\.promise_id = \?::uuid/);
    expect(sql).toMatch(/s\.expires_at > \?/);
    expect(sql).not.toMatch(/DELETE/);
    expect(values).toEqual([NOW, PROMISE_ID, NOW]);
  });

  it.each([
    ["정확히 10분", 10 * MIN],
    ["10분 1ms", 10 * MIN + 1],
    ["하루", 24 * 60 * MIN],
  ])("draft 생성 후 %s 지났으면 draft_expired, 저장·삭제·세션 변경 없음", async (_n, ago) => {
    queue({ status: "draft", created_at: new Date(NOW.getTime() - ago) });
    expect(await cancelPromise(AUTH)).toEqual({
      kind: "draft_expired",
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(calls).toEqual(["SELECT", "SELECT"]);
  });

  it("10분 지나도 draft가 아니면 만료 판정을 하지 않는다", async () => {
    queue({ status: "closed", created_at: new Date(NOW.getTime() - 30 * 24 * 60 * MIN) });
    expect((await cancelPromise(AUTH)).kind).toBe("ok");
  });

  it("잠금 후 약속이 없으면(만료 draft가 정리됨) not_found, 쿠키 삭제", async () => {
    queue(null);
    expect(await cancelPromise(AUTH)).toEqual({
      kind: "not_found",
      session: { expiresAt: null, now: NOW },
    });
    expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
  });

  it("잠금 후 이미 cancelled면(병렬 취소의 두 번째) 세션 재확인 전에 cancelled, 저장 없음", async () => {
    queue({ status: "cancelled" });
    expect(await cancelPromise(AUTH)).toEqual({
      kind: "cancelled",
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(calls).toEqual(["SELECT", "SELECT"]);
  });

  it("잠금 후 세션 행이 없으면 unauthenticated, 쿠키 삭제", async () => {
    queue({});
    tx.participantSession.findUnique.mockResolvedValueOnce(null);
    expect(await cancelPromise(AUTH)).toEqual({
      kind: "unauthenticated",
      session: { expiresAt: null, now: NOW },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    ["세션 만료(판정 시각과 같음)", { expiresAt: NOW }],
    ["탈퇴한 참여자", { status: "cancelled" }],
    ["다른 약속 참여자", { promiseId: "00000000-0000-4000-8000-000000000000" }],
    ["다른 참여자로 바뀜", { id: "pt-2" }],
  ])("잠금 후 %s → unauthenticated, 저장 없음", async (_n, over) => {
    queue({});
    tx.participantSession.findUnique.mockResolvedValueOnce(sessionRow(over));
    expect((await cancelPromise(AUTH)).kind).toBe("unauthenticated");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each(["draft", "collecting", "closed", "confirmed"])(
    "잠금 후 최신 역할이 member면 상태(%s)와 관계없이 forbidden, 저장 없음",
    async (status) => {
      queue({ status });
      tx.participantSession.findUnique.mockResolvedValueOnce(sessionRow({ role: "member" }));
      expect(await cancelPromise(AUTH)).toEqual({
        kind: "forbidden",
        session: { expiresAt: SESSION_EXPIRES, now: NOW },
      });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it("인증 시점에는 member였어도 잠금 후 host로 승계됐으면 취소한다", async () => {
    queue({});
    const result = await cancelPromise({ ...AUTH, participant: { id: "pt-1", role: "member" } });
    expect(result.kind).toBe("ok");
  });

  it("거절 응답의 쿠키는 잠금 후 다시 읽은 세션 expires_at 기준", async () => {
    const reread = new Date(SESSION_EXPIRES.getTime() - MIN);
    queue({});
    tx.participantSession.findUnique.mockResolvedValueOnce(sessionRow({ expiresAt: reread, role: "member" }));
    expect((await cancelPromise(AUTH)).session).toEqual({ expiresAt: reread, now: NOW });
  });

  it("세션 만료 중 오류는 그대로 던져 약속 취소도 롤백된다", async () => {
    queue({});
    const failure = new Error("expire failed");
    tx.$queryRaw.mockImplementationOnce(async () => [{ status: "collecting", created_at: CREATED }])
      .mockImplementationOnce(async () => [{ now: NOW }])
      .mockRejectedValueOnce(failure);
    await expect(cancelPromise(AUTH)).rejects.toBe(failure);
  });
});
