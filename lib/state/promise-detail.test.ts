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
import { getPromiseDetail } from "./promise-detail";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const OTHER_PROMISE_ID = "0b5d1e7a-2c3f-4a6b-8d9e-1f2a3b4c5d6e";
const NOW = new Date("2026-11-10T10:10:00.123+09:00"); // 트랜잭션 now()
const SESSION_EXPIRES = new Date("2026-11-18T18:00:00+09:00");
const SUBMITTED = new Date("2026-11-09T10:00:00+09:00");
const CREATED = new Date("2026-11-08T09:00:00.456+09:00");
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "confirmed", promiseLinkId: "l-1" },
  participant: { id: "pt-me", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};
const at = (iso: string) => new Date(iso);

function promiseRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "collecting",
    created_at: CREATED,
    participant_limit: 8,
    date_range_start: "2026-11-10",
    date_range_end: "2026-11-11",
    daily_start_minute: 9 * 60,
    daily_end_minute: 12 * 60,
    duration_minutes: 60,
    voting_deadline_at: at("2026-11-09T18:00:00+09:00"),
    confirmed_start_at: null,
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
  participant?: { id?: string; promiseId?: string; status?: string; role?: string };
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
          participant: {
            id: "pt-me",
            promiseId: PROMISE_ID,
            status: "active",
            role: "host",
            ...session.participant,
          },
        },
  );
  tx.participant.findMany.mockResolvedValue(people);
}

const keep = { session: { expiresAt: SESSION_EXPIRES, now: NOW } };

