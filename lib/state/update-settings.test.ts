import { beforeEach, describe, expect, it, vi } from "vitest";

// 메모리 가짜 DB. 서비스가 쓰는 tx 메서드만 흉내 내고, 테스트는 실행된 SQL이 아니라 끝난 뒤의 상태를 본다
type Slot = { id: string; slotStartAt: Date };
type Person = {
  id: string;
  role: string;
  status: string;
  availabilitySubmittedAt: Date | null;
  availabilityVersion: number;
  slots: Slot[];
};
type Session = { id: string; participantId: string; expiresAt: Date };
type PromiseRow = {
  id: string;
  status: string;
  participant_limit: number;
  date_range_start: string;
  date_range_end: string;
  daily_start_minute: number;
  daily_end_minute: number;
  duration_minutes: number;
  voting_deadline_at: Date;
  confirmed_start_at: Date | null;
  link_created_at: Date;
};

const db = vi.hoisted(() => ({
  promise: null as unknown as PromiseRow | null,
  people: [] as unknown as Person[],
  sessions: [] as unknown as Session[],
  now: new Date(0),
}));

const sqlOf = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ").trim();

const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = sqlOf(strings);
    if (sql.includes("clock_timestamp()")) return [{ now: db.now }];
    if (sql.includes("FOR UPDATE")) return db.promise ? [{ ...db.promise }] : [];
    if (sql.startsWith("UPDATE participant_sessions")) {
      const [expiresAt, , now] = values as [Date, string, Date];
      const touched = db.sessions.filter((s) => {
        const person = db.people.find((p) => p.id === s.participantId);
        return person?.status === "active" && s.expiresAt.getTime() > now.getTime();
      });
      for (const s of touched) s.expiresAt = expiresAt;
      return touched.map((s) => ({ id: s.id }));
    }
    throw new Error(`예상하지 못한 SQL: ${sql}`);
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
    const sql = sqlOf(strings);
    if (sql.startsWith("UPDATE promises SET status = 'closed'") && db.promise?.status === "collecting") {
      db.promise.status = "closed";
      return 1;
    }
    throw new Error(`예상하지 못한 SQL: ${sql}`);
  }),
  participantSession: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const s = db.sessions.find((row) => row.id === where.id);
      if (!s) return null;
      const p = db.people.find((row) => row.id === s.participantId)!;
      return {
        expiresAt: s.expiresAt,
        participant: { id: p.id, promiseId: PROMISE_ID, role: p.role, status: p.status },
      };
    }),
  },
  participant: {
    findMany: vi.fn(async ({ where }: { where: { status: string } }) =>
      db.people
        .filter((p) => p.status === where.status)
        .map((p) => ({
          id: p.id,
          availableSlots: p.slots.map((s) => ({ id: s.id, slotStartAt: s.slotStartAt })),
        })),
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { availabilityVersion: { increment: number }; availabilitySubmittedAt?: null };
      }) => {
        const targets = db.people.filter((p) => where.id.in.includes(p.id));
        for (const p of targets) {
          p.availabilityVersion += data.availabilityVersion.increment;
          if ("availabilitySubmittedAt" in data) p.availabilitySubmittedAt = null;
        }
        return { count: targets.length };
      },
    ),
  },
  participantAvailableSlot: {
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      let count = 0;
      for (const p of db.people) {
        const before = p.slots.length;
        p.slots = p.slots.filter((s) => !where.id.in.includes(s.id));
        count += before - p.slots.length;
      }
      return { count };
    }),
  },
  promise: {
    update: vi.fn(
      async ({
        data,
      }: {
        data: {
          participantLimit: number;
          dateRangeStart: Date;
          dateRangeEnd: Date;
          dailyStartMinute: number;
          dailyEndMinute: number;
          durationMinutes: number;
          votingDeadlineAt: Date;
          status?: string;
          confirmedStartAt?: null;
        };
      }) => {
        const row = db.promise!;
        row.participant_limit = data.participantLimit;
        row.date_range_start = data.dateRangeStart.toISOString().slice(0, 10);
        row.date_range_end = data.dateRangeEnd.toISOString().slice(0, 10);
        row.daily_start_minute = data.dailyStartMinute;
        row.daily_end_minute = data.dailyEndMinute;
        row.duration_minutes = data.durationMinutes;
        row.voting_deadline_at = data.votingDeadlineAt;
        if (data.status !== undefined) row.status = data.status;
        if (data.confirmedStartAt !== undefined) row.confirmed_start_at = data.confirmedStartAt;
        return { id: row.id };
      },
    ),
  },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { updateSettings } from "./update-settings";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-11-08T12:00:00.400+09:00");
