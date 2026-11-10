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
    if (
      sql.startsWith("UPDATE promises SET status = 'closed'") &&
      db.promise?.status === "collecting"
    ) {
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
          status: string;
          confirmedStartAt: null;
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
        row.status = data.status;
        row.confirmed_start_at = data.confirmedStartAt;
        return { id: row.id };
      },
    ),
  },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { reopenPromise } from "./reopen-promise";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-11-08T12:00:00.400+09:00");
const OLD_DEADLINE = new Date("2026-11-08T10:00:00+09:00");
const NEW_DEADLINE = new Date("2026-11-09T18:00:00+09:00");
const SUBMITTED = new Date("2026-11-07T20:00:00+09:00");
const at = (iso: string) => new Date(`${iso}:00+09:00`);
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "closed", promiseLinkId: "l-1" },
  participant: { id: "pt-1", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: new Date(OLD_DEADLINE.getTime() + 7 * DAY) },
  now: new Date(NOW.getTime() - 50),
};

// closed 약속: 11-10~11-12, 09:00~12:00, 60분. 방장·참여자 B는 제출, C는 미제출, D는 탈퇴
function seed(status = "closed") {
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
      id: "pt-1",
      role: "host",
      status: "active",
      availabilitySubmittedAt: SUBMITTED,
      availabilityVersion: 2,
      slots: [
        { id: "a1", slotStartAt: at("2026-11-10T09:00") },
        { id: "a2", slotStartAt: at("2026-11-12T11:00") },
      ],
    },
    {
      id: "pt-2",
      role: "member",
      status: "active",
      availabilitySubmittedAt: SUBMITTED,
      availabilityVersion: 1,
      slots: [{ id: "b1", slotStartAt: at("2026-11-11T10:00") }],
    },
    {
      id: "pt-3",
      role: "member",
      status: "active",
      availabilitySubmittedAt: null,
      availabilityVersion: 0,
      slots: [],
    },
    {
      id: "pt-4",
      role: "member",
      status: "cancelled",
      availabilitySubmittedAt: SUBMITTED,
      availabilityVersion: 1,
      slots: [{ id: "d1", slotStartAt: at("2026-11-12T11:00") }],
    },
  ];
  db.sessions = [
    { id: "s-1", participantId: "pt-1", expiresAt: AUTH.session.expiresAt },
    { id: "s-2", participantId: "pt-2", expiresAt: AUTH.session.expiresAt },
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

describe("reopenPromise (STATE-API-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("범위를 넓히면 모든 active 참여자의 제출을 해제하고 버전을 올린다", async () => {
    const result = await reopenPromise(AUTH, {
      votingDeadlineAt: NEW_DEADLINE,
      dateRange: { startDate: "2026-11-10", endDate: "2026-11-13" },
    });

    expect(result.kind).toBe("ok");
    expect(db.promise).toMatchObject({
      status: "collecting",
      date_range_end: "2026-11-13",
      voting_deadline_at: NEW_DEADLINE,
      confirmed_start_at: null,
    });
    expect(person("pt-1")).toEqual({ submitted: false, version: 3, slots: ["a1", "a2"] });
    expect(person("pt-2")).toEqual({ submitted: false, version: 2, slots: ["b1"] });
    expect(person("pt-3")).toEqual({ submitted: false, version: 1, slots: [] }); // 미제출자도 버전 증가
    expect(person("pt-4")).toEqual({ submitted: true, version: 1, slots: ["d1"] }); // 탈퇴자는 그대로
    expect(result.kind === "ok" && result.changeImpact).toEqual({
      hasAddedSelectableSlots: true,
      submissionsReset: true,
      removedSlotCount: 0,
      versionChangedParticipantCount: 3,
      confirmationCleared: false,
    });
  });

  it("축소만 하면 제출은 유지하고 슬롯이 지워진 참여자만 버전을 올린다", async () => {
    const result = await reopenPromise(AUTH, {
      votingDeadlineAt: NEW_DEADLINE,
      dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" },
    });

    expect(result.kind).toBe("ok");
    expect(db.promise).toMatchObject({ status: "collecting", date_range_end: "2026-11-11" });
    expect(person("pt-1")).toEqual({ submitted: true, version: 3, slots: ["a1"] });
    expect(person("pt-2")).toEqual({ submitted: true, version: 1, slots: ["b1"] });
    expect(person("pt-3")).toEqual({ submitted: false, version: 0, slots: [] });
    expect(person("pt-4")).toEqual({ submitted: true, version: 1, slots: ["d1"] });
    expect(result.kind === "ok" && result.changeImpact).toEqual({
      hasAddedSelectableSlots: false,
      submissionsReset: false,
      removedSlotCount: 1,
      versionChangedParticipantCount: 1,
      confirmationCleared: false,
    });
  });

  // 이하 공통 확인용
  const unchangedPeople = () => ({
    "pt-1": { submitted: true, version: 2, slots: ["a1", "a2"] },
    "pt-2": { submitted: true, version: 1, slots: ["b1"] },
    "pt-3": { submitted: false, version: 0, slots: [] },
    "pt-4": { submitted: true, version: 1, slots: ["d1"] },
  });
  const peopleNow = () =>
    Object.fromEntries(["pt-1", "pt-2", "pt-3", "pt-4"].map((id) => [id, person(id)]));

  it("이동(일부 겹침): 범위 밖 슬롯 삭제와 전원 제출 해제·버전 증가가 함께 일어난다", async () => {
    const result = await reopenPromise(AUTH, {
      votingDeadlineAt: NEW_DEADLINE,
      dateRange: { startDate: "2026-11-11", endDate: "2026-11-13" },
    });
    expect(result.kind === "ok" && result.changeImpact).toMatchObject({
      hasAddedSelectableSlots: true,
      submissionsReset: true,
      removedSlotCount: 1,
      versionChangedParticipantCount: 3,
    });
    expect(person("pt-1")).toEqual({ submitted: false, version: 3, slots: ["a2"] });
    expect(person("pt-3")).toEqual({ submitted: false, version: 1, slots: [] });
  });

  it("하루 범위만 줄이면(10:00~12:00) 09:00 슬롯이 있던 방장만 버전 증가, 제출 유지", async () => {
    await reopenPromise(AUTH, {
      votingDeadlineAt: NEW_DEADLINE,
      dailyTimeRange: { startMinute: 600, endMinute: 720 },
    });
    expect(db.promise).toMatchObject({
      daily_start_minute: 600,
      daily_end_minute: 720,
      date_range_end: "2026-11-12",
    });
    expect(person("pt-1")).toEqual({ submitted: true, version: 3, slots: ["a2"] });
    expect(person("pt-2")).toEqual({ submitted: true, version: 1, slots: ["b1"] });
  });

  it("소요 시간만 바꾸면 슬롯·제출·버전은 그대로, 소요 시간과 상태만 바뀐다", async () => {
    const result = await reopenPromise(AUTH, {
      votingDeadlineAt: NEW_DEADLINE,
      durationMinutes: 120,
    });
    expect(result.kind === "ok" && result.changeImpact).toEqual({
      hasAddedSelectableSlots: false,
      submissionsReset: false,
      removedSlotCount: 0,
      versionChangedParticipantCount: 0,
      confirmationCleared: false,
    });
    expect(peopleNow()).toEqual(unchangedPeople());
    expect(db.promise).toMatchObject({
      status: "collecting",
      duration_minutes: 120,
      date_range_start: "2026-11-10",
    });
  });

  it("마감만 보내면 설정은 그대로 두고 상태·마감만 바뀐다", async () => {
    await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE });
    expect(peopleNow()).toEqual(unchangedPeople());
    expect(db.promise).toMatchObject({
      status: "collecting",
      participant_limit: 5,
      date_range_start: "2026-11-10",
      date_range_end: "2026-11-12",
      daily_start_minute: 540,
      daily_end_minute: 720,
      duration_minutes: 60,
      voting_deadline_at: NEW_DEADLINE,
    });
  });

  it("confirmed면 confirmed_start_at을 NULL로 하고 confirmationCleared=true", async () => {
    seed("confirmed");
    const result = await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE });
    expect(result.kind === "ok" && result.changeImpact.confirmationCleared).toBe(true);
    expect(db.promise).toMatchObject({ status: "collecting", confirmed_start_at: null });
    expect(peopleNow()).toEqual(unchangedPeople()); // 확정 해제만으로 입력을 지우지 않는다 (STATE-09-05)
  });

  it("마감이 지난 collecting은 closed로 보고 재조율한다", async () => {
    seed("collecting");
    const result = await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE });
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.changeImpact.confirmationCleared).toBe(false);
    expect(db.promise?.status).toBe("collecting");
    expect(db.promise?.voting_deadline_at).toEqual(NEW_DEADLINE);
  });

  it("마감이 지난 collecting의 closed 저장은 검증 실패(422)여도 남는다", async () => {
    seed("collecting");
    const result = await reopenPromise(AUTH, { votingDeadlineAt: new Date(NOW.getTime() - 1) });
    expect(result.kind).toBe("validation_failed");
    expect(db.promise?.status).toBe("closed");
  });

  it("마감 전 collecting(병렬 재조율의 두 번째 포함)은 invalid_state, 아무것도 바꾸지 않는다", async () => {
    const first = await reopenPromise(AUTH, {
      votingDeadlineAt: NEW_DEADLINE,
      dateRange: { startDate: "2026-11-10", endDate: "2026-11-13" },
    });
    expect(first.kind).toBe("ok");
    const snapshot = { promise: { ...db.promise }, people: peopleNow() };

    const second = await reopenPromise(AUTH, {
      votingDeadlineAt: new Date(NEW_DEADLINE.getTime() + DAY),
    });
    expect(second).toMatchObject({ kind: "invalid_state", promiseStatus: "collecting" });
    expect({ promise: db.promise, people: peopleNow() }).toEqual(snapshot);
  });

  it.each([
    ["draft", "draft"],
    ["10분 지난 draft도 삭제·410 없이", "draft"],
  ])("%s → invalid_state", async (_n, status) => {
    seed(status);
    expect(await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE })).toMatchObject({
      kind: "invalid_state",
      promiseStatus: "draft",
    });
    expect(db.promise?.status).toBe("draft");
  });

  it("잠금 후 cancelled면 세션 재확인 전에 cancelled, 변경 없음", async () => {
    seed("cancelled");
    expect(await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE })).toEqual({
      kind: "cancelled",
      session: { expiresAt: AUTH.session.expiresAt, now: NOW },
    });
    expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    expect(db.promise?.status).toBe("cancelled");
  });

  it("잠금 후 약속이 없으면 not_found, 쿠키 삭제", async () => {
    db.promise = null;
    expect(await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE })).toEqual({
      kind: "not_found",
      session: { expiresAt: null, now: NOW },
    });
  });

  it("잠금 후 세션 행이 없으면 unauthenticated, 쿠키 삭제", async () => {
    db.sessions = db.sessions.filter((s) => s.id !== "s-1");
    expect(await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE })).toEqual({
      kind: "unauthenticated",
      session: { expiresAt: null, now: NOW },
    });
  });

  it.each([
    ["세션 만료(판정 시각과 같음)", () => (db.sessions[0].expiresAt = NOW)],
    ["탈퇴한 방장", () => (db.people[0].status = "cancelled")],
  ])("잠금 후 %s → unauthenticated, 변경 없음", async (_n, mutate) => {
    mutate();
    expect((await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE })).kind).toBe(
      "unauthenticated",
    );
    expect(db.promise?.status).toBe("closed");
  });

  it("잠금 후 최신 역할이 member면 forbidden, 변경 없음", async () => {
    db.people[0].role = "member";
    expect(await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE })).toEqual({
      kind: "forbidden",
      session: { expiresAt: AUTH.session.expiresAt, now: NOW },
    });
    expect(db.promise?.status).toBe("closed");
  });

  it("인증 시점에는 member였어도 잠금 후 host면 재조율한다", async () => {
    const result = await reopenPromise(
      { ...AUTH, participant: { id: "pt-1", role: "member" } },
      { votingDeadlineAt: NEW_DEADLINE },
    );
    expect(result.kind).toBe("ok");
  });

  it("정원이 현재 active 인원(3명)보다 작으면 CAPACITY_BELOW_ACTIVE_COUNT, 아무것도 바꾸지 않는다", async () => {
    const result = await reopenPromise(AUTH, {
      votingDeadlineAt: NEW_DEADLINE,
      participantLimit: 2,
      dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" },
    });
    expect(result).toMatchObject({
      kind: "validation_failed",
      violation: { field: "participantLimit", code: "CAPACITY_BELOW_ACTIVE_COUNT" },
    });
    expect(peopleNow()).toEqual(unchangedPeople());
    expect(db.promise).toMatchObject({
      status: "closed",
      participant_limit: 5,
      date_range_end: "2026-11-12",
    });
  });

  it("정원은 active 인원과 같으면 허용(탈퇴자는 세지 않음), 줄이기도 가능", async () => {
    const result = await reopenPromise(AUTH, {
      votingDeadlineAt: NEW_DEADLINE,
      participantLimit: 3,
    });
    expect(result.kind).toBe("ok");
    expect(db.promise?.participant_limit).toBe(3);
  });

  it.each([
    ["과거 마감", { votingDeadlineAt: new Date(NOW.getTime() - 60_000) }, "votingDeadlineAt"],
    ["판정 시각과 같은 마감", { votingDeadlineAt: NOW }, "votingDeadlineAt"],
    [
      "마지막 날짜 00:00과 같은 마감",
      { votingDeadlineAt: at("2026-11-12T00:00") },
      "votingDeadlineAt",
    ],
    ["정원 31", { votingDeadlineAt: NEW_DEADLINE, participantLimit: 31 }, "participantLimit"],
    [
      "3개월 넘는 종료일",
      {
        votingDeadlineAt: NEW_DEADLINE,
        dateRange: { startDate: "2026-11-10", endDate: "2027-02-09" },
      },
      "dateRange",
    ],
    [
      "30분 경계가 아닌 하루 범위",
      { votingDeadlineAt: NEW_DEADLINE, dailyTimeRange: { startMinute: 555, endMinute: 720 } },
      "dailyTimeRange",
    ],
    [
      "유지한 소요 시간(60분)보다 짧은 하루 범위",
      { votingDeadlineAt: NEW_DEADLINE, dailyTimeRange: { startMinute: 540, endMinute: 570 } },
      "durationMinutes",
    ],
    [
      "보낸 시작 날짜가 어제",
      {
        votingDeadlineAt: NEW_DEADLINE,
        dateRange: { startDate: "2026-11-07", endDate: "2026-11-12" },
      },
      "dateRange",
    ],
  ])("%s → validation_failed(%s), 아무것도 바꾸지 않는다", async (_n, input, field) => {
    const result = await reopenPromise(AUTH, input as Parameters<typeof reopenPromise>[1]);
    expect(result).toMatchObject({ kind: "validation_failed", violation: { field } });
    expect(result.kind === "validation_failed" && result.violation.code).toBeUndefined();
    expect(peopleNow()).toEqual(unchangedPeople());
    expect(db.promise?.status).toBe("closed");
    expect(db.sessions[0].expiresAt).toEqual(AUTH.session.expiresAt);
  });

  it("dateRange를 생략하면 이미 지난 기존 시작일이어도 재조율한다(시작 날짜 하한은 보낼 때만)", async () => {
    db.promise!.date_range_start = "2026-11-01";
    const result = await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE });
    expect(result.kind).toBe("ok");
    expect(db.promise).toMatchObject({ status: "collecting", date_range_start: "2026-11-01" });
  });

  it("active 참여자의 유효 세션만 새 마감 + 7일로 갱신, 요청자 쿠키도 그 값", async () => {
    db.sessions.push({
      id: "s-old",
      participantId: "pt-2",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const result = await reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE });
    const renewed = new Date(NEW_DEADLINE.getTime() + 7 * DAY);
    expect(result.session).toEqual({ expiresAt: renewed, now: NOW });
    expect(Object.fromEntries(db.sessions.map((s) => [s.id, s.expiresAt]))).toEqual({
      "s-1": renewed,
      "s-2": renewed,
      "s-4": NOW, // 탈퇴자 세션은 되살리지 않는다
      "s-old": new Date(NOW.getTime() - 1), // 만료된 세션도 그대로
    });
  });

  it("confirmed에서 재조율하면 세션이 확정 + 7일에서 새 마감 + 7일로 짧아질 수 있다 (C-10)", async () => {
    seed("confirmed");
    const confirmedExpiry = new Date(at("2026-11-10T09:00").getTime() + 7 * DAY);
    db.sessions[0].expiresAt = confirmedExpiry;
    await reopenPromise(
      { ...AUTH, session: { ...AUTH.session, expiresAt: confirmedExpiry } },
      {
        votingDeadlineAt: NEW_DEADLINE,
      },
    );
    expect(db.sessions[0].expiresAt).toEqual(new Date(NEW_DEADLINE.getTime() + 7 * DAY));
    expect(db.sessions[0].expiresAt.getTime()).toBeLessThan(confirmedExpiry.getTime());
  });

  it("저장 중 오류는 그대로 던져 전체가 롤백된다", async () => {
    const failure = new Error("update failed");
    tx.promise.update.mockRejectedValueOnce(failure);
    await expect(reopenPromise(AUTH, { votingDeadlineAt: NEW_DEADLINE })).rejects.toBe(failure);
  });
});
