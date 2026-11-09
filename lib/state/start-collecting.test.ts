import { beforeEach, describe, expect, it, vi } from "vitest";

// 가짜 tx. $queryRaw는 링크 잠금 → 약속 잠금 → 시각 → (세션 갱신) 순서로 응답을 꺼낸다
const calls: string[] = [];
const queryResults: unknown[][] = [];
const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    calls.push(strings.join("?").replace(/\s+/g, " ").trim().split(" ")[0]);
    return queryResults.shift() ?? [];
  }),
  participant: {
    count: vi.fn(async () => 1),
    deleteMany: vi.fn(async () => (calls.push("participant.deleteMany"), { count: 1 })),
  },
  participantSession: {
    findUnique: vi.fn(),
    deleteMany: vi.fn(async () => (calls.push("session.deleteMany"), { count: 1 })),
  },
  promise: {
    delete: vi.fn(async () => (calls.push("promise.delete"), { id: "p-1" })),
    update: vi.fn(async () => (calls.push("promise.update"), { id: "p-1" })),
  },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { startCollecting } from "./start-collecting";
import { parseStartSettings } from "./start-settings";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-04T12:00:00.400+09:00");
const SESSION_EXPIRES = new Date(NOW.getTime() + 20 * 60 * MIN);
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "draft", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};
const INPUT = parseStartSettings({
  participantLimit: 8,
  dateRange: { startDate: "2026-11-10", endDate: "2026-11-20" },
  dailyTimeRange: { startTime: "23:00", endTime: "24:00" },
  durationMinutes: 60,
  votingDeadlineAt: "2026-11-09T18:00:00+09:00",
})!;
const DEADLINE = new Date("2026-11-09T18:00:00+09:00");

function queue(promise: { status?: string; created_at?: Date } | null, extended: string[] = []) {
  queryResults.push(
    [{ id: "l-1" }],
    promise
      ? [
          {
            id: PROMISE_ID,
            status: "draft",
            created_at: new Date(NOW.getTime() - 5 * MIN),
            ...promise,
          },
        ]
      : [],
    [{ now: NOW }],
    extended.map((id) => ({ id })),
  );
}

// 잠금 후 다시 읽은 요청자 세션 행 (participantSession.findUnique 결과)
function lockedSession(
  overrides: {
    expiresAt?: Date;
    id?: string;
    promiseId?: string;
    role?: string;
    status?: string;
  } = {},
) {
  return {
    expiresAt: overrides.expiresAt ?? SESSION_EXPIRES,
    participant: {
      id: overrides.id ?? "pt-1",
      promiseId: overrides.promiseId ?? PROMISE_ID,
      role: overrides.role ?? "host",
      status: overrides.status ?? "active",
    },
  };
}

