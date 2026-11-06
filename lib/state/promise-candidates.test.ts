import { beforeEach, describe, expect, it, vi } from "vitest";

// 가짜 tx. $queryRaw는 판정 시각 → 약속 행 순서로 응답을 꺼낸다. 쓰기 메서드는 두지 않는다(호출되면 실패)
const txQueryResults: unknown[][] = [];
const tx = {
  $queryRaw: vi.fn(async () => txQueryResults.shift() ?? []),
  participantSession: { findUnique: vi.fn() },
  participant: { findMany: vi.fn() },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { getPromiseCandidates } from "./promise-candidates";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const OTHER_PROMISE_ID = "0b5d1e7a-2c3f-4a6b-8d9e-1f2a3b4c5d6e";
const NOW = new Date("2026-11-10T10:10:00.123+09:00"); // 트랜잭션 now()
const SESSION_EXPIRES = new Date("2026-11-18T18:00:00+09:00");
const SUBMITTED = new Date("2026-11-09T10:00:00+09:00");
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-me", role: "member" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};
const at = (iso: string) => new Date(iso);

function promiseRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "closed",
    voting_deadline_at: at("2026-11-09T18:00:00+09:00"),
    date_range_start: "2026-11-10",
    date_range_end: "2026-11-11",
    daily_start_minute: 9 * 60,
    daily_end_minute: 12 * 60,
    duration_minutes: 60,
    ...overrides,
  };
}

const person = (slots: string[], status = "active", submittedAt: Date | null = SUBMITTED) => ({
  status,
  availabilitySubmittedAt: submittedAt,
  availableSlots: slots.map((iso) => ({ slotStartAt: at(iso) })),
});

type SessionRow = {
  expiresAt?: Date;
  participant?: { id?: string; promiseId?: string; status?: string };
};

function prepare(
  row: unknown,
  {
    people = [] as ReturnType<typeof person>[],
    session = {} as SessionRow,
    sessionMissing = false,
  } = {},
) {
  txQueryResults.push([{ now: NOW }], row ? [row] : []);
  tx.participantSession.findUnique.mockResolvedValue(
    sessionMissing
      ? null
      : {
          expiresAt: session.expiresAt ?? SESSION_EXPIRES,
          participant: { id: "pt-me", promiseId: PROMISE_ID, status: "active", ...session.participant },
        },
  );
  tx.participant.findMany.mockResolvedValue(people);
}

const keep = { session: { expiresAt: SESSION_EXPIRES, now: NOW } };

