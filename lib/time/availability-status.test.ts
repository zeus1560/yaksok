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
import { getAvailabilityStatus } from "./availability-status";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const OTHER_PROMISE_ID = "0b5d1e7a-2c3f-4a6b-8d9e-1f2a3b4c5d6e";
const NOW = new Date("2026-11-10T12:10:00.123+09:00"); // 트랜잭션 now()
const DEADLINE = new Date("2026-11-11T18:00:00+09:00");
const SESSION_EXPIRES = new Date("2026-11-18T18:00:00+09:00");
const CREATED = new Date("2026-11-10T12:00:00.123+09:00");
const MIN = 60_000;
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-me", role: "member" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};
const at = (iso: string) => new Date(iso);
const PAST = "2026-11-10T11:00:00+09:00";
const SLOT_A = "2026-11-10T14:00:00+09:00";
const SLOT_B = "2026-11-10T14:30:00+09:00";

function promiseRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "collecting",
    created_at: CREATED,
    voting_deadline_at: DEADLINE,
    date_range_start: "2026-11-10",
    date_range_end: "2026-11-12",
    daily_start_minute: 9 * 60,
    daily_end_minute: 24 * 60,
    duration_minutes: 60,
    ...overrides,
  };
}

type Person = {
  id: string;
  nickname: string;
  role?: string;
  availabilityVersion?: number;
  availabilitySubmittedAt?: Date | null;
  slots?: string[];
};
const person = ({ slots = [], ...rest }: Person) => ({
  role: "member",
  availabilityVersion: 0,
  availabilitySubmittedAt: null,
  ...rest,
  availableSlots: slots.map((iso) => ({ slotStartAt: at(iso) })),
});

type SessionRow = {
  expiresAt?: Date;
  participant?: { id?: string; promiseId?: string; status?: string };
};

function prepare(
  row: unknown,
  {
    people = [person({ id: "pt-me", nickname: "나" })],
    session = {},
    sessionMissing = false,
  }: { people?: ReturnType<typeof person>[]; session?: SessionRow; sessionMissing?: boolean } = {},
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
            ...session.participant,
          },
        },
  );
  tx.participant.findMany.mockResolvedValue(people);
}

const keep = { session: { expiresAt: SESSION_EXPIRES, now: NOW } };