const OLD_DEADLINE = new Date("2026-11-09T18:00:00+09:00");
const LATER_DEADLINE = new Date("2026-11-09T21:00:00+09:00");
const SUBMITTED = new Date("2026-11-08T09:00:00+09:00");
const at = (iso: string) => new Date(`${iso}:00+09:00`);
const OLD_EXPIRY = new Date(OLD_DEADLINE.getTime() + 7 * DAY);
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: OLD_EXPIRY },
  now: new Date(NOW.getTime() - 50),
};

// 모집 중 약속: 11-10~11-12, 09:00~12:00, 60분, 정원 5, 마감 11-09 18:00
// 방장·참여자 B는 제출, C는 미제출, D는 탈퇴
function seed(status = "collecting") {
  db.now = NOW;
  db.promise = {
    id: PROMISE_ID,
    status,
    participant_limit: 5,
    date_range_start: "2026-11-10",
    date_range_end: "2026-11-12",
    daily_start_minute: 540,
    daily_end_minute: 720,
    duration_minutes: 60,
    voting_deadline_at: OLD_DEADLINE,
    confirmed_start_at: status === "confirmed" ? at("2026-11-10T09:00") : null,
    link_created_at: new Date("2026-11-01T10:00:00+09:00"),
  };
  db.people = [
    {
      id: "pt-1", role: "host", status: "active", availabilitySubmittedAt: SUBMITTED, availabilityVersion: 2,
      slots: [
        { id: "a1", slotStartAt: at("2026-11-10T09:00") },
        { id: "a2", slotStartAt: at("2026-11-12T11:00") },
      ],
    },
    {
      id: "pt-2", role: "member", status: "active", availabilitySubmittedAt: SUBMITTED, availabilityVersion: 1,
      slots: [{ id: "b1", slotStartAt: at("2026-11-11T10:00") }],
    },
    { id: "pt-3", role: "member", status: "active", availabilitySubmittedAt: null, availabilityVersion: 0, slots: [] },
    {
      id: "pt-4", role: "member", status: "cancelled", availabilitySubmittedAt: SUBMITTED, availabilityVersion: 1,
      slots: [{ id: "d1", slotStartAt: at("2026-11-12T11:00") }],
    },
  ];
  db.sessions = [
    { id: "s-1", participantId: "pt-1", expiresAt: OLD_EXPIRY },
    { id: "s-2", participantId: "pt-2", expiresAt: OLD_EXPIRY },
    { id: "s-old", participantId: "pt-2", expiresAt: new Date(NOW.getTime() - 1) },
    { id: "s-4", participantId: "pt-4", expiresAt: NOW },
  ];
}

function person(id: string) {
  const p = db.people.find((row) => row.id === id)!;
  return {
    submitted: p.availabilitySubmittedAt !== null,
    version: p.availabilityVersion,
    slots: p.slots.map((s) => s.id),
  };
}

const unchangedPeople = () => ({
  "pt-1": { submitted: true, version: 2, slots: ["a1", "a2"] },
  "pt-2": { submitted: true, version: 1, slots: ["b1"] },
  "pt-3": { submitted: false, version: 0, slots: [] },
  "pt-4": { submitted: true, version: 1, slots: ["d1"] },
});
const peopleNow = () =>
  Object.fromEntries(["pt-1", "pt-2", "pt-3", "pt-4"].map((id) => [id, person(id)]));
const sessionsNow = () => Object.fromEntries(db.sessions.map((s) => [s.id, s.expiresAt]));
const unchangedSessions = () => ({
  "s-1": OLD_EXPIRY,
  "s-2": OLD_EXPIRY,
  "s-old": new Date(NOW.getTime() - 1),
  "s-4": NOW,
});
const unchangedPromise = () => ({
  status: "collecting",
  participant_limit: 5,
  date_range_start: "2026-11-10",
  date_range_end: "2026-11-12",
  daily_start_minute: 540,
  daily_end_minute: 720,
  duration_minutes: 60,
  voting_deadline_at: OLD_DEADLINE,
});