describe("getPromiseCandidates (STATE-API-10)", () => {
  beforeEach(() => {
    txQueryResults.length = 0;
    vi.clearAllMocks();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("REPEATABLE READ 트랜잭션 하나, 계산 시각 now()를 먼저 읽고 잠금 없이 약속을 읽는다", async () => {
    prepare(promiseRow());
    await getPromiseCandidates(AUTH);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    const sqls = tx.$queryRaw.mock.calls.map((call) =>
      ((call as unknown[])[0] as TemplateStringsArray).join("?"),
    );
    expect(sqls[0]).toContain("now()");
    expect(sqls[1]).toContain("FROM promises");
    expect(sqls.join(" ")).not.toMatch(/FOR UPDATE|FOR SHARE/i);
  });

  describe("판정", () => {
    it("cancelled → cancelled (세션 재확인 전)", async () => {
      prepare(promiseRow({ status: "cancelled" }));
      expect(await getPromiseCandidates(AUTH)).toEqual({ kind: "cancelled", ...keep });
      expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    });

    it("인증 뒤 약속 행이 사라짐 → not_found, 쿠키 삭제", async () => {
      prepare(null);
      expect(await getPromiseCandidates(AUTH)).toEqual({
        kind: "not_found",
        session: { expiresAt: null, now: NOW },
      });
    });

    it("collecting 마감 전(마감 = 판정 시각 + 1ms) → invalid_state collecting", async () => {
      prepare(promiseRow({ status: "collecting", voting_deadline_at: new Date(NOW.getTime() + 1) }));
      expect(await getPromiseCandidates(AUTH)).toEqual({
        kind: "invalid_state",
        promiseStatus: "collecting",
        ...keep,
      });
      expect(tx.participant.findMany).not.toHaveBeenCalled();
    });

    it("collecting 마감 경과(마감 = 판정 시각) → closed로 계산해 후보 계산, DB 쓰기 없음", async () => {
      prepare(promiseRow({ status: "collecting", voting_deadline_at: NOW }));
      expect(await getPromiseCandidates(AUTH)).toMatchObject({ kind: "ok" });
      expect(Object.keys(tx)).toEqual(["$queryRaw", "participantSession", "participant"]);
      expect(Object.keys(tx.participant)).toEqual(["findMany"]);
    });

    it.each(["draft", "confirmed"])("%s → invalid_state %s", async (status) => {
      prepare(promiseRow({ status }));
      expect(await getPromiseCandidates(AUTH)).toEqual({
        kind: "invalid_state",
        promiseStatus: status,
        ...keep,
      });
    });

    it("탈퇴 참여자(cancelled) → unauthenticated, 상태 판정 전", async () => {
      prepare(promiseRow({ status: "collecting", voting_deadline_at: new Date(NOW.getTime() + 1) }), {
        session: { participant: { status: "cancelled" } },
      });
      expect(await getPromiseCandidates(AUTH)).toEqual({ kind: "unauthenticated", ...keep });
    });

    it("세션 즉시 만료(expires_at = 판정 시각) → unauthenticated", async () => {
      prepare(promiseRow(), { session: { expiresAt: NOW } });
      expect(await getPromiseCandidates(AUTH)).toEqual({
        kind: "unauthenticated",
        session: { expiresAt: NOW, now: NOW },
      });
    });

    it("세션 행 없음 → unauthenticated, 쿠키 삭제", async () => {
      prepare(promiseRow(), { sessionMissing: true });
      expect(await getPromiseCandidates(AUTH)).toEqual({
        kind: "unauthenticated",
        session: { expiresAt: null, now: NOW },
      });
    });

    it("세션 참여자가 다른 약속 소속 → unauthenticated", async () => {
      prepare(promiseRow(), { session: { participant: { promiseId: OTHER_PROMISE_ID } } });
      expect(await getPromiseCandidates(AUTH)).toMatchObject({ kind: "unauthenticated" });
    });

    it("설정 값이 비어 있는 closed → 예외(500)", async () => {
      prepare(promiseRow({ duration_minutes: null }));
      await expect(getPromiseCandidates(AUTH)).rejects.toThrow();
    });
  });

  describe("후보", () => {
    it("집계 대상만 조회하고, 계산 시각 now()로 지난 시작점을 빼고 정렬된 전체 목록을 돌려준다", async () => {
      // now = 11-10 10:10 → 11-10 10:00 시작은 지났다
      const slots = [
        "2026-11-10T10:00:00+09:00",
        "2026-11-10T10:30:00+09:00",
        "2026-11-10T11:00:00+09:00",
        "2026-11-11T09:00:00+09:00",
        "2026-11-11T09:30:00+09:00",
      ];
      prepare(promiseRow(), {
        people: [
          person(slots),
          person(slots),
          person(["2026-11-11T09:00:00+09:00", "2026-11-11T09:30:00+09:00"]),
          // 조회 조건을 통과해 들어와도 계산 함수가 한 번 더 거른다
          person(slots, "cancelled"),
          person(slots, "active", null),
        ],
      });

      const result = await getPromiseCandidates(AUTH);

      expect(tx.participant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            promiseId: PROMISE_ID,
            status: "active",
            availabilitySubmittedAt: { not: null },
          },
        }),
      );
      expect(result).toEqual({
        kind: "ok",
        calculatedAt: NOW,
        candidates: [
          {
            startAt: at("2026-11-11T09:00:00+09:00"),
            endAt: at("2026-11-11T10:00:00+09:00"),
            availableParticipantCount: 3,
          },
          {
            startAt: at("2026-11-10T10:30:00+09:00"),
            endAt: at("2026-11-10T11:30:00+09:00"),
            availableParticipantCount: 2,
          },
        ],
        ...keep,
      });
    });

    it("응답자 0명 → 빈 배열(오류 아님)", async () => {
      prepare(promiseRow({ status: "collecting", voting_deadline_at: NOW }));
      expect(await getPromiseCandidates(AUTH)).toEqual({
        kind: "ok",
        calculatedAt: NOW,
        candidates: [],
        ...keep,
      });
    });
  });
});
