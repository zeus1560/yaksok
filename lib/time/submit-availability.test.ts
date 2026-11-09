import { beforeEach, describe, expect, it, vi } from "vitest";

// 가짜 tx. $queryRaw는 잠금 행 → 판정 시각 순서로 응답을 꺼낸다
const calls: string[] = [];
const txQueryResults: unknown[][] = [];
const tx = {
  $queryRaw: vi.fn(async () => txQueryResults.shift() ?? []),
  $executeRaw: vi.fn(async () => (calls.push("promise.close"), 1)),
  participantSession: { findUnique: vi.fn() },
  participantAvailableSlot: {
    findMany: vi.fn(),
    deleteMany: vi.fn(async () => (calls.push("slots.deleteMany"), { count: 0 })),
    createMany: vi.fn(async () => (calls.push("slots.createMany"), { count: 0 })),
  },
  participant: { update: vi.fn() },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { submitAvailability } from "./submit-availability";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-10T12:10:00.123+09:00"); // 잠금 후 판정 시각
const DEADLINE = new Date("2026-11-11T18:00:00+09:00");
const SESSION_EXPIRES = new Date("2026-11-18T18:00:00+09:00");
const MIN = 60_000;
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "member" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};
const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);
const PAST = "2026-11-10T11:00:00+09:00";
const FUTURE_A = "2026-11-10T14:00:00+09:00";
const FUTURE_B = "2026-11-10T14:30:00+09:00";
const FUTURE_C = "2026-11-11T10:00:00+09:00";

function lockedRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "collecting",
    created_at: new Date("2026-11-04T10:00:00+09:00"),
    voting_deadline_at: DEADLINE,
    date_range_start: "2026-11-10",
    date_range_end: "2026-11-12",
    daily_start_minute: 9 * 60,
    daily_end_minute: 18 * 60,
    ...overrides,
  };
}

type Me = {
  status?: string;
  promiseId?: string;
  availabilityVersion?: number;
  availabilitySubmittedAt?: Date | null;
};

function prepare(
  row: unknown,
  {
    me = {},
    stored = [] as string[],
    sessionExpiresAt = SESSION_EXPIRES,
    sessionMissing = false,
  }: { me?: Me; stored?: string[]; sessionExpiresAt?: Date; sessionMissing?: boolean } = {},
) {
  txQueryResults.push(row ? [row] : [], [{ now: NOW }]);
  tx.participantSession.findUnique.mockResolvedValue(
    sessionMissing
      ? null
      : {
          expiresAt: sessionExpiresAt,
          participant: {
            id: "pt-1",
            promiseId: PROMISE_ID,
            status: "active",
            availabilityVersion: 0,
            availabilitySubmittedAt: null,
            ...me,
          },
        },
  );
  tx.participantAvailableSlot.findMany.mockResolvedValue(
    stored.map((iso) => ({ slotStartAt: at(iso) })),
  );
}

const nextVersion = (version: number) =>
  tx.participant.update.mockImplementationOnce(async () => {
    calls.push("participant.update");
    return { availabilityVersion: version };
  });
const input = (baseVersion: number, slots: string[]) => ({
  baseVersion,
  slots: slots.map(ms).sort((a, b) => a - b),
});
const keep = { session: { expiresAt: SESSION_EXPIRES, now: NOW } };