describe("getAvailabilityStatus (TIME-API-02)", () => {
  beforeEach(() => {
    txQueryResults.length = 0;
    vi.clearAllMocks();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("REPEATABLE READ 트랜잭션 하나, 판정 시각 now()를 먼저 읽고 잠금(FOR UPDATE) 없이 약속을 읽는다", async () => {
    prepare(promiseRow());

    await getAvailabilityStatus(AUTH);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    const sqls = tx.$queryRaw.mock.calls.map((call) =>
      ((call as unknown[])[0] as TemplateStringsArray).join("?"),
    );
    expect(sqls[0]).toContain("now()");
    expect(sqls[0]).not.toContain("clock_timestamp");
    expect(sqls[1]).toContain("FROM promises");
    expect(sqls.join(" ")).not.toMatch(/FOR UPDATE|FOR SHARE/i);
  });

  describe("판정", () => {
    it("cancelled → cancelled (세션 재확인 전)", async () => {
      prepare(promiseRow({ status: "cancelled" }));
      expect(await getAvailabilityStatus(AUTH)).toEqual({ kind: "cancelled", ...keep });
      expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    });

    it("진행 중 draft(생성 9분 59.999초) → not_open (PROMISE_NOT_OPEN)", async () => {
      prepare(promiseRow({ status: "draft", created_at: new Date(NOW.getTime() - 10 * MIN + 1) }));
      expect(await getAvailabilityStatus(AUTH)).toEqual({ kind: "not_open", ...keep });
      expect(tx.participant.findMany).not.toHaveBeenCalled();
    });

    it("10분 경계 draft(created_at + 10분 = 판정 시각) → draft_expired, 삭제 없음", async () => {
      prepare(promiseRow({ status: "draft", created_at: new Date(NOW.getTime() - 10 * MIN) }));
      expect(await getAvailabilityStatus(AUTH)).toEqual({ kind: "draft_expired", ...keep });
      // 가짜 tx에는 쓰기 메서드가 없으므로 호출됐다면 예외가 났다
    });

    it("collecting 마감 전 → collecting", async () => {
      prepare(promiseRow({ voting_deadline_at: new Date(NOW.getTime() + 1) }));
      const result = await getAvailabilityStatus(AUTH);
      expect(result).toMatchObject({ kind: "ok", status: "collecting" });
    });

    it("collecting 마감 경과(마감 = 판정 시각) → closed로 계산만, DB 쓰기 없음", async () => {
      prepare(promiseRow({ voting_deadline_at: NOW }));
      const result = await getAvailabilityStatus(AUTH);
      expect(result).toMatchObject({ kind: "ok", status: "closed" });
      expect(Object.keys(tx)).toEqual(["$queryRaw", "participantSession", "participant"]);
      expect(Object.keys(tx.participant)).toEqual(["findMany"]);
    });

    it.each(["closed", "confirmed"])("%s → 그대로 200", async (status) => {
      // 마감 전이라도 DB 상태를 그대로 쓴다
      prepare(promiseRow({ status }));
      expect(await getAvailabilityStatus(AUTH)).toMatchObject({ kind: "ok", status });
    });

    it("탈퇴 참여자(cancelled) → unauthenticated, 쿠키는 남은 세션 기준", async () => {
      prepare(promiseRow(), { session: { participant: { status: "cancelled" } } });
      expect(await getAvailabilityStatus(AUTH)).toEqual({ kind: "unauthenticated", ...keep });
      expect(tx.participant.findMany).not.toHaveBeenCalled();
    });

    it("탈퇴로 세션 즉시 만료(expires_at = 판정 시각) → unauthenticated", async () => {
      prepare(promiseRow(), { session: { expiresAt: NOW } });
      expect(await getAvailabilityStatus(AUTH)).toEqual({
        kind: "unauthenticated",
        session: { expiresAt: NOW, now: NOW },
      });
    });

    it("세션 행 없음 → unauthenticated, 쿠키 삭제(expiresAt null)", async () => {
      prepare(promiseRow(), { sessionMissing: true });
      expect(await getAvailabilityStatus(AUTH)).toEqual({
        kind: "unauthenticated",
        session: { expiresAt: null, now: NOW },
      });
    });

    it("세션 참여자가 다른 약속 소속 → unauthenticated", async () => {
      prepare(promiseRow(), { session: { participant: { promiseId: OTHER_PROMISE_ID } } });
      expect(await getAvailabilityStatus(AUTH)).toMatchObject({ kind: "unauthenticated" });
    });

    it("인증 뒤 약속 행이 사라짐(만료 draft 정리) → not_found, 쿠키 삭제", async () => {
      prepare(null);
      expect(await getAvailabilityStatus(AUTH)).toEqual({
        kind: "not_found",
        session: { expiresAt: null, now: NOW },
      });
    });
  });

  describe("응답 내용", () => {
    it("active 참여자만 등록순으로 조회하고, 제출자만 슬롯을 담는다", async () => {
      prepare(promiseRow(), {
        people: [
          person({
            id: "pt-host",
            nickname: "방장",
            role: "host",
            availabilityVersion: 2,
            availabilitySubmittedAt: at("2026-11-10T10:00:00.027+09:00"),
            slots: [SLOT_A, SLOT_B],
          }),
          // 미제출: 슬롯이 없다
          person({ id: "pt-none", nickname: "미제출" }),
          // 빈 선택 제출: 제출 시각은 있고 슬롯이 없다
          person({
            id: "pt-empty",
            nickname: "빈제출",
            availabilityVersion: 1,
            availabilitySubmittedAt: at("2026-11-10T11:00:00+09:00"),
          }),
          person({
            id: "pt-me",
            nickname: "나",
            availabilityVersion: 3,
            availabilitySubmittedAt: at("2026-11-10T11:30:00+09:00"),
            slots: [PAST, SLOT_A],
          }),
        ],
      });

      const result = await getAvailabilityStatus(AUTH);

      expect(tx.participant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { promiseId: PROMISE_ID, status: "active" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      );
      expect(result).toEqual({
        kind: "ok",
        status: "collecting",
        serverTime: NOW,
        settings: {
          dateRangeStart: "2026-11-10",
          dateRangeEnd: "2026-11-12",
          dailyStartMinute: 540,
          dailyEndMinute: 1440,
          durationMinutes: 60,
          votingDeadlineAt: DEADLINE,
        },
        participants: [
          {
            participantId: "pt-host",
            nickname: "방장",
            isHost: true,
            availableSlots: [at(SLOT_A), at(SLOT_B)],
          },
          { participantId: "pt-none", nickname: "미제출", isHost: false, availableSlots: [] },
          { participantId: "pt-empty", nickname: "빈제출", isHost: false, availableSlots: [] },
          // 지난 슬롯도 저장된 그대로
          {
            participantId: "pt-me",
            nickname: "나",
            isHost: false,
            availableSlots: [at(PAST), at(SLOT_A)],
          },
        ],
        me: { participantId: "pt-me", version: 3, submitted: true, slots: [at(PAST), at(SLOT_A)] },
        ...keep,
      });
    });

    it("미제출자와 빈 선택 제출자는 이름·ID 외 항목이 같다 (제출 여부·시각·version 비노출)", async () => {
      prepare(promiseRow(), {
        people: [
          person({ id: "pt-none", nickname: "가", availabilityVersion: 0 }),
          person({
            id: "pt-empty",
            nickname: "나나",
            availabilityVersion: 7,
            availabilitySubmittedAt: at("2026-11-10T11:00:00+09:00"),
          }),
          person({ id: "pt-me", nickname: "나" }),
        ],
      });

      const result = await getAvailabilityStatus(AUTH);
      if (result.kind !== "ok") throw new Error("ok가 아님");
      const [none, empty] = result.participants;
      const strip = (p: (typeof result.participants)[number]) => ({
        ...p,
        participantId: "",
        nickname: "",
      });
      expect(strip(none)).toEqual(strip(empty));
      expect(Object.keys(empty).sort()).toEqual([
        "availableSlots",
        "isHost",
        "nickname",
        "participantId",
      ]);
    });

    it("제출 해제(제출 시각 null, 슬롯 있음): 내 항목 availableSlots [], me.slots는 저장 슬롯, submitted false", async () => {
      prepare(promiseRow(), {
        people: [
          person({ id: "pt-me", nickname: "나", availabilityVersion: 4, slots: [SLOT_A, SLOT_B] }),
        ],
      });

      const result = await getAvailabilityStatus(AUTH);

      expect(result).toMatchObject({
        kind: "ok",
        participants: [{ participantId: "pt-me", availableSlots: [] }],
        me: {
          participantId: "pt-me",
          version: 4,
          submitted: false,
          slots: [at(SLOT_A), at(SLOT_B)],
        },
      });
    });

    it("탈퇴 참여자는 조회 조건(status active)으로 빠져 participants·인원 수에 없다", async () => {
      // DB가 active만 돌려준다고 가정한 결과 — 조건 자체는 위 테스트에서 확인
      prepare(promiseRow(), {
        people: [
          person({ id: "pt-host", nickname: "방장", role: "host" }),
          person({ id: "pt-me", nickname: "나" }),
        ],
      });
      const result = await getAvailabilityStatus(AUTH);
      expect(result).toMatchObject({ kind: "ok" });
      if (result.kind === "ok") {
        expect(result.participants.map((p) => p.participantId)).toEqual(["pt-host", "pt-me"]);
      }
    });

    it("재확인은 통과했지만 목록에 내가 없으면 unauthenticated", async () => {
      prepare(promiseRow(), {
        people: [person({ id: "pt-host", nickname: "방장", role: "host" })],
      });
      expect(await getAvailabilityStatus(AUTH)).toEqual({ kind: "unauthenticated", ...keep });
    });

    it("설정 값이 비어 있는 collecting → 예외(500)", async () => {
      prepare(promiseRow({ duration_minutes: null }));
      await expect(getAvailabilityStatus(AUTH)).rejects.toThrow();
    });
  });
});