describe("getPromiseDetail (STATE-API-01)", () => {
  beforeEach(() => {
    txQueryResults.length = 0;
    vi.clearAllMocks();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("REPEATABLE READ 트랜잭션 하나, 판정 시각 now()를 먼저 읽고 잠금 없이 약속을 읽는다", async () => {
    prepare(promiseRow());
    await getPromiseDetail(AUTH);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    const sqls = tx.$queryRaw.mock.calls.map((call) =>
      ((call as unknown[])[0] as TemplateStringsArray).join("?"),
    );
    expect(sqls[0]).toContain("now()");
    expect(sqls[0]).not.toContain("clock_timestamp");
    expect(sqls[1]).toContain("FROM promises");
    expect(sqls[1]).toContain("confirmed_start_at");
    expect(sqls.join(" ")).not.toMatch(/FOR UPDATE|FOR SHARE/i);
  });

  describe("판정 순서", () => {
    it("인증 뒤 약속 행이 사라짐 → not_found, 쿠키 삭제", async () => {
      prepare(null);
      expect(await getPromiseDetail(AUTH)).toEqual({
        kind: "not_found",
        session: { expiresAt: null, now: NOW },
      });
    });

    it("cancelled → cancelled (세션 재확인 전)", async () => {
      prepare(promiseRow({ status: "cancelled" }));
      expect(await getPromiseDetail(AUTH)).toEqual({ kind: "cancelled", ...keep });
      expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    });

    it("알 수 없는 상태값은 데이터 오류로 예외", async () => {
      prepare(promiseRow({ status: "weird" }));
      await expect(getPromiseDetail(AUTH)).rejects.toThrow();
    });

    it("세션 행 없음 → unauthenticated, 쿠키 삭제", async () => {
      prepare(promiseRow(), { sessionMissing: true });
      expect(await getPromiseDetail(AUTH)).toEqual({
        kind: "unauthenticated",
        session: { expiresAt: null, now: NOW },
      });
    });

    it.each([
      ["세션 만료(expires_at = 판정 시각)", { expiresAt: NOW }],
      ["참여자 탈퇴", { participant: { status: "cancelled" } }],
      ["다른 약속 소속", { participant: { promiseId: OTHER_PROMISE_ID } }],
      ["다른 참여자", { participant: { id: "pt-other" } }],
    ] as [string, SessionRow][])("%s → unauthenticated", async (_label, session) => {
      prepare(promiseRow(), { session });
      expect((await getPromiseDetail(AUTH)).kind).toBe("unauthenticated");
    });

    it("draft + 현재 역할이 member → forbidden (인증 시점 역할이 host여도 최신 역할 기준)", async () => {
      prepare(promiseRow({ status: "draft" }), { session: { participant: { role: "member" } } });
      expect(await getPromiseDetail(AUTH)).toEqual({ kind: "forbidden", ...keep });
    });

    it("draft가 아니면 member도 ok", async () => {
      prepare(promiseRow(), { session: { participant: { role: "member" } } });
      const result = await getPromiseDetail({
        ...AUTH,
        participant: { id: "pt-me", role: "member" },
      });
      expect(result).toMatchObject({ kind: "ok", requesterRole: "member" });
    });
  });

  describe("ok", () => {
    it("draft 방장: 미설정 값 null 그대로, 인원 계산·참여자 조회 없음 (10분 지난 draft도)", async () => {
      const draft = promiseRow({
        status: "draft",
        created_at: at("2026-11-10T09:00:00+09:00"),
        participant_limit: null,
        date_range_start: null,
        date_range_end: null,
        daily_start_minute: null,
        daily_end_minute: null,
        duration_minutes: null,
        voting_deadline_at: null,
      });
      prepare(draft);
      expect(await getPromiseDetail(AUTH)).toEqual({
        kind: "ok",
        now: NOW,
        promise: {
          id: PROMISE_ID,
          status: "draft",
          createdAt: at("2026-11-10T09:00:00+09:00"),
          participantLimit: null,
          dateRangeStart: null,
          dateRangeEnd: null,
          dailyStartMinute: null,
          dailyEndMinute: null,
          durationMinutes: null,
          votingDeadlineAt: null,
          confirmedStartAt: null,
        },
        requesterRole: "host",
        availableParticipantCount: null,
        ...keep,
      });
      expect(tx.participant.findMany).not.toHaveBeenCalled();
    });

    it.each(["collecting", "closed"])("%s: 인원 계산 없음", async (status) => {
      prepare(promiseRow({ status }));
      const result = await getPromiseDetail(AUTH);
      expect(result).toMatchObject({ kind: "ok", availableParticipantCount: null });
      expect(tx.participant.findMany).not.toHaveBeenCalled();
    });

    it("응답 세션 만료는 트랜잭션에서 다시 읽은 값", async () => {
      const extended = new Date(SESSION_EXPIRES.getTime() + 86_400_000);
      prepare(promiseRow(), { session: { expiresAt: extended } });
      expect((await getPromiseDetail(AUTH)).session).toEqual({ expiresAt: extended, now: NOW });
    });
  });

  describe("confirmed: 확정 구간 공통 가능 인원", () => {
    const START = "2026-11-10T10:00:00+09:00";
    const confirmed = (overrides: Record<string, unknown> = {}) =>
      promiseRow({ status: "confirmed", confirmed_start_at: at(START), ...overrides });

    it("active·제출 완료 참여자만, 확정 구간 [시작, 시작+소요) 슬롯만 읽는다", async () => {
      prepare(confirmed());
      await getPromiseDetail(AUTH);
      expect(tx.participant.findMany).toHaveBeenCalledWith({
        where: { promiseId: PROMISE_ID, status: "active", availabilitySubmittedAt: { not: null } },
        select: {
          status: true,
          availabilitySubmittedAt: true,
          availableSlots: {
            where: { slotStartAt: { gte: at(START), lt: at("2026-11-10T11:00:00+09:00") } },
            select: { slotStartAt: true },
          },
        },
      });
    });

    it("교집합 인원을 센다 (구간 전체 가능 2명, 일부만 가능 1명 제외)", async () => {
      prepare(confirmed(), {
        people: [
          person(["2026-11-10T10:00:00+09:00", "2026-11-10T10:30:00+09:00"]),
          person(["2026-11-10T10:00:00+09:00", "2026-11-10T10:30:00+09:00"]),
          person(["2026-11-10T10:30:00+09:00"]),
        ],
      });
      expect(await getPromiseDetail(AUTH)).toMatchObject({
        kind: "ok",
        availableParticipantCount: 2,
      });
    });

    it("확정 시각이 판정 시각보다 과거여도 센다 (미래 필터 없음)", async () => {
      prepare(confirmed({ confirmed_start_at: at("2026-11-01T10:00:00+09:00") }), {
        people: [
          person(["2026-11-01T10:00:00+09:00", "2026-11-01T10:30:00+09:00"]),
          person(["2026-11-01T10:00:00+09:00", "2026-11-01T10:30:00+09:00"]),
          person(["2026-11-01T10:00:00+09:00", "2026-11-01T10:30:00+09:00"]),
        ],
      });
      expect(await getPromiseDetail(AUTH)).toMatchObject({ availableParticipantCount: 3 });
    });

    it("확정 구간이 현재 날짜·하루 범위 밖이어도 범위 검사 없이 센다", async () => {
      prepare(
        confirmed({
          confirmed_start_at: at("2026-11-20T20:00:00+09:00"),
          daily_end_minute: 12 * 60,
        }),
        {
          people: [person(["2026-11-20T20:00:00+09:00", "2026-11-20T20:30:00+09:00"])],
        },
      );
      expect(await getPromiseDetail(AUTH)).toMatchObject({ availableParticipantCount: 1 });
    });

    it("소요 시간은 현재 값으로: 90분이면 세 슬롯을 읽는다", async () => {
      prepare(confirmed({ duration_minutes: 90 }));
      await getPromiseDetail(AUTH);
      expect(
        tx.participant.findMany.mock.calls[0][0].select.availableSlots.where.slotStartAt.lt,
      ).toEqual(at("2026-11-10T11:30:00+09:00"));
    });

    it("제출자가 없으면 0", async () => {
      prepare(confirmed());
      expect(await getPromiseDetail(AUTH)).toMatchObject({ availableParticipantCount: 0 });
    });

    it("confirmed인데 확정 시각이 없으면 데이터 오류로 예외", async () => {
      prepare(confirmed({ confirmed_start_at: null }));
      await expect(getPromiseDetail(AUTH)).rejects.toThrow();
    });
  });
});