describe("submitAvailability (TIME-API-01)", () => {
  beforeEach(() => {
    calls.length = 0;
    txQueryResults.length = 0;
    vi.clearAllMocks();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.participant.update.mockImplementation(async () => {
      calls.push("participant.update");
      return { availabilityVersion: 1 };
    });
  });

  it("첫 제출: 범위 밖은 빼고 저장, 제출 시각 = 판정 시각, 버전 +1", async () => {
    prepare(lockedRow());
    const outside = "2026-11-10T20:00:00+09:00";

    const result = await submitAvailability(AUTH, input(0, [PAST, FUTURE_A, FUTURE_B, outside]));

    expect(result).toEqual({
      kind: "ok",
      version: 1,
      submittedAt: NOW,
      slots: [at(FUTURE_A), at(FUTURE_B)],
      droppedSlotCount: 1,
      ...keep,
    });
    expect(tx.participantAvailableSlot.deleteMany).toHaveBeenCalledWith({
      where: { participantId: "pt-1", slotStartAt: { gt: NOW } },
    });
    expect(tx.participantAvailableSlot.createMany).toHaveBeenCalledWith({
      data: [
        { participantId: "pt-1", slotStartAt: at(FUTURE_A) },
        { participantId: "pt-1", slotStartAt: at(FUTURE_B) },
      ],
    });
    expect(tx.participant.update).toHaveBeenCalledWith({
      where: { id: "pt-1" },
      data: { availabilitySubmittedAt: NOW, availabilityVersion: { increment: 1 } },
      select: { availabilityVersion: true },
    });
    expect(calls).toEqual(["slots.deleteMany", "slots.createMany", "participant.update"]);
  });

  it("잠금 쿼리는 promises만 FOR UPDATE, 판정 시각은 잠금 뒤 clock_timestamp()", async () => {
    prepare(lockedRow());
    await submitAvailability(AUTH, input(0, []));
    const [lock, clock] = tx.$queryRaw.mock.calls.map((c) =>
      ((c as unknown[])[0] as string[]).join("?"),
    );
    expect(lock).toMatch(/FROM promises WHERE id = \?::uuid FOR UPDATE/);
    expect(lock).not.toMatch(/promise_links/);
    expect(clock).toMatch(/clock_timestamp\(\)/);
  });

  it("재제출: 지난 슬롯은 보존하고 미래 슬롯만 교체한다", async () => {
    prepare(lockedRow(), {
      me: { availabilityVersion: 3, availabilitySubmittedAt: at("2026-11-09T10:00:00+09:00") },
      stored: [PAST, FUTURE_A],
    });
    nextVersion(4);

    const result = await submitAvailability(AUTH, input(3, [FUTURE_C]));

    expect(result).toMatchObject({
      kind: "ok",
      version: 4,
      submittedAt: NOW,
      slots: [at(PAST), at(FUTURE_C)],
      droppedSlotCount: 0,
    });
    expect(tx.participantAvailableSlot.deleteMany).toHaveBeenCalledWith({
      where: { participantId: "pt-1", slotStartAt: { gt: NOW } },
    });
  });

  it("빈 배열 제출: 미래 슬롯 삭제, 삽입 없음, 제출 상태·버전 갱신", async () => {
    prepare(lockedRow(), { me: { availabilityVersion: 2 }, stored: [PAST, FUTURE_A] });
    nextVersion(3);

    const result = await submitAvailability(AUTH, input(2, []));

    expect(result).toMatchObject({ kind: "ok", version: 3, submittedAt: NOW, slots: [at(PAST)] });
    expect(tx.participantAvailableSlot.createMany).not.toHaveBeenCalled();
    expect(calls).toEqual(["slots.deleteMany", "participant.update"]);
  });

  it("버전 충돌: 내용이 다르면 version_conflict, 저장 없음", async () => {
    const submittedAt = at("2026-11-10T09:00:00+09:00");
    prepare(lockedRow(), {
      me: { availabilityVersion: 5, availabilitySubmittedAt: submittedAt },
      stored: [PAST, FUTURE_A],
    });

    const result = await submitAvailability(AUTH, input(4, [FUTURE_A, FUTURE_B]));

    expect(result).toEqual({
      kind: "version_conflict",
      currentVersion: 5,
      submitted: true,
      slots: [at(PAST), at(FUTURE_A)],
      ...keep,
    });
    expect(calls).toEqual([]);
  });

  it("버전 충돌: 내용이 같아도 미제출 상태면 version_conflict", async () => {
    prepare(lockedRow(), {
      me: { availabilityVersion: 2, availabilitySubmittedAt: null },
      stored: [FUTURE_A],
    });
    expect(await submitAvailability(AUTH, input(1, [FUTURE_A]))).toMatchObject({
      kind: "version_conflict",
      currentVersion: 2,
      submitted: false,
    });
    expect(calls).toEqual([]);
  });

  it("재시도: 버전이 달라도 남긴 슬롯 = 서버 미래 슬롯이고 제출 상태면 200, 변경 없음", async () => {
    const submittedAt = at("2026-11-10T12:05:00.027+09:00");
    prepare(lockedRow(), {
      me: { availabilityVersion: 4, availabilitySubmittedAt: submittedAt },
      stored: [PAST, FUTURE_A, FUTURE_B],
    });
    const outside = "2026-11-10T20:00:00+09:00";

    // 지난 슬롯·범위 밖 슬롯이 섞여 와도 남긴 슬롯 기준으로 비교한다
    const result = await submitAvailability(AUTH, input(3, [PAST, FUTURE_B, FUTURE_A, outside]));

    expect(result).toEqual({
      kind: "ok",
      version: 4,
      submittedAt,
      slots: [at(PAST), at(FUTURE_A), at(FUTURE_B)],
      droppedSlotCount: 1,
      ...keep,
    });
    expect(calls).toEqual([]);
  });

  it("재시도 200의 slots는 요청이 아니라 서버 저장값 전체(요청에 없는 지난 슬롯 포함)", async () => {
    const submittedAt = at("2026-11-10T12:05:00.027+09:00");
    const olderPast = "2026-11-10T10:00:00+09:00";
    prepare(lockedRow(), {
      me: { availabilityVersion: 7, availabilitySubmittedAt: submittedAt },
      stored: [olderPast, PAST, FUTURE_A],
    });

    // 요청에는 미래 슬롯만 있고 지난 슬롯은 없다
    const result = await submitAvailability(AUTH, input(6, [FUTURE_A]));

    expect(result).toEqual({
      kind: "ok",
      version: 7,
      submittedAt,
      slots: [at(olderPast), at(PAST), at(FUTURE_A)],
      droppedSlotCount: 0,
      ...keep,
    });
    expect(calls).toEqual([]);
  });

  it("마감 경과(판정 시각 = 마감): closed로 전환하고 정상 반환(커밋) 후 voting_closed", async () => {
    prepare(lockedRow({ voting_deadline_at: NOW }));

    const result = await submitAvailability(AUTH, input(0, [FUTURE_A]));

    expect(result).toEqual({ kind: "voting_closed", ...keep });
    expect(calls).toEqual(["promise.close"]);
    const sql = (tx.$executeRaw.mock.calls[0] as unknown[])[0] as string[];
    expect(sql.join("?")).toMatch(/UPDATE promises SET status = 'closed'/);
    // 트랜잭션 콜백이 예외 없이 끝났다 = 커밋된다
    await expect(transaction.mock.results[0].value).resolves.toEqual(result);
    // 세션·참여자 재확인을 통과한 요청만 closed를 저장한다 (R-32 N-2 — 이전에는 재확인 전에 저장)
    expect(tx.participantSession.findUnique).toHaveBeenCalledTimes(1);
  });

  it("마감 1ms 전이면 제출된다", async () => {
    prepare(lockedRow({ voting_deadline_at: new Date(NOW.getTime() + 1) }));
    expect(await submitAvailability(AUTH, input(0, []))).toMatchObject({ kind: "ok" });
  });

  it.each([
    ["cancelled", lockedRow({ status: "cancelled" }), "cancelled"],
    [
      "진행 중 draft",
      lockedRow({ status: "draft", created_at: new Date(NOW.getTime() - 10 * MIN + 1) }),
      "not_open",
    ],
    [
      "10분 지난 draft",
      lockedRow({ status: "draft", created_at: new Date(NOW.getTime() - 10 * MIN) }),
      "draft_expired",
    ],
    ["closed", lockedRow({ status: "closed" }), "voting_closed"],
    ["confirmed", lockedRow({ status: "confirmed" }), "voting_closed"],
  ])("%s → %s, 아무것도 바꾸지 않는다", async (_, row, kind) => {
    prepare(row);
    expect(await submitAvailability(AUTH, input(0, [FUTURE_A]))).toEqual({ kind, ...keep });
    expect(calls).toEqual([]);
    // cancelled만 세션 재확인보다 먼저다. 나머지 상태는 재확인 뒤 판정한다 (R-32 N-2)
    expect(tx.participantSession.findUnique).toHaveBeenCalledTimes(kind === "cancelled" ? 0 : 1);
  });

  it("잠금 후 약속이 없으면 not_found, 쿠키는 지운다", async () => {
    prepare(null);
    expect(await submitAvailability(AUTH, input(0, []))).toEqual({
      kind: "not_found",
      session: { expiresAt: null, now: NOW },
    });
  });

  it("탈퇴 참여자(cancelled) → unauthenticated, 저장 없음", async () => {
    prepare(lockedRow(), { me: { status: "cancelled" } });
    expect(await submitAvailability(AUTH, input(0, [FUTURE_A]))).toEqual({
      kind: "unauthenticated",
      ...keep,
    });
    expect(calls).toEqual([]);
  });

  it("인증 뒤 세션이 만료됐으면(탈퇴로 즉시 만료) unauthenticated, 쿠키는 그 만료 시각 기준", async () => {
    prepare(lockedRow(), { sessionExpiresAt: NOW });
    expect(await submitAvailability(AUTH, input(0, []))).toEqual({
      kind: "unauthenticated",
      session: { expiresAt: NOW, now: NOW },
    });
  });

  it("세션 행이 없으면 unauthenticated, 쿠키는 지운다", async () => {
    prepare(lockedRow(), { sessionMissing: true });
    expect(await submitAvailability(AUTH, input(0, []))).toEqual({
      kind: "unauthenticated",
      session: { expiresAt: null, now: NOW },
    });
  });
});