describe("updateSettings (STATE-API-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("정원을 줄이면 422 CAPACITY_DECREASE_NOT_ALLOWED이고 아무것도 바뀌지 않는다", async () => {
    const result = await updateSettings(AUTH, { participantLimit: 4 });

    expect(result).toMatchObject({
      kind: "validation_failed",
      violation: { field: "participantLimit", code: "CAPACITY_DECREASE_NOT_ALLOWED" },
    });
    expect(db.promise).toMatchObject(unchangedPromise());
    expect(peopleNow()).toEqual(unchangedPeople());
    expect(sessionsNow()).toEqual(unchangedSessions());
  });

  it("마감만 연장하면 슬롯·제출·버전은 그대로이고 세션만 새 마감 + 7일로 갱신된다", async () => {
    const result = await updateSettings(AUTH, { votingDeadlineAt: LATER_DEADLINE });

    const renewed = new Date(LATER_DEADLINE.getTime() + 7 * DAY);
    expect(result.kind).toBe("ok");
    expect(db.promise).toMatchObject({ ...unchangedPromise(), voting_deadline_at: LATER_DEADLINE });
    expect(peopleNow()).toEqual(unchangedPeople());
    expect(sessionsNow()).toEqual({
      "s-1": renewed,
      "s-2": renewed,
      "s-old": new Date(NOW.getTime() - 1), // 만료된 세션은 되살리지 않는다
      "s-4": NOW, // 탈퇴자 세션도 그대로
    });
    expect(result.session).toEqual({ expiresAt: renewed, now: NOW });
  });

  const impactOf = (result: Awaited<ReturnType<typeof updateSettings>>) =>
    result.kind === "ok" ? result.changeImpact : null;
  const NO_IMPACT = {
    rangeChanged: false,
    hasAddedSelectableSlots: false,
    submissionsReset: false,
    removedSlotCount: 0,
    versionChangedParticipantCount: 0,
    candidateRecalculationRequired: false,
  };

  describe("정원", () => {
    it("늘리면 정원만 바뀌고 슬롯·제출·버전·세션은 그대로", async () => {
      const result = await updateSettings(AUTH, { participantLimit: 8 });
      expect(impactOf(result)).toEqual(NO_IMPACT);
      expect(db.promise).toMatchObject({ ...unchangedPromise(), participant_limit: 8 });
      expect(peopleNow()).toEqual(unchangedPeople());
      expect(sessionsNow()).toEqual(unchangedSessions());
      expect(result.session).toEqual({ expiresAt: OLD_EXPIRY, now: NOW });
    });

    it("같은 값은 변경 없음으로 허용", async () => {
      expect((await updateSettings(AUTH, { participantLimit: 5 })).kind).toBe("ok");
    });

    it("active 인원(3명)보다 작으면 공통 규칙이 먼저 — CAPACITY_BELOW_ACTIVE_COUNT", async () => {
      const result = await updateSettings(AUTH, { participantLimit: 2 });
      expect(result).toMatchObject({
        kind: "validation_failed",
        violation: { field: "participantLimit", code: "CAPACITY_BELOW_ACTIVE_COUNT" },
      });
      expect(db.promise).toMatchObject(unchangedPromise());
    });

    it("31명이면 VALIDATION_FAILED(전용 코드 없음)", async () => {
      const result = await updateSettings(AUTH, { participantLimit: 31 });
      expect(result).toMatchObject({ kind: "validation_failed", violation: { field: "participantLimit" } });
      expect(result.kind === "validation_failed" && result.violation.code).toBeUndefined();
    });
  });

  describe("마감", () => {
    it("앞당기면 422 DEADLINE_SHORTEN_NOT_ALLOWED이고 아무것도 바뀌지 않는다", async () => {
      const result = await updateSettings(AUTH, {
        votingDeadlineAt: new Date(OLD_DEADLINE.getTime() - 60 * 60_000),
      });
      expect(result).toMatchObject({
        kind: "validation_failed",
        violation: { field: "votingDeadlineAt", code: "DEADLINE_SHORTEN_NOT_ALLOWED" },
      });
      expect(db.promise).toMatchObject(unchangedPromise());
      expect(peopleNow()).toEqual(unchangedPeople());
      expect(sessionsNow()).toEqual(unchangedSessions());
    });

    it("현재보다 과거면 공통 규칙이 먼저 — VALIDATION_FAILED", async () => {
      const result = await updateSettings(AUTH, { votingDeadlineAt: new Date(NOW.getTime() - 1) });
      expect(result).toMatchObject({ kind: "validation_failed", violation: { field: "votingDeadlineAt" } });
      expect(result.kind === "validation_failed" && result.violation.code).toBeUndefined();
    });

    it("기존과 같은 값은 변경 없음으로 허용하고 세션을 갱신하지 않는다", async () => {
      const result = await updateSettings(AUTH, { votingDeadlineAt: new Date(OLD_DEADLINE) });
      expect(impactOf(result)).toEqual(NO_IMPACT);
      expect(sessionsNow()).toEqual(unchangedSessions());
    });

    it("연장해도 마지막 날짜 00:00 이상이면 VALIDATION_FAILED", async () => {
      const result = await updateSettings(AUTH, { votingDeadlineAt: at("2026-11-12T00:00") });
      expect(result).toMatchObject({ kind: "validation_failed", violation: { field: "votingDeadlineAt" } });
      expect(sessionsNow()).toEqual(unchangedSessions());
    });

    it("범위를 줄여 기존 마감이 새 마지막 날짜 00:00 이후가 되면 VALIDATION_FAILED(마감은 그대로라도)", async () => {
      const result = await updateSettings(AUTH, { dateRange: { startDate: "2026-11-09", endDate: "2026-11-09" } });
      expect(result).toMatchObject({ kind: "validation_failed", violation: { field: "votingDeadlineAt" } });
      expect(peopleNow()).toEqual(unchangedPeople());
    });
  });

  describe("범위 변경 (STATE-09-03·09-04)", () => {
    it("날짜 확대: 모든 active 참여자 제출 해제·버전 +1(미제출자 포함), 슬롯·탈퇴자 그대로, 세션 그대로", async () => {
      const result = await updateSettings(AUTH, { dateRange: { startDate: "2026-11-10", endDate: "2026-11-13" } });
      expect(impactOf(result)).toEqual({
        rangeChanged: true,
        hasAddedSelectableSlots: true,
        submissionsReset: true,
        removedSlotCount: 0,
        versionChangedParticipantCount: 3,
        candidateRecalculationRequired: true,
      });
      expect(peopleNow()).toEqual({
        "pt-1": { submitted: false, version: 3, slots: ["a1", "a2"] },
        "pt-2": { submitted: false, version: 2, slots: ["b1"] },
        "pt-3": { submitted: false, version: 1, slots: [] },
        "pt-4": { submitted: true, version: 1, slots: ["d1"] },
      });
      expect(db.promise).toMatchObject({ status: "collecting", date_range_end: "2026-11-13" });
      expect(sessionsNow()).toEqual(unchangedSessions());
    });

    it("날짜 축소: 제출 유지, 슬롯이 지워진 방장만 버전 +1", async () => {
      const result = await updateSettings(AUTH, { dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" } });
      expect(impactOf(result)).toEqual({
        rangeChanged: true,
        hasAddedSelectableSlots: false,
        submissionsReset: false,
        removedSlotCount: 1,
        versionChangedParticipantCount: 1,
        candidateRecalculationRequired: true,
      });
      expect(peopleNow()).toEqual({
        "pt-1": { submitted: true, version: 3, slots: ["a1"] },
        "pt-2": { submitted: true, version: 1, slots: ["b1"] },
        "pt-3": { submitted: false, version: 0, slots: [] },
        "pt-4": { submitted: true, version: 1, slots: ["d1"] },
      });
    });

    it("이동(11-11~11-13): 범위 밖 슬롯 삭제와 전원 제출 해제·버전 +1", async () => {
      const result = await updateSettings(AUTH, { dateRange: { startDate: "2026-11-11", endDate: "2026-11-13" } });
      expect(impactOf(result)).toMatchObject({ removedSlotCount: 1, submissionsReset: true, versionChangedParticipantCount: 3 });
      expect(person("pt-1")).toEqual({ submitted: false, version: 3, slots: ["a2"] });
      expect(person("pt-2")).toEqual({ submitted: false, version: 2, slots: ["b1"] });
    });

    it("하루 범위 축소(10:00~12:00): 09:00 슬롯이 있던 방장만 버전 +1, 제출 유지", async () => {
      const result = await updateSettings(AUTH, { dailyTimeRange: { startMinute: 600, endMinute: 720 } });
      expect(impactOf(result)).toMatchObject({ rangeChanged: true, submissionsReset: false, removedSlotCount: 1 });
      expect(person("pt-1")).toEqual({ submitted: true, version: 3, slots: ["a2"] });
      expect(person("pt-2")).toEqual({ submitted: true, version: 1, slots: ["b1"] });
      expect(db.promise).toMatchObject({ daily_start_minute: 600, daily_end_minute: 720 });
    });

    it("하루 범위 확대(~13:00): 전원 제출 해제", async () => {
      const result = await updateSettings(AUTH, { dailyTimeRange: { startMinute: 540, endMinute: 780 } });
      expect(impactOf(result)).toMatchObject({ submissionsReset: true, versionChangedParticipantCount: 3 });
    });

    it("같은 범위를 다시 보내면 rangeChanged=false, 아무것도 바뀌지 않는다", async () => {
      const result = await updateSettings(AUTH, {
        dateRange: { startDate: "2026-11-10", endDate: "2026-11-12" },
        dailyTimeRange: { startMinute: 540, endMinute: 720 },
      });
      expect(impactOf(result)).toEqual(NO_IMPACT);
      expect(peopleNow()).toEqual(unchangedPeople());
    });

    it("소요 시간만: 슬롯·제출·버전 그대로, 후보 재계산만 필요", async () => {
      const result = await updateSettings(AUTH, { durationMinutes: 120 });
      expect(impactOf(result)).toEqual({ ...NO_IMPACT, candidateRecalculationRequired: true });
      expect(peopleNow()).toEqual(unchangedPeople());
      expect(db.promise).toMatchObject({ ...unchangedPromise(), duration_minutes: 120 });
    });

    it("소요 시간이 유지한 하루 범위보다 길면 VALIDATION_FAILED", async () => {
      const result = await updateSettings(AUTH, { durationMinutes: 210 });
      expect(result).toMatchObject({ kind: "validation_failed", violation: { field: "durationMinutes" } });
    });

    it("보낸 시작 날짜가 어제면 VALIDATION_FAILED(시작 날짜 하한, R-12)", async () => {
      const result = await updateSettings(AUTH, { dateRange: { startDate: "2026-11-07", endDate: "2026-11-12" } });
      expect(result).toMatchObject({ kind: "validation_failed", violation: { field: "dateRange" } });
    });

    it("dateRange를 생략하면 이미 지난 기존 시작일이어도 다른 값을 바꿀 수 있다 (R-26)", async () => {
      db.promise!.date_range_start = "2026-11-01";
      const result = await updateSettings(AUTH, { participantLimit: 6 });
      expect(result.kind).toBe("ok");
      expect(db.promise).toMatchObject({ date_range_start: "2026-11-01", participant_limit: 6 });
    });

    it.each([
      ["2027-02-08(3개월 경계) 허용", "2027-02-08", "ok"],
      ["2027-02-09 거절", "2027-02-09", "validation_failed"],
    ])("종료일 %s (R-07)", async (_n, endDate, kind) => {
      const result = await updateSettings(AUTH, { dateRange: { startDate: "2026-11-10", endDate } });
      expect(result.kind).toBe(kind);
    });

    it("범위 확대와 마감 연장을 함께: 제출 해제와 세션 갱신이 같이 일어난다", async () => {
      const result = await updateSettings(AUTH, {
        dateRange: { startDate: "2026-11-10", endDate: "2026-11-13" },
        votingDeadlineAt: LATER_DEADLINE,
      });
      expect(impactOf(result)).toMatchObject({ submissionsReset: true });
      expect(sessionsNow()["s-1"]).toEqual(new Date(LATER_DEADLINE.getTime() + 7 * DAY));
    });
  });

  describe("상태", () => {
    it("잠금 후 마감 시각이면 closed를 저장하고 invalid_state, 설정은 그대로", async () => {
      db.now = OLD_DEADLINE; // 경계값: 판정 시각 = 마감이면 지난 것
      const result = await updateSettings(AUTH, { participantLimit: 8 });
      expect(result).toMatchObject({ kind: "invalid_state", promiseStatus: "closed" });
      expect(db.promise).toMatchObject({ ...unchangedPromise(), status: "closed" });
      expect(peopleNow()).toEqual(unchangedPeople());
      expect(sessionsNow()).toEqual(unchangedSessions());
    });

    it("마감 1ms 전이면 변경한다", async () => {
      db.now = new Date(OLD_DEADLINE.getTime() - 1);
      expect((await updateSettings(AUTH, { participantLimit: 8 })).kind).toBe("ok");
    });

    it.each(["closed", "confirmed", "draft"])("%s → invalid_state, 아무것도 바꾸지 않는다", async (status) => {
      seed(status);
      const result = await updateSettings(AUTH, { participantLimit: 8 });
      expect(result).toMatchObject({ kind: "invalid_state", promiseStatus: status });
      expect(db.promise).toMatchObject({ ...unchangedPromise(), status });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it("잠금 후 cancelled면 세션 재확인 전에 cancelled", async () => {
      seed("cancelled");
      expect(await updateSettings(AUTH, { participantLimit: 8 })).toEqual({
        kind: "cancelled",
        session: { expiresAt: OLD_EXPIRY, now: NOW },
      });
      expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    });

    it("잠금 후 최신 역할이 member면 forbidden, 변경 없음", async () => {
      db.people[0].role = "member";
      expect((await updateSettings(AUTH, { participantLimit: 8 })).kind).toBe("forbidden");
      expect(db.promise).toMatchObject(unchangedPromise());
    });

    it.each([
      ["세션 만료(판정 시각과 같음)", () => (db.sessions[0].expiresAt = NOW)],
      ["탈퇴한 방장", () => (db.people[0].status = "cancelled")],
    ])("잠금 후 %s → unauthenticated, 변경 없음", async (_n, mutate) => {
      mutate();
      expect((await updateSettings(AUTH, { participantLimit: 8 })).kind).toBe("unauthenticated");
      expect(db.promise).toMatchObject(unchangedPromise());
    });

    it("잠금 후 약속이 없으면 not_found, 쿠키 삭제", async () => {
      db.promise = null;
      expect(await updateSettings(AUTH, { participantLimit: 8 })).toEqual({
        kind: "not_found",
        session: { expiresAt: null, now: NOW },
      });
    });
  });

  describe("같은 방장의 연속 요청(잠금으로 직렬화된 결과)", () => {
    it("정원 8 → 정원 6: 두 번째는 첫 번째 결과 기준으로 감소라 거절된다", async () => {
      expect((await updateSettings(AUTH, { participantLimit: 8 })).kind).toBe("ok");
      const second = await updateSettings(AUTH, { participantLimit: 6 });
      expect(second).toMatchObject({ violation: { code: "CAPACITY_DECREASE_NOT_ALLOWED" } });
      expect(db.promise?.participant_limit).toBe(8);
    });

    it("마감 연장 → 다른 필드 변경: 두 변경이 모두 남는다", async () => {
      await updateSettings(AUTH, { votingDeadlineAt: LATER_DEADLINE });
      await updateSettings(AUTH, { durationMinutes: 90 });
      expect(db.promise).toMatchObject({ voting_deadline_at: LATER_DEADLINE, duration_minutes: 90 });
    });

    it("같은 축소를 두 번: 두 번째는 지울 슬롯이 없어 버전을 다시 올리지 않는다", async () => {
      const range = { dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" } };
      await updateSettings(AUTH, range);
      const second = await updateSettings(AUTH, range);
      expect(impactOf(second)).toEqual(NO_IMPACT);
      expect(person("pt-1")).toEqual({ submitted: true, version: 3, slots: ["a1"] });
    });
  });

  it("저장 중 오류는 그대로 던져 전체가 롤백된다", async () => {
    const failure = new Error("update failed");
    tx.promise.update.mockRejectedValueOnce(failure);
    await expect(updateSettings(AUTH, { participantLimit: 8 })).rejects.toBe(failure);
  });
});
