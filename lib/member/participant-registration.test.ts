import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/prisma/generated/client";
import { hashSessionToken } from "./session";

// 트랜잭션 콜백에 넘길 가짜 tx. $queryRaw는 잠금 행 → 판정 시각 순서로 응답을 꺼낸다
const calls: string[] = [];
const txQueryResults: unknown[][] = [];
const tx = {
  $queryRaw: vi.fn(async () => txQueryResults.shift() ?? []),
  participant: {
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  participantSession: {
    create: vi.fn(async () => (calls.push("session.create"), { id: "s-new" })),
  },
};
const transaction = vi.hoisted(() => vi.fn());
const promiseFindUnique = vi.hoisted(() => vi.fn());
const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    $queryRaw: queryRaw,
    promise: { findUnique: promiseFindUnique },
  },
}));
const hashPin = vi.hoisted(() => vi.fn(async () => "scrypt$hashed"));
vi.mock("./pin", () => ({ hashPin }));
const findActivePromiseSession = vi.hoisted(() => vi.fn());
vi.mock("./session-auth", () => ({ findActivePromiseSession }));

import { registerParticipant, resolveJoinAccess } from "./participant-registration";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-04T12:00:00+09:00");
const DEADLINE = new Date("2026-11-10T18:00:00+09:00");
const LOCK_NOW = new Date("2026-11-04T12:00:01+09:00");
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60_000;
const INPUT = { nickname: "혜승", pin: "1357" };

function request() {
  return new Request(`http://localhost:3000/api/v1/promises/${PROMISE_ID}/participants`, {
    method: "POST",
  });
}

function lockedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMISE_ID,
    status: "collecting",
    created_at: new Date("2026-11-04T10:00:00+09:00"),
    voting_deadline_at: DEADLINE,
    confirmed_start_at: null,
    participant_limit: 4,
    link_created_at: new Date("2026-11-04T09:59:00+09:00"),
    ...overrides,
  };
}

function prepare(
  row: unknown,
  {
    taken = false,
    activeCount = 1,
    lockNow = LOCK_NOW,
  }: {
    taken?: boolean;
    activeCount?: number;
    lockNow?: Date;
  } = {},
) {
  promiseFindUnique.mockResolvedValueOnce({ id: PROMISE_ID, status: "collecting" });
  queryRaw.mockResolvedValueOnce([{ now: NOW }]);
  txQueryResults.push(row ? [row] : [], [{ now: lockNow }]);
  tx.participant.findUnique.mockImplementation(async () => {
    calls.push("participant.findUnique");
    return taken ? { id: "pt-old" } : null;
  });
  tx.participant.count.mockImplementation(async () => {
    calls.push("participant.count");
    return activeCount;
  });
}

describe("resolveJoinAccess (잠금 후 상태 판정)", () => {
  const collecting = { status: "collecting", createdAt: NOW, votingDeadlineAt: DEADLINE };

  it("collecting이고 마감 전이면 통과", () => {
    expect(resolveJoinAccess(collecting, NOW)).toBeNull();
  });

  it("cancelled → cancelled", () => {
    expect(resolveJoinAccess({ ...collecting, status: "cancelled" }, NOW)).toEqual({
      kind: "cancelled",
    });
  });

  it("진행 중 draft → not_open, 10분 경계(= created_at + 10분)부터 draft_expired", () => {
    const draft = { status: "draft", createdAt: NOW, votingDeadlineAt: null };
    expect(resolveJoinAccess(draft, new Date(NOW.getTime() + 10 * MIN - 1))).toEqual({
      kind: "not_open",
    });
    expect(resolveJoinAccess(draft, new Date(NOW.getTime() + 10 * MIN))).toEqual({
      kind: "draft_expired",
    });
  });

  it.each(["closed", "confirmed"])("%s → invalid_state", (status) => {
    expect(resolveJoinAccess({ ...collecting, status }, NOW)).toEqual({
      kind: "invalid_state",
      promiseStatus: status,
    });
  });

  it("마감 경계: 판정 시각 = 마감이면 deadline_passed, 1ms 전이면 통과", () => {
    expect(resolveJoinAccess(collecting, DEADLINE)).toEqual({ kind: "deadline_passed" });
    expect(resolveJoinAccess(collecting, new Date(DEADLINE.getTime() - 1))).toBeNull();
  });
});

