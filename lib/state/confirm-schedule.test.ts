import { beforeEach, describe, expect, it, vi } from "vitest";

// 가짜 tx. $queryRaw는 약속 잠금 → 시각 → (확정 시) 세션 갱신 순서로 응답을 꺼낸다
const queryResults: unknown[][] = [];
const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    void strings;
    return queryResults.shift() ?? [];
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
    void strings;
    return 1;
  }),
  participantSession: { findUnique: vi.fn() },
  participant: { findMany: vi.fn() },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { confirmSchedule } from "./confirm-schedule";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-07T12:00:00.400+09:00");
const DEADLINE = new Date("2026-11-07T10:00:00+09:00");
const LINK_CREATED = new Date("2026-11-01T09:00:00+09:00");
const SESSION_EXPIRES = new Date(DEADLINE.getTime() + 7 * DAY);
const SUBMITTED = new Date("2026-11-06T20:00:00+09:00");
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "closed", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};

const at = (s: string) => new Date(s);
// 2026-11-10 하루 10:00~12:00, 60분 약속
function lockedRow(over: Record<string, unknown> = {}) {
  return {
    status: "closed",
    voting_deadline_at: DEADLINE,
    date_range_start: "2026-11-10",
    date_range_end: "2026-11-11",
    daily_start_minute: 10 * 60,
    daily_end_minute: 12 * 60,
    duration_minutes: 60,
    link_created_at: LINK_CREATED,
    ...over,
  };
}

function person(...times: string[]) {
  return {
    status: "active",
    availabilitySubmittedAt: SUBMITTED,
    availableSlots: times.map((t) => ({ slotStartAt: at(`2026-11-10T${t}:00+09:00`) })),
  };
}

function sessionRow(over: { role?: string; status?: string; expiresAt?: Date } = {}) {
  return {
    expiresAt: over.expiresAt ?? SESSION_EXPIRES,
    participant: {
      id: "pt-1",
      promiseId: PROMISE_ID,
      role: over.role ?? "host",
      status: over.status ?? "active",
    },
  };
}

function prepare(row: Record<string, unknown> | null, refreshed: { id: string }[] = [{ id: "s-1" }]) {
  queryResults.push(row ? [row] : [], [{ now: NOW }], refreshed);
}

const sqlOf = (call: unknown) => {
  const [strings, ...values] = call as [string[], ...unknown[]];
  return { sql: strings.join("?").replace(/\s+/g, " ").trim(), values };
};