// 잠금 후 세션·참여자 재확인은 취소 판정 바로 뒤, 상태·마감 판정보다 먼저다 (R-32 N-2, 설정 완료와 같은 순서)
describe("submitAvailability 재확인 순서 (R-32 N-2)", () => {
  beforeEach(() => {
    calls.length = 0;
    txQueryResults.length = 0;
    vi.clearAllMocks();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("잠금 후 세션이 삭제됐으면 마감이 지났어도 제출은 401이고 closed를 저장하지 않는다", async () => {
    prepare(lockedRow({ voting_deadline_at: NOW }), { sessionMissing: true });
    expect(await submitAvailability(AUTH, input(0, [FUTURE_A]))).toEqual({
      kind: "unauthenticated",
      session: { expiresAt: null, now: NOW },
    });
    expect(calls).toEqual([]);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("잠금 후 참여자가 cancelled면 마감이 지났어도 401이고 closed를 저장하지 않는다", async () => {
    prepare(lockedRow({ voting_deadline_at: NOW }), { me: { status: "cancelled" } });
    expect(await submitAvailability(AUTH, input(0, [FUTURE_A]))).toEqual({
      kind: "unauthenticated",
      ...keep,
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    ["마감 경과 collecting", lockedRow({ voting_deadline_at: NOW })],
    ["closed", lockedRow({ status: "closed" })],
    ["confirmed", lockedRow({ status: "confirmed" })],
    ["진행 중 draft", lockedRow({ status: "draft", created_at: new Date(NOW.getTime() - MIN) })],
    [
      "10분 지난 draft",
      lockedRow({ status: "draft", created_at: new Date(NOW.getTime() - 10 * MIN) }),
    ],
  ])("로그아웃과 겹친 제출은 쿠키를 다시 심지 않는다: %s → 401·쿠키 삭제", async (_, row) => {
    prepare(row, { sessionMissing: true });
    const result = await submitAvailability(AUTH, input(0, [FUTURE_A]));
    expect(result.kind).toBe("unauthenticated");
    expect(result.session).toEqual({ expiresAt: null, now: NOW });
    expect(calls).toEqual([]);
  });

  it("잠금 후 cancelled 약속은 세션 재확인보다 먼저 cancelled(취소 우선)", async () => {
    prepare(lockedRow({ status: "cancelled" }), { sessionMissing: true });
    expect((await submitAvailability(AUTH, input(0, []))).kind).toBe("cancelled");
    expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
  });
});