describe("startCollecting 잠금 후 세션·참여자 재확인 (R-31·R-22 정렬)", () => {
  beforeEach(() => {
    calls.length = 0;
    queryResults.length = 0;
    vi.clearAllMocks();
    tx.participantSession.findUnique.mockResolvedValue(lockedSession());
    tx.participant.count.mockResolvedValue(1);
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("잠금 후 세션이 삭제됐으면(로그아웃과 겹침) 설정 완료는 unauthenticated이고 쿠키를 다시 심지 않는다", async () => {
    queue({}, ["s-1"]);
    tx.participantSession.findUnique.mockResolvedValueOnce(null);

    const result = await startCollecting(AUTH, INPUT);

    expect(result).toEqual({ kind: "unauthenticated", session: { expiresAt: null, now: NOW } });
    expect(tx.participantSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s-1" } }),
    );
    expect(tx.promise.update).not.toHaveBeenCalled();
    expect(calls).not.toContain("UPDATE");
  });

  it("잠금 후 세션이 만료됐으면(경계: expires_at = 판정 시각) unauthenticated, 저장 없음", async () => {
    queue({}, ["s-1"]);
    tx.participantSession.findUnique.mockResolvedValueOnce(lockedSession({ expiresAt: NOW }));

    expect(await startCollecting(AUTH, INPUT)).toEqual({
      kind: "unauthenticated",
      session: { expiresAt: NOW, now: NOW },
    });
    expect(tx.promise.update).not.toHaveBeenCalled();
  });

  it("잠금 후 참여자가 cancelled면 403이 아니라 다른 쓰기 API와 같은 unauthenticated(401)", async () => {
    queue({}, ["s-1"]);
    tx.participantSession.findUnique.mockResolvedValueOnce(lockedSession({ status: "cancelled" }));

    expect((await startCollecting(AUTH, INPUT)).kind).toBe("unauthenticated");
    expect(tx.promise.update).not.toHaveBeenCalled();
  });

  it("잠금 후 세션이 다른 참여자·다른 약속 소속이면 unauthenticated", async () => {
    queue({}, ["s-1"]);
    tx.participantSession.findUnique.mockResolvedValueOnce(lockedSession({ promiseId: "other" }));
    expect((await startCollecting(AUTH, INPUT)).kind).toBe("unauthenticated");
  });

  it("잠금 후 최신 role이 member면 forbidden이고 쿠키는 다시 읽은 세션 기준", async () => {
    queue({}, ["s-1"]);
    const later = new Date(SESSION_EXPIRES.getTime() + MIN);
    tx.participantSession.findUnique.mockResolvedValueOnce(
      lockedSession({ role: "member", expiresAt: later }),
    );

    expect(await startCollecting(AUTH, INPUT)).toEqual({
      kind: "forbidden",
      session: { expiresAt: later, now: NOW },
    });
  });
});

describe("startCollecting (STATE-API-02)", () => {
  beforeEach(() => {
    calls.length = 0;
    queryResults.length = 0;
    vi.clearAllMocks();
    tx.participantSession.findUnique.mockResolvedValue(lockedSession());
    tx.participant.count.mockResolvedValue(1);
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("링크 → 약속 순서로 FOR UPDATE 후 clock_timestamp()를 읽는다", async () => {
    queue({}, ["s-1"]);
    await startCollecting(AUTH, INPUT);
    const sql = tx.$queryRaw.mock.calls.map((c) =>
      (c[0] as unknown as string[]).join("?").replace(/\s+/g, " "),
    );
    expect(sql[0]).toMatch(/FROM promise_links .*FOR UPDATE/);
    expect(sql[1]).toMatch(/FROM promises .*FOR UPDATE/);
    expect(sql[2]).toMatch(/clock_timestamp\(\)/);
  });

  it("성공: 설정·collecting·분 값(1440)을 한 번에 저장하고 active 유효 세션만 마감 + 7일로 갱신", async () => {
    queue({}, ["s-1", "s-2"]);

    const result = await startCollecting(AUTH, INPUT);

    expect(result).toEqual({
      kind: "ok",
      settings: INPUT,
      session: { expiresAt: new Date(DEADLINE.getTime() + 7 * DAY), now: NOW },
    });
    expect(tx.promise.update).toHaveBeenCalledWith({
      where: { id: PROMISE_ID },
      data: {
        participantLimit: 8,
        dateRangeStart: new Date("2026-11-10T00:00:00Z"),
        dateRangeEnd: new Date("2026-11-20T00:00:00Z"),
        dailyStartMinute: 1380,
        dailyEndMinute: 1440,
        durationMinutes: 60,
        votingDeadlineAt: DEADLINE,
        status: "collecting",
      },
      select: { id: true },
    });

    const [strings, ...values] = tx.$queryRaw.mock.calls[3] as unknown as [string[], ...unknown[]];
    const sql = strings.join("?").replace(/\s+/g, " ");
    expect(sql).toMatch(/UPDATE participant_sessions/);
    expect(sql).toMatch(/p\.status = 'active'/);
    expect(sql).toMatch(/s\.expires_at > \?/);
    expect(values).toEqual([new Date(DEADLINE.getTime() + 7 * DAY), PROMISE_ID, NOW]);
    expect(calls).toEqual(["SELECT", "SELECT", "SELECT", "promise.update", "UPDATE"]);
  });

  it("요청자 세션이 잠금 사이에 만료돼 갱신되지 않았으면 쿠키는 원래 만료 기준", async () => {
    queue({}, ["s-2"]);
    const result = await startCollecting(AUTH, INPUT);
    expect(result.session).toEqual({ expiresAt: SESSION_EXPIRES, now: NOW });
  });

  it("잠금 후 약속이 없으면(다른 요청이 정리) not_found, 쿠키 삭제", async () => {
    queue(null);
    expect(await startCollecting(AUTH, INPUT)).toEqual({
      kind: "not_found",
      session: { expiresAt: null, now: NOW },
    });
  });

  it("잠금 후 cancelled → cancelled, 저장 없음", async () => {
    queue({ status: "cancelled" });
    expect((await startCollecting(AUTH, INPUT)).kind).toBe("cancelled");
    expect(tx.promise.update).not.toHaveBeenCalled();
  });

  // host·cancelled는 2026-11-10부터 forbidden이 아니라 unauthenticated(401)다 (R-22 정렬, 위 describe)
  it.each([
    ["member", "active", "forbidden"],
    ["host", "cancelled", "unauthenticated"],
  ])("잠금 후 최신 role=%s·status=%s → %s, 저장 없음", async (role, status, kind) => {
    queue({});
    tx.participantSession.findUnique.mockResolvedValueOnce(lockedSession({ role, status }));
    expect((await startCollecting(AUTH, INPUT)).kind).toBe(kind);
    expect(tx.promise.update).not.toHaveBeenCalled();
  });

  it("방장이 아니면 만료 draft여도 삭제하지 않고 forbidden", async () => {
    queue({ created_at: new Date(NOW.getTime() - 10 * MIN) });
    tx.participantSession.findUnique.mockResolvedValueOnce(lockedSession({ role: "member" }));
    expect((await startCollecting(AUTH, INPUT)).kind).toBe("forbidden");
    expect(calls).not.toContain("promise.delete");
  });

  it.each(["collecting", "closed", "confirmed"])(
    "%s(재요청 포함) → invalid_state",
    async (status) => {
      queue({ status });
      expect(await startCollecting(AUTH, INPUT)).toEqual({
        kind: "invalid_state",
        promiseStatus: status,
        session: { expiresAt: SESSION_EXPIRES, now: NOW },
      });
      expect(tx.promise.update).not.toHaveBeenCalled();
    },
  );

  it("draft 10분 경계: 1ms 전은 진행", async () => {
    queue({ created_at: new Date(NOW.getTime() - 10 * MIN + 1) }, ["s-1"]);
    expect((await startCollecting(AUTH, INPUT)).kind).toBe("ok");
  });

  it("정확히 10분 지난 draft는 세션 → 방장 → 약속 순서로 지우고 draft_expired를 정상 반환(커밋)한다", async () => {
    queue({ created_at: new Date(NOW.getTime() - 10 * MIN) });

    const result = await startCollecting(AUTH, INPUT);

    expect(result).toEqual({ kind: "draft_expired", session: { expiresAt: null, now: NOW } });
    expect(calls.slice(3)).toEqual([
      "session.deleteMany",
      "participant.deleteMany",
      "promise.delete",
    ]);
    expect(tx.participantSession.deleteMany).toHaveBeenCalledWith({
      where: { participant: { promiseId: PROMISE_ID } },
    });
    expect(tx.promise.delete).toHaveBeenCalledWith({ where: { id: PROMISE_ID } });
    // 콜백이 예외 없이 끝나야 $transaction이 커밋한다. 410이라고 롤백되면 안 된다
    await expect(transaction.mock.results[0].value).resolves.toEqual(result);
    expect(tx.promise.update).not.toHaveBeenCalled();
  });

  it("규칙 위반이면 아무것도 저장하지 않고 validation_failed", async () => {
    queue({});
    tx.participant.count.mockResolvedValueOnce(9); // 정원 8 < active 9
    expect(await startCollecting(AUTH, INPUT)).toEqual({
      kind: "validation_failed",
      violation: {
        field: "participantLimit",
        message: expect.any(String),
        code: "CAPACITY_BELOW_ACTIVE_COUNT", // 라우트는 STATE-API-02에서 이 값을 보지 않고 VALIDATION_FAILED로 응답
      },
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.promise.update).not.toHaveBeenCalled();
    expect(calls).not.toContain("UPDATE");
  });

  it("마감 판정은 잠금 후 DB 시각 기준이다 (인증 시각이 아니라)", async () => {
    const late = new Date(DEADLINE.getTime()); // 잠금 대기 중 마감 시각에 도달
    queryResults.push(
      [{ id: "l-1" }],
      [{ id: PROMISE_ID, status: "draft", created_at: new Date(late.getTime() - MIN) }],
      [{ now: late }],
    );
    // 세션은 판정 시각보다 뒤에 만료된다(재확인 통과). 마감 검증만 실패해야 한다
    tx.participantSession.findUnique.mockResolvedValueOnce(
      lockedSession({ expiresAt: new Date(late.getTime() + DAY) }),
    );
    const result = await startCollecting(AUTH, INPUT);
    expect(result.kind).toBe("validation_failed");
  });

  it("저장 중 오류는 그대로 던져 롤백된다", async () => {
    queue({});
    const failure = new Error("update failed");
    tx.promise.update.mockRejectedValueOnce(failure);
    await expect(startCollecting(AUTH, INPUT)).rejects.toBe(failure);
  });
});