describe("registerParticipant (MEMBER-API-03)", () => {
  beforeEach(() => {
    calls.length = 0;
    txQueryResults.length = 0;
    vi.clearAllMocks();
    promiseFindUnique.mockReset();
    queryRaw.mockReset();
    findActivePromiseSession.mockReset().mockResolvedValue(null);
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.participant.create.mockImplementation(async () => {
      calls.push("participant.create");
      return { id: "pt-new" };
    });
  });

  it("promiseId 형식 오류 → invalid_request, DB 조회 없음", async () => {
    expect(await registerParticipant(request(), "nope", INPUT)).toEqual({
      kind: "invalid_request",
    });
    expect(promiseFindUnique).not.toHaveBeenCalled();
  });

  it("없는 약속 → not_found, 해시·트랜잭션 없음", async () => {
    promiseFindUnique.mockResolvedValueOnce(null);
    queryRaw.mockResolvedValueOnce([{ now: NOW }]);
    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual({ kind: "not_found" });
    expect(hashPin).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("취소된 약속은 세션 확인 전에 cancelled", async () => {
    promiseFindUnique.mockResolvedValueOnce({ id: PROMISE_ID, status: "cancelled" });
    queryRaw.mockResolvedValueOnce([{ now: NOW }]);
    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual({ kind: "cancelled" });
    expect(findActivePromiseSession).not.toHaveBeenCalled();
  });

  it("유효 세션을 가진 브라우저 → already_participant, 해시·트랜잭션 없음", async () => {
    promiseFindUnique.mockResolvedValueOnce({ id: PROMISE_ID, status: "collecting" });
    queryRaw.mockResolvedValueOnce([{ now: NOW }]);
    findActivePromiseSession.mockResolvedValueOnce({ participantId: "pt-1" });

    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual({
      kind: "already_participant",
    });
    expect(findActivePromiseSession).toHaveBeenCalledWith(expect.any(Request), PROMISE_ID, NOW);
    expect(hashPin).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("성공: member·active 생성, 세션 = 마감 + 7일, Max-Age는 잠금 후 시각 기준, 등록 후 인원", async () => {
    prepare(lockedRow(), { activeCount: 2 });

    const result = await registerParticipant(request(), PROMISE_ID, INPUT, {
      sessionToken: "fixed-token",
    });

    const expiresAt = new Date(DEADLINE.getTime() + 7 * DAY);
    expect(result).toEqual({
      kind: "created",
      promiseId: PROMISE_ID,
      participantId: "pt-new",
      nickname: "혜승",
      currentParticipantCount: 3,
      participantLimit: 4,
      sessionToken: "fixed-token",
      sessionMaxAgeSeconds: Math.floor((expiresAt.getTime() - LOCK_NOW.getTime()) / 1000),
    });
    expect(tx.participant.create).toHaveBeenCalledWith({
      data: {
        promiseId: PROMISE_ID,
        nickname: "혜승",
        normalizedNickname: "혜승",
        passwordHash: "scrypt$hashed",
        role: "member",
        status: "active",
      },
      select: { id: true },
    });
    expect(tx.participantSession.create).toHaveBeenCalledWith({
      data: {
        participantId: "pt-new",
        sessionTokenHash: hashSessionToken("fixed-token"),
        expiresAt,
      },
      select: { id: true },
    });
    // 해시는 잠금(트랜잭션) 전에 계산한다
    expect(hashPin.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0],
    );
    expect(calls).toEqual([
      "participant.findUnique",
      "participant.count",
      "participant.create",
      "session.create",
    ]);
  });

  it("promises 행만 FOR UPDATE로 잠근다(링크는 잠그지 않음)", async () => {
    prepare(lockedRow());
    await registerParticipant(request(), PROMISE_ID, INPUT);
    const sqlOf = (index: number) =>
      (tx.$queryRaw.mock.calls[index] as unknown as [TemplateStringsArray])[0].join("?");
    expect(sqlOf(0)).toMatch(/FOR UPDATE OF p/);
    expect(sqlOf(1)).toBe("SELECT clock_timestamp() AS now");
  });

  it.each([
    ["cancelled", lockedRow({ status: "cancelled" }), LOCK_NOW, { kind: "cancelled" }],
    [
      "진행 중 draft",
      lockedRow({ status: "draft", created_at: NOW }),
      LOCK_NOW,
      { kind: "not_open" },
    ],
    [
      "10분 지난 draft(삭제 없음)",
      lockedRow({ status: "draft", created_at: NOW }),
      new Date(NOW.getTime() + 10 * MIN),
      { kind: "draft_expired" },
    ],
    [
      "closed",
      lockedRow({ status: "closed" }),
      LOCK_NOW,
      { kind: "invalid_state", promiseStatus: "closed" },
    ],
    [
      "confirmed",
      lockedRow({ status: "confirmed" }),
      LOCK_NOW,
      { kind: "invalid_state", promiseStatus: "confirmed" },
    ],
    ["마감 = 판정 시각", lockedRow(), DEADLINE, { kind: "deadline_passed" }],
  ])("잠금 후 %s → 거절, 아무것도 만들지 않는다", async (_name, row, lockNow, expected) => {
    prepare(row, { lockNow });
    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual(expected);
    expect(calls).toEqual([]);
  });

  it("잠금 시점에 약속이 사라졌으면 not_found", async () => {
    prepare(null);
    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual({ kind: "not_found" });
  });

  it("정원 경계: active = limit - 1이면 통과(등록 후 = limit)", async () => {
    prepare(lockedRow({ participant_limit: 4 }), { activeCount: 3 });
    const result = await registerParticipant(request(), PROMISE_ID, INPUT);
    expect(result).toMatchObject({
      kind: "created",
      currentParticipantCount: 4,
      participantLimit: 4,
    });
  });

  it("정원 경계: active = limit이면 full, 생성 없음", async () => {
    prepare(lockedRow({ participant_limit: 4 }), { activeCount: 4 });
    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual({ kind: "full" });
    expect(tx.participant.create).not.toHaveBeenCalled();
  });

  it("cancelled 참여자의 닉네임도 상태 조건 없이 조회해 nickname_taken", async () => {
    prepare(lockedRow(), { taken: true });
    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual({
      kind: "nickname_taken",
    });
    expect(tx.participant.findUnique).toHaveBeenCalledWith({
      where: {
        promiseId_normalizedNickname: { promiseId: PROMISE_ID, normalizedNickname: "혜승" },
      },
      select: { id: true },
    });
  });

  it("정원이 찬 상태에서 이미 있는 닉네임이면 full이 아니라 nickname_taken (닉네임 먼저)", async () => {
    prepare(lockedRow({ participant_limit: 4 }), { taken: true, activeCount: 4 });
    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual({
      kind: "nickname_taken",
    });
    expect(tx.participant.count).not.toHaveBeenCalled();
  });

  it("생성 중 UNIQUE 위반(P2002) → nickname_taken", async () => {
    prepare(lockedRow());
    tx.participant.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7" }),
    );
    expect(await registerParticipant(request(), PROMISE_ID, INPUT)).toEqual({
      kind: "nickname_taken",
    });
    expect(tx.participantSession.create).not.toHaveBeenCalled();
  });

  it("그 밖의 DB 오류는 그대로 던진다", async () => {
    prepare(lockedRow());
    tx.participant.create.mockRejectedValueOnce(new Error("boom"));
    await expect(registerParticipant(request(), PROMISE_ID, INPUT)).rejects.toThrow("boom");
  });
});