describe("confirmSchedule (STATE-API-05)", () => {
  beforeEach(() => {
    queryResults.length = 0;
    vi.clearAllMocks();
    tx.participantSession.findUnique.mockReset().mockResolvedValue(sessionRow());
    tx.participant.findMany
      .mockReset()
      .mockResolvedValue([person("10:00", "10:30"), person("10:00", "10:30"), person("11:00")]);
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("closed이고 유효 후보면 confirmed로 저장한다", async () => {
    prepare(lockedRow());
    const startAt = at("2026-11-10T10:00:00+09:00");

    const result = await confirmSchedule(AUTH, startAt);

    const refreshedExpiry = new Date(startAt.getTime() + 7 * DAY);
    expect(result).toEqual({
      kind: "ok",
      startAt,
      endAt: at("2026-11-10T11:00:00+09:00"),
      session: { expiresAt: refreshedExpiry, now: NOW },
    });
    const updates = tx.$executeRaw.mock.calls.map((call) => sqlOf(call));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(
      /UPDATE promises SET status = 'confirmed', confirmed_start_at = \? WHERE id = \?::uuid AND status = 'closed'/,
    );
    expect(updates[0].values).toEqual([startAt, PROMISE_ID]);
  });

  it("공통 가능 1명인 시작점은 422 (저장 없음)", async () => {
    prepare(lockedRow());

    const result = await confirmSchedule(AUTH, at("2026-11-10T11:00:00+09:00"));

    expect(result).toEqual({
      kind: "invalid_candidate",
      reason: "too_few_participants",
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("잠금은 promises 행만(FOR UPDATE OF p), 판정 시각은 잠금 뒤 clock_timestamp()", async () => {
    prepare(lockedRow());
    await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"));
    const lock = sqlOf(tx.$queryRaw.mock.calls[0]);
    expect(lock.sql).toMatch(/FROM promises AS p JOIN promise_links AS l/);
    expect(lock.sql).toMatch(/FOR UPDATE OF p$/);
    expect(lock.values).toEqual([PROMISE_ID]);
    expect(sqlOf(tx.$queryRaw.mock.calls[1]).sql).toBe("SELECT clock_timestamp() AS now");
  });

  it("확정과 같은 트랜잭션에서 active 참여자의 유효 세션만 confirmed_start_at + 7일로 갱신한다 (C-10 잠정 A안)", async () => {
    prepare(lockedRow(), [{ id: "s-9" }, { id: "s-1" }]);
    const startAt = at("2026-11-10T10:00:00+09:00");
    await confirmSchedule(AUTH, startAt);

    const refresh = sqlOf(tx.$queryRaw.mock.calls[2]);
    expect(refresh.sql).toMatch(/UPDATE participant_sessions AS s SET expires_at = \?/);
    expect(refresh.sql).toMatch(/p\.status = 'active'/);
    expect(refresh.sql).toMatch(/s\.expires_at > \?/);
    expect(refresh.values).toEqual([new Date(startAt.getTime() + 7 * DAY), PROMISE_ID, NOW]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("요청자 세션이 갱신 대상에 없으면 쿠키는 기존 만료 기준", async () => {
    prepare(lockedRow(), [{ id: "s-other" }]);
    const result = await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"));
    expect(result.session).toEqual({ expiresAt: SESSION_EXPIRES, now: NOW });
  });

  it("집계 대상(active·제출 완료)만 읽고, 제출 상태·슬롯은 건드리지 않는다", async () => {
    prepare(lockedRow());
    await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"));
    expect(tx.participant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { promiseId: PROMISE_ID, status: "active", availabilitySubmittedAt: { not: null } },
      }),
    );
    const sql = tx.$executeRaw.mock.calls.map((call) => sqlOf(call).sql).join(" ");
    expect(sql).not.toMatch(/participant_available_slots|availability_submitted_at|availability_version/);
  });

  it("상위 5개 밖이어도 유효 후보면 확정한다 (처리 순서 6)", async () => {
    // 30분 약속, 10:00~12:00. 3명 공통 칸 3개 + 2명 공통 칸 1개 + 다음 날 3명 공통 칸 3개 → 11:30 2명은 7위
    const day2 = (...times: string[]) =>
      times.map((t) => ({ slotStartAt: at(`2026-11-11T${t}:00+09:00`) }));
    const withDay2 = (p: ReturnType<typeof person>, ...times: string[]) => ({
      ...p,
      availableSlots: [...p.availableSlots, ...day2(...times)],
    });
    tx.participant.findMany.mockResolvedValue([
      withDay2(person("10:00", "10:30", "11:00", "11:30"), "10:00", "10:30", "11:00"),
      withDay2(person("10:00", "10:30", "11:00", "11:30"), "10:00", "10:30", "11:00"),
      withDay2(person("10:00", "10:30", "11:00"), "10:00", "10:30", "11:00"),
    ]);
    prepare(lockedRow({ duration_minutes: 30 }));

    const result = await confirmSchedule(AUTH, at("2026-11-10T11:30:00+09:00"));

    expect(result).toMatchObject({ kind: "ok", endAt: at("2026-11-10T12:00:00+09:00") });
  });

  it.each([
    ["지난 시각", "2026-11-07T11:30:00+09:00", "not_future"],
    ["30분 경계 아님", "2026-11-10T10:15:00+09:00", "not_slot_boundary"],
    ["날짜 범위 밖", "2026-11-12T10:00:00+09:00", "out_of_date_range"],
    ["하루 범위를 넘는 구간", "2026-11-10T11:30:00+09:00", "out_of_daily_range"],
    ["공통 가능 1명", "2026-11-10T11:00:00+09:00", "too_few_participants"],
  ])("%s → invalid_candidate(%s), 저장 없음", async (_n, start, reason) => {
    prepare(lockedRow());
    const result = await confirmSchedule(AUTH, at(start));
    expect(result).toEqual({
      kind: "invalid_candidate",
      reason,
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("마감 지난 collecting(판정 시각 = 마감)은 closed를 먼저 저장하고 이어서 확정한다", async () => {
    prepare(lockedRow({ status: "collecting", voting_deadline_at: NOW }));
    const result = await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"));

    expect(result.kind).toBe("ok");
    const sql = tx.$executeRaw.mock.calls.map((call) => sqlOf(call).sql);
    expect(sql).toHaveLength(2);
    expect(sql[0]).toMatch(
      /UPDATE promises SET status = 'closed' WHERE id = \?::uuid AND status = 'collecting'/,
    );
    expect(sql[1]).toMatch(/SET status = 'confirmed'/);
  });

  it("마감 지난 collecting에서 후보가 무효면 closed 저장만 남기고 정상 반환(커밋) 후 invalid_candidate", async () => {
    prepare(lockedRow({ status: "collecting", voting_deadline_at: DEADLINE }));
    const result = await confirmSchedule(AUTH, at("2026-11-10T11:00:00+09:00"));

    expect(result).toEqual({
      kind: "invalid_candidate",
      reason: "too_few_participants",
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    const sql = tx.$executeRaw.mock.calls.map((call) => sqlOf(call).sql);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/SET status = 'closed'/);
  });

  it.each([
    [
      "마감 전 collecting",
      lockedRow({ status: "collecting", voting_deadline_at: new Date(NOW.getTime() + 1) }),
      "collecting",
    ],
    ["이미 confirmed(재요청)", lockedRow({ status: "confirmed" }), "confirmed"],
    ["draft", lockedRow({ status: "draft", voting_deadline_at: null }), "draft"],
  ])("%s → invalid_state, 아무것도 저장하지 않음", async (_n, row, promiseStatus) => {
    prepare(row);
    const result = await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"));
    expect(result).toEqual({
      kind: "invalid_state",
      promiseStatus,
      session: { expiresAt: SESSION_EXPIRES, now: NOW },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.participant.findMany).not.toHaveBeenCalled();
  });

  it("약속 행이 없으면 not_found, 쿠키는 지운다", async () => {
    prepare(null);
    expect(await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"))).toEqual({
      kind: "not_found",
      session: { expiresAt: null, now: NOW },
    });
  });

  it("잠금 후 cancelled면 세션 재확인 없이 cancelled", async () => {
    prepare(lockedRow({ status: "cancelled" }));
    const result = await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"));
    expect(result.kind).toBe("cancelled");
    expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
  });

  it("세션 행이 없으면 unauthenticated, 쿠키는 지운다", async () => {
    prepare(lockedRow());
    tx.participantSession.findUnique.mockResolvedValueOnce(null);
    expect(await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"))).toEqual({
      kind: "unauthenticated",
      session: { expiresAt: null, now: NOW },
    });
  });

  it.each([
    ["세션 만료", sessionRow({ expiresAt: NOW })],
    ["탈퇴한 참여자", sessionRow({ status: "cancelled" })],
  ])("잠금 후 %s → unauthenticated, 저장 없음", async (_n, row) => {
    prepare(lockedRow());
    tx.participantSession.findUnique.mockResolvedValueOnce(row);
    const result = await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"));
    expect(result.kind).toBe("unauthenticated");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("잠금 후 host가 아니면 forbidden, 마감 지난 collecting이어도 closed 저장 없음", async () => {
    prepare(lockedRow({ status: "collecting", voting_deadline_at: DEADLINE }));
    tx.participantSession.findUnique.mockResolvedValueOnce(sessionRow({ role: "participant" }));
    const result = await confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"));
    expect(result.kind).toBe("forbidden");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("closed인데 설정 값이 없으면 데이터 오류로 예외", async () => {
    prepare(lockedRow({ duration_minutes: null }));
    await expect(confirmSchedule(AUTH, at("2026-11-10T10:00:00+09:00"))).rejects.toThrow();
  });
});
