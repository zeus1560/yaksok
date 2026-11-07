import { describe, expect, it, vi } from "vitest";
import { expireAllSessions, refreshActiveSessions } from "./session-expiry";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const LINK_CREATED = new Date("2026-11-01T10:00:00+09:00");
const NOW = new Date("2026-11-06T12:00:00.400+09:00");
const DEADLINE = new Date("2026-11-05T18:00:00+09:00");

type Tx = Parameters<typeof refreshActiveSessions>[0];

function fakeTx(rows: { id: string }[]) {
  const $queryRaw = vi.fn(async () => rows);
  return { tx: { $queryRaw } as unknown as Tx, $queryRaw };
}

function sqlOf({ $queryRaw }: ReturnType<typeof fakeTx>) {
  const [strings, ...values] = $queryRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
  return { sql: strings.join("?").replace(/\s+/g, " "), values };
}

describe("refreshActiveSessions (API_CONVENTIONS 5.2)", () => {
  it("모집 시작 새 상태(collecting)면 마감 + 7일로, active·유효 세션만 갱신한다", async () => {
    const fake = fakeTx([{ id: "s-1" }, { id: "s-2" }]);
    const result = await refreshActiveSessions(fake.tx, {
      promiseId: PROMISE_ID,
      link: {
        createdAt: LINK_CREATED,
        promise: { status: "collecting", votingDeadlineAt: DEADLINE, confirmedStartAt: null },
      },
      now: NOW,
    });

    const expiresAt = new Date("2026-11-12T18:00:00+09:00");
    expect(result).toEqual({ expiresAt, sessionIds: ["s-1", "s-2"] });
    const { sql, values } = sqlOf(fake);
    expect(sql).toMatch(/UPDATE participant_sessions AS s SET expires_at = \?/);
    expect(sql).toMatch(/p\.promise_id = \?::uuid/);
    expect(sql).toMatch(/p\.status = 'active'/);
    expect(sql).toMatch(/s\.expires_at > \?/);
    expect(values).toEqual([expiresAt, PROMISE_ID, NOW]);
  });

  it("확정 새 상태(confirmed)면 confirmed_start_at + 7일 (C-10 잠정, STATE-API-05용)", async () => {
    const fake = fakeTx([]);
    const start = new Date("2026-11-20T19:00:00+09:00");
    const result = await refreshActiveSessions(fake.tx, {
      promiseId: PROMISE_ID,
      link: {
        createdAt: LINK_CREATED,
        promise: { status: "confirmed", votingDeadlineAt: DEADLINE, confirmedStartAt: start },
      },
      now: NOW,
    });

    expect(result).toEqual({ expiresAt: new Date("2026-11-27T19:00:00+09:00"), sessionIds: [] });
    expect(sqlOf(fake).values[0]).toEqual(new Date("2026-11-27T19:00:00+09:00"));
  });
});

describe("expireAllSessions (STATE-API-07, 08 재사용 예정)", () => {
  it("이 약속의 유효 세션을 참여자 상태와 관계없이 now로 만료한다. 행은 지우지 않는다", async () => {
    const fake = fakeTx([{ id: "s-1" }, { id: "s-3" }]);
    const result = await expireAllSessions(fake.tx, { promiseId: PROMISE_ID, now: NOW });

    expect(result).toEqual({ sessionIds: ["s-1", "s-3"] });
    const { sql, values } = sqlOf(fake);
    expect(sql).toMatch(/UPDATE participant_sessions AS s SET expires_at = \?/);
    expect(sql).toMatch(/p\.promise_id = \?::uuid/);
    expect(sql).toMatch(/s\.expires_at > \?/);
    expect(sql).not.toMatch(/p\.status|DELETE/);
    expect(values).toEqual([NOW, PROMISE_ID, NOW]);
  });
});
