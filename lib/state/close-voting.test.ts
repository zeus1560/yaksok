import { beforeEach, describe, expect, it, vi } from "vitest";

// 가짜 tx. $queryRaw는 약속 잠금 → 시각 순서로 응답을 꺼낸다
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
import { closeVoting } from "./close-voting";

const MIN = 60_000;
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-07T12:00:00.400+09:00");
const DEADLINE = new Date("2026-11-09T18:00:00+09:00");
const SESSION_EXPIRES = new Date(DEADLINE.getTime() + 7 * 24 * 60 * MIN);
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};

function queue(promise: { status?: string; voting_deadline_at?: Date | null } | null) {
  queryResults.push(
    promise ? [{ status: "collecting", voting_deadline_at: DEADLINE, ...promise }] : [],
    [{ now: NOW }],
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

describe("closeVoting (STATE-API-04)", () => {
  beforeEach(() => {
    calls.length = 0;
    queryResults.length = 0;
    vi.clearAllMocks();
    // 소비되지 않은 mockResolvedValueOnce가 다음 테스트로 넘어가지 않게 reset한다
    tx.participantSession.findUnique.mockReset().mockResolvedValue(sessionRow());
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("collecting이고 마감 전이면 closed로 바꾼다 (조기 마감, 세션·마감 시각은 그대로)", async () => {
    queue({});

    const result = await closeVoting(AUTH);

    expect(result).toEqual({
      kind: "ok",
      promiseStatus: "closed",
      changed: true,
      deadlineReached: false,
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = tx.$executeRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    expect(sql).toBe(
      "UPDATE promises SET status = 'closed' WHERE id = ?::uuid AND status = 'collecting'",
    );
    expect(values).toEqual([PROMISE_ID]);
  });

  it("이미 closed면 아무것도 바꾸지 않고 ok (인증 시점에는 collecting이었어도 잠금 후 값 기준)", async () => {
    queue({ status: "closed" });

    const result = await closeVoting(AUTH);

    expect(result).toEqual({
      kind: "ok",
      promiseStatus: "closed",
      changed: false,
      deadlineReached: false,
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("약속 행만 FOR UPDATE로 잠근 뒤 clock_timestamp()를 읽는다 (링크는 잠그지 않음)", async () => {
    queue({});
    await closeVoting(AUTH);
    const sql = tx.$queryRaw.mock.calls.map((c) =>
      (c[0] as unknown as string[]).join("?").replace(/\s+/g, " "),
    );
    expect(sql).toHaveLength(2);
    expect(sql[0]).toMatch(/FROM promises WHERE id = \?::uuid FOR UPDATE/);
    expect(sql[1]).toMatch(/clock_timestamp\(\)/);
    expect(sql.join(" ")).not.toMatch(/promise_links/);
    expect(calls).toEqual(["SELECT", "SELECT", "UPDATE"]);
  });

  it.each([
    ["정확히 마감 시각", 0],
    ["마감 1ms 뒤", 1],
    ["마감 하루 뒤", 24 * 60 * MIN],
  ])("마감이 지난 collecting(%s)도 closed로 저장, deadlineReached=true (공통 마감)", async (_n, after) => {
    queue({ voting_deadline_at: new Date(NOW.getTime() - after) });
    const result = await closeVoting(AUTH);
    expect(result).toMatchObject({ kind: "ok", changed: true, deadlineReached: true });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("마감 1ms 전이면 조기 마감(deadlineReached=false)", async () => {
    queue({ voting_deadline_at: new Date(NOW.getTime() + 1) });
    expect(await closeVoting(AUTH)).toMatchObject({ changed: true, deadlineReached: false });
  });

  it("세션 갱신·마감 시각·가능 시간·제출 기록·확정 시각을 건드리는 쿼리가 없다 (C-11 B안)", async () => {
    queue({});
    await closeVoting(AUTH);
    const all = [...tx.$queryRaw.mock.calls, ...tx.$executeRaw.mock.calls]
      .map((c) => (c[0] as unknown as string[]).join("?"))
      .join(" ");
    expect(all).not.toMatch(/participant_sessions|voting_deadline_at\s*=|available_slots|confirmed_start_at|availability/);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("잠금 후 약속이 없으면(만료 draft가 정리됨) not_found, 쿠키 삭제", async () => {
    queue(null);
    expect(await closeVoting(AUTH)).toEqual({
      kind: "not_found",
      session: { expiresAt: null, now: NOW },
    });
    expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
  });

  it("잠금 후 cancelled면 세션 재확인 전에 cancelled, 저장 없음", async () => {
    queue({ status: "cancelled" });
    expect(await closeVoting(AUTH)).toEqual({
      kind: "cancelled",
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("잠금 후 세션 행이 없으면 unauthenticated, 쿠키 삭제", async () => {
    queue({});
    tx.participantSession.findUnique.mockResolvedValueOnce(null);
    expect(await closeVoting(AUTH)).toEqual({
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
    expect((await closeVoting(AUTH)).kind).toBe("unauthenticated");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each(["collecting", "closed", "draft", "confirmed"])(
    "잠금 후 최신 역할이 member면 상태(%s)와 관계없이 forbidden, 저장 없음",
    async (status) => {
      queue({ status });
      tx.participantSession.findUnique.mockResolvedValueOnce(sessionRow({ role: "member" }));
      expect(await closeVoting(AUTH)).toEqual({
        kind: "forbidden",
        session: { expiresAt: SESSION_EXPIRES, now: NOW },
      });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it("인증 시점에는 member였어도 잠금 후 host로 승계됐으면 마감한다", async () => {
    queue({});
    const result = await closeVoting({ ...AUTH, participant: { id: "pt-1", role: "member" } });
    expect(result.kind).toBe("ok");
  });

  it.each([
    ["draft", { status: "draft", voting_deadline_at: null }],
    ["confirmed", { status: "confirmed" }],
  ])("%s → invalid_state, 저장·삭제 없음", async (status, row) => {
    queue(row);
    expect(await closeVoting(AUTH)).toEqual({
      kind: "invalid_state",
      promiseStatus: status,
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("쿠키는 잠금 후 다시 읽은 세션 expires_at 기준", async () => {
    const reread = new Date(SESSION_EXPIRES.getTime() - MIN);
    queue({});
    tx.participantSession.findUnique.mockResolvedValueOnce(sessionRow({ expiresAt: reread }));
    expect((await closeVoting(AUTH)).session).toEqual({ expiresAt: reread, now: NOW });
  });

  it("마감 시각이 없는 collecting은 데이터 오류로 던진다 (롤백)", async () => {
    queue({ voting_deadline_at: null });
    await expect(closeVoting(AUTH)).rejects.toThrow("마감 시각이 없는 collecting 약속");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("저장 중 오류는 그대로 던져 롤백된다", async () => {
    queue({});
    const failure = new Error("update failed");
    tx.$executeRaw.mockRejectedValueOnce(failure);
    await expect(closeVoting(AUTH)).rejects.toBe(failure);
  });
});
