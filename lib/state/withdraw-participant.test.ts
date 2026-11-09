import { beforeEach, describe, expect, it, vi } from "vitest";

// 메모리 가짜 DB. 서비스가 쓰는 tx 메서드만 흉내 내고, 테스트는 실행된 SQL이 아니라 끝난 뒤의 상태를 본다
// 참여자 변경마다 DB 제약(방장 UNIQUE, host이면 active, cancelled이면 cancelled_at 있음)을 검사한다
type Person = {
  id: string;
  createdAt: Date;
  role: string;
  status: string;
  cancelledAt: Date | null;
  nickname: string;
  passwordHash: string;
  availabilitySubmittedAt: Date | null;
  availabilityVersion: number;
  slots: string[];
};
type Session = { id: string; participantId: string; expiresAt: Date };
type PromiseRow = {
  id: string;
  status: string;
  voting_deadline_at: Date | null;
  cancelled_at: Date | null;
  confirmed_start_at: Date | null;
};

const db = vi.hoisted(() => ({
  link: { id: "" },
  promise: null as unknown as PromiseRow | null,
  people: [] as unknown as Person[],
  sessions: [] as unknown as Session[],
  now: new Date(0),
  locks: [] as string[],
}));

const sqlOf = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ").trim();

function checkConstraints() {
  const hosts = db.people.filter((p) => p.role === "host");
  if (hosts.length > 1) throw new Error("방장 부분 UNIQUE 위반");
  if (hosts.some((p) => p.status !== "active")) throw new Error("host이면 active CHECK 위반");
  for (const p of db.people) {
    if ((p.status === "cancelled") !== (p.cancelledAt !== null)) throw new Error("cancelled_at CHECK 위반");
  }
}

const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = sqlOf(strings);
    if (sql.includes("clock_timestamp()")) return [{ now: db.now }];
    if (sql.includes("FROM promise_links") && sql.includes("FOR UPDATE")) {
      db.locks.push("promise_links");
      return values[0] === db.link.id ? [{ id: db.link.id }] : [];
    }
    if (sql.includes("FROM promises") && sql.includes("FOR UPDATE")) {
      db.locks.push("promises");
      return db.promise && values[0] === db.promise.id ? [{ ...db.promise }] : [];
    }
    if (sql.startsWith("UPDATE participant_sessions")) {
      const now = values[0] as Date;
      // 한 참여자 세션만(participant_id = ?) 또는 이 약속의 모든 세션
      const onlyParticipant = sql.includes("participant_id = ?") ? (values[1] as string) : null;
      const touched = db.sessions.filter(
        (s) =>
          (onlyParticipant === null || s.participantId === onlyParticipant) &&
          s.expiresAt.getTime() > now.getTime(),
      );
      for (const s of touched) s.expiresAt = now;
      return touched.map((s) => ({ id: s.id }));
    }
    throw new Error(`예상하지 못한 SQL: ${sql}`);
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = sqlOf(strings);
    const row = db.promise;
    if (sql.startsWith("UPDATE promises SET status = 'closed'")) {
      if (row?.status !== "collecting") return 0;
      row.status = "closed";
      return 1;
    }
    if (sql.startsWith("UPDATE promises SET status = 'cancelled'")) {
      if (!row || row.status === "cancelled") return 0;
      row.status = "cancelled";
      row.cancelled_at = values[0] as Date;
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
    deleteMany: vi.fn(async () => {
      const count = db.sessions.length;
      db.sessions = [];
      return { count };
    }),
  },
  participant: {
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: { status: string; id: { not: string } };
        orderBy: { createdAt?: "asc"; id?: "asc" }[];
      }) => {
        expect(orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
        const found = db.people
          .filter((p) => p.status === where.status && p.id !== where.id.not)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
        return found ? { id: found.id } : null;
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { role?: string; status?: string; cancelledAt?: Date };
      }) => {
        const p = db.people.find((row) => row.id === where.id)!;
        if (data.role !== undefined) p.role = data.role;
        if (data.status !== undefined) p.status = data.status;
        if (data.cancelledAt !== undefined) p.cancelledAt = data.cancelledAt;
        checkConstraints();
        return { id: p.id };
      },
    ),
    deleteMany: vi.fn(async () => {
      if (db.sessions.length > 0) throw new Error("RESTRICT: 세션이 남아 있다");
      const count = db.people.length;
      db.people = [];
      return { count };
    }),
  },
  promise: {
    delete: vi.fn(async () => {
      if (db.people.length > 0) throw new Error("RESTRICT: 참여자가 남아 있다");
      const id = db.promise!.id;
      db.promise = null;
      return { id };
    }),
  },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { withdrawParticipant } from "./withdraw-participant";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const LINK_ID = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-09T12:00:00.400+09:00");
const DEADLINE = new Date("2026-11-09T18:00:00+09:00");
const LATER = new Date("2026-11-16T18:00:00+09:00");
const OLD_EXPIRED = new Date("2026-11-09T09:00:00+09:00");

function person(id: string, over: Partial<Person> = {}): Person {
  return {
    id,
    createdAt: new Date("2026-11-08T10:00:00+09:00"),
    role: "member",
    status: "active",
    cancelledAt: null,
    nickname: `닉-${id}`,
    passwordHash: `hash-${id}`,
    availabilitySubmittedAt: new Date("2026-11-08T11:00:00+09:00"),
    availabilityVersion: 2,
    slots: [`${id}-slot`],
    ...over,
  };
}

function authOf(participantId: string, sessionId: string, role: string): PromiseSession {
  return {
    promise: { id: PROMISE_ID, status: db.promise?.status ?? "collecting", promiseLinkId: LINK_ID },
    participant: { id: participantId, role },
    session: { id: sessionId, token: "tok", expiresAt: LATER },
    now: new Date(NOW.getTime() - 50),
  };
}

// 방장 h(가장 먼저), 참여자 a(두 번째)·b(세 번째)·이미 탈퇴한 x(h보다 먼저 들어왔음)
function seed(status = "collecting") {
  db.link = { id: LINK_ID };
  db.promise = {
    id: PROMISE_ID,
    status,
    voting_deadline_at: status === "draft" ? null : DEADLINE,
    cancelled_at: null,
    confirmed_start_at: status === "confirmed" ? new Date("2026-11-12T10:00:00+09:00") : null,
  };
  db.people = [
    person("x", {
      createdAt: new Date("2026-11-08T09:00:00+09:00"),
      status: "cancelled",
      cancelledAt: new Date("2026-11-08T20:00:00+09:00"),
    }),
    person("h", { role: "host", createdAt: new Date("2026-11-08T09:30:00+09:00") }),
    person("b", { createdAt: new Date("2026-11-08T10:30:00+09:00"), availabilitySubmittedAt: null }),
    person("a", { createdAt: new Date("2026-11-08T10:00:00+09:00") }),
  ];
  db.sessions = [
    { id: "s-h1", participantId: "h", expiresAt: LATER },
    { id: "s-h2", participantId: "h", expiresAt: LATER },
    { id: "s-h-old", participantId: "h", expiresAt: OLD_EXPIRED },
    { id: "s-a", participantId: "a", expiresAt: LATER },
    { id: "s-b", participantId: "b", expiresAt: LATER },
    { id: "s-x", participantId: "x", expiresAt: OLD_EXPIRED },
  ];
}

const personOf = (id: string) => db.people.find((p) => p.id === id)!;
const sessionOf = (id: string) => db.sessions.find((s) => s.id === id)!;
// 탈퇴해도 남아야 하는 값 (처리 순서 9)
const kept = (p: Person) => ({
  nickname: p.nickname,
  passwordHash: p.passwordHash,
  availabilitySubmittedAt: p.availabilitySubmittedAt,
  availabilityVersion: p.availabilityVersion,
  slots: p.slots,
});

describe("withdrawParticipant (STATE-API-08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.now = NOW;
    db.locks = [];
    seed();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("방장이 나가면 가장 먼저 참여한 active 참여자가 방장이 되고 옛 방장은 탈퇴 처리된다", async () => {
    const before = kept(personOf("h"));

    const result = await withdrawParticipant(authOf("h", "s-h1", "host"));

    expect(result).toEqual({
      kind: "ok",
      promiseStatus: "collecting",
      participantStatus: "cancelled",
      participantCancelledAt: NOW,
      hostTransferred: true,
      newHostParticipantId: "a",
      promiseCancelledAt: null,
      session: { expiresAt: NOW, now: NOW },
    });
    // 옛 방장: member + cancelled + 탈퇴 시각, 입력 기록 보존
    expect(personOf("h")).toMatchObject({ role: "member", status: "cancelled", cancelledAt: NOW, ...before });
    // 후임: 제출하지 않은 b보다 먼저 들어온 a. 이미 탈퇴한 x는 더 먼저 들어왔어도 후보가 아니다
    expect(personOf("a")).toMatchObject({ role: "host", status: "active", cancelledAt: null });
    expect(personOf("b")).toMatchObject({ role: "member", status: "active" });
    expect(personOf("x")).toMatchObject({ role: "member", status: "cancelled" });
    // 옛 방장의 유효 세션만 즉시 만료. 이미 만료된 세션 시각은 그대로, 다른 사람 세션은 그대로
    expect(sessionOf("s-h1").expiresAt).toEqual(NOW);
    expect(sessionOf("s-h2").expiresAt).toEqual(NOW);
    expect(sessionOf("s-h-old").expiresAt).toEqual(OLD_EXPIRED);
    expect(sessionOf("s-a").expiresAt).toEqual(LATER);
    expect(sessionOf("s-b").expiresAt).toEqual(LATER);
    expect(db.promise).toMatchObject({ status: "collecting", cancelled_at: null });
  });

  it("후임자가 없는 방장이 나가면 약속이 취소되고 방장 참여자 상태는 그대로다", async () => {
    // a·b가 이미 탈퇴해 active는 방장뿐
    for (const id of ["a", "b"]) {
      Object.assign(personOf(id), { status: "cancelled", cancelledAt: OLD_EXPIRED });
    }
    const before = db.people.map((p) => ({ ...p }));

    const result = await withdrawParticipant(authOf("h", "s-h1", "host"));

    expect(result).toEqual({
      kind: "ok",
      promiseStatus: "cancelled",
      participantStatus: "active",
      participantCancelledAt: null,
      hostTransferred: false,
      newHostParticipantId: null,
      promiseCancelledAt: NOW,
      session: { expiresAt: NOW, now: NOW },
    });
    expect(db.promise).toMatchObject({ status: "cancelled", cancelled_at: NOW });
    // 참여자 행은 하나도 바뀌지 않는다 (방장 host + active + cancelled_at NULL 유지)
    expect(db.people).toEqual(before);
    // 이 약속의 유효 세션은 탈퇴자 것까지 모두 만료, 이미 만료된 세션 시각은 그대로
    for (const id of ["s-h1", "s-h2", "s-a", "s-b"]) expect(sessionOf(id).expiresAt).toEqual(NOW);
    expect(sessionOf("s-h-old").expiresAt).toEqual(OLD_EXPIRED);
    expect(sessionOf("s-x").expiresAt).toEqual(OLD_EXPIRED);
  });

  it("링크 → 약속 순서로 잠근다 (draft가 아니어도 같은 순서)", async () => {
    await withdrawParticipant(authOf("a", "s-a", "member"));
    expect(db.locks).toEqual(["promise_links", "promises"]);
  });

  describe("일반 참여자", () => {
    it.each(["collecting", "closed", "confirmed"])(
      "%s: 본인만 cancelled + 탈퇴 시각, 본인 세션만 만료, 약속 상태·확정 일정·입력 기록 보존",
      async (status) => {
        seed(status);
        const before = kept(personOf("a"));
        const promiseBefore = { ...db.promise };

        const result = await withdrawParticipant(authOf("a", "s-a", "member"));

        expect(result).toEqual({
          kind: "ok",
          promiseStatus: status,
          participantStatus: "cancelled",
          participantCancelledAt: NOW,
          hostTransferred: false,
          newHostParticipantId: null,
          promiseCancelledAt: null,
          session: { expiresAt: NOW, now: NOW },
        });
        expect(personOf("a")).toMatchObject({ role: "member", status: "cancelled", cancelledAt: NOW, ...before });
        expect(personOf("h")).toMatchObject({ role: "host", status: "active", cancelledAt: null });
        expect(personOf("b")).toMatchObject({ status: "active", cancelledAt: null });
        expect(sessionOf("s-a").expiresAt).toEqual(NOW);
        for (const id of ["s-h1", "s-h2", "s-b"]) expect(sessionOf(id).expiresAt).toEqual(LATER);
        // confirmed는 그대로 둔다. 가능 인원이 줄어도 자동 해제하지 않는다 (처리 순서 10)
        expect(db.promise).toEqual(promiseBefore);
      },
    );

    it("마감 지난 collecting은 closed로 먼저 저장하고 탈퇴한다 (경계: 판정 시각 = 마감)", async () => {
      db.now = DEADLINE;

      const result = await withdrawParticipant(authOf("a", "s-a", "member"));

      expect(result).toMatchObject({ kind: "ok", promiseStatus: "closed", participantStatus: "cancelled" });
      expect(db.promise?.status).toBe("closed");
      expect(personOf("a")).toMatchObject({ status: "cancelled", cancelledAt: DEADLINE });
    });

    it("마감 1ms 전이면 collecting 그대로", async () => {
      db.now = new Date(DEADLINE.getTime() - 1);
      const result = await withdrawParticipant(authOf("a", "s-a", "member"));
      expect(result).toMatchObject({ kind: "ok", promiseStatus: "collecting" });
      expect(db.promise?.status).toBe("collecting");
    });

    it("인증 때 member였어도 잠금 후 최신 role이 host(그사이 승계됨)면 방장 분기로 처리한다", async () => {
      Object.assign(personOf("h"), { role: "member", status: "cancelled", cancelledAt: OLD_EXPIRED });
      personOf("a").role = "host";

      const result = await withdrawParticipant(authOf("a", "s-a", "member"));

      expect(result).toMatchObject({ kind: "ok", hostTransferred: true, newHostParticipantId: "b" });
      expect(personOf("b")).toMatchObject({ role: "host", status: "active" });
      expect(personOf("a")).toMatchObject({ role: "member", status: "cancelled" });
    });
  });

  describe("방장", () => {
    it.each(["closed", "confirmed"])("%s에서 승계해도 약속 상태·확정 일정은 그대로", async (status) => {
      seed(status);
      const promiseBefore = { ...db.promise };

      const result = await withdrawParticipant(authOf("h", "s-h1", "host"));

      expect(result).toMatchObject({
        kind: "ok",
        promiseStatus: status,
        hostTransferred: true,
        newHostParticipantId: "a",
      });
      expect(db.promise).toEqual(promiseBefore);
    });

    it("가입 시각이 같으면 id가 작은 사람이 후임", async () => {
      personOf("b").createdAt = personOf("a").createdAt;
      const result = await withdrawParticipant(authOf("h", "s-h1", "host"));
      expect(result).toMatchObject({ newHostParticipantId: "a" });
    });

    it("마감 지난 collecting에서 후임자가 없으면 closed를 거쳐 cancelled", async () => {
      db.people = db.people.filter((p) => p.id === "h");
      db.sessions = db.sessions.filter((s) => s.participantId === "h");
      db.now = new Date(DEADLINE.getTime() + 1000);

      const result = await withdrawParticipant(authOf("h", "s-h1", "host"));

      expect(result).toMatchObject({ kind: "ok", promiseStatus: "cancelled", promiseCancelledAt: db.now });
      expect(db.promise).toMatchObject({ status: "cancelled", cancelled_at: db.now });
      expect(personOf("h")).toMatchObject({ role: "host", status: "active", cancelledAt: null });
    });

    it.each(["closed", "confirmed"])("%s에서 후임자가 없으면 취소, 확정 일정은 보존", async (status) => {
      seed(status);
      db.people = db.people.filter((p) => p.id !== "a" && p.id !== "b");
      const confirmed = db.promise!.confirmed_start_at;

      const result = await withdrawParticipant(authOf("h", "s-h1", "host"));

      expect(result).toMatchObject({ kind: "ok", promiseStatus: "cancelled", participantStatus: "active" });
      expect(db.promise).toMatchObject({ status: "cancelled", cancelled_at: NOW, confirmed_start_at: confirmed });
    });
  });

  describe("draft", () => {
    beforeEach(() => {
      seed("draft");
      db.people = [person("h", { role: "host", availabilitySubmittedAt: null, slots: [] })];
      db.sessions = [
        { id: "s-h1", participantId: "h", expiresAt: LATER },
        { id: "s-h-old", participantId: "h", expiresAt: OLD_EXPIRED },
      ];
    });

    it("방장이 나가면 세션·방장·약속을 물리 삭제하고 링크는 남긴다", async () => {
      const result = await withdrawParticipant(authOf("h", "s-h1", "host"));

      expect(result).toEqual({ kind: "draft_discarded", session: { expiresAt: null, now: NOW } });
      expect(db.promise).toBeNull();
      expect(db.people).toEqual([]);
      expect(db.sessions).toEqual([]);
      expect(db.link).toEqual({ id: LINK_ID });
      expect(db.locks).toEqual(["promise_links", "promises"]);
    });

    it("10분이 지난 draft도 같은 폐기다 (410이 아님)", async () => {
      db.now = new Date(NOW.getTime() + 60 * 60_000);
      const result = await withdrawParticipant(authOf("h", "s-h1", "host"));
      expect(result.kind).toBe("draft_discarded");
      expect(db.promise).toBeNull();
    });

    it("방장이 아니면 403, 아무것도 지우지 않는다", async () => {
      db.people.push(person("m", { availabilitySubmittedAt: null, slots: [] }));
      db.sessions.push({ id: "s-m", participantId: "m", expiresAt: LATER });

      const result = await withdrawParticipant(authOf("m", "s-m", "member"));

      expect(result).toEqual({ kind: "forbidden", session: { expiresAt: LATER, now: NOW } });
      expect(db.promise?.status).toBe("draft");
      expect(db.people).toHaveLength(2);
      expect(sessionOf("s-m").expiresAt).toEqual(LATER);
    });
  });

  describe("잠금 후 재확인", () => {
    const snapshot = () => JSON.stringify({ promise: db.promise, people: db.people, sessions: db.sessions });

    it("약속이 사라졌으면(draft 폐기·정리) 404, 세션 null", async () => {
      db.promise = null;
      const result = await withdrawParticipant(authOf("h", "s-h1", "host"));
      expect(result).toEqual({ kind: "not_found", session: { expiresAt: null, now: NOW } });
    });

    it("같은 링크에 새 약속이 생겼어도 원래 약속이 아니면 404 (새 약속을 대신 처리하지 않음)", async () => {
      db.promise!.id = "99999999-8f6a-4c21-9d55-0d3b1a7e9c42";
      const before = snapshot();
      const result = await withdrawParticipant(authOf("h", "s-h1", "host"));
      expect(result.kind).toBe("not_found");
      expect(snapshot()).toBe(before);
    });

    it("그사이 취소됐으면 409, 아무것도 바꾸지 않는다", async () => {
      db.promise!.status = "cancelled";
      const before = snapshot();
      const result = await withdrawParticipant(authOf("a", "s-a", "member"));
      expect(result).toEqual({ kind: "cancelled", session: { expiresAt: LATER, now: NOW } });
      expect(snapshot()).toBe(before);
    });

    it("같은 사람의 앞선 탈퇴가 세션을 만료시켰으면 401, 아무것도 바꾸지 않는다", async () => {
      await withdrawParticipant(authOf("h", "s-h1", "host"));
      const before = snapshot();

      const result = await withdrawParticipant(authOf("h", "s-h2", "host"));

      expect(result).toEqual({ kind: "unauthenticated", session: { expiresAt: NOW, now: NOW } });
      expect(snapshot()).toBe(before);
      expect(personOf("a").role).toBe("host");
    });

    it("세션 행이 없으면 401, 세션 null", async () => {
      const result = await withdrawParticipant(authOf("a", "s-missing", "member"));
      expect(result).toEqual({ kind: "unauthenticated", session: { expiresAt: null, now: NOW } });
    });

    it("세션은 유효하지만 참여자가 cancelled면 401", async () => {
      Object.assign(personOf("a"), { status: "cancelled", cancelledAt: OLD_EXPIRED });
      const before = snapshot();
      const result = await withdrawParticipant(authOf("a", "s-a", "member"));
      expect(result).toEqual({ kind: "unauthenticated", session: { expiresAt: LATER, now: NOW } });
      expect(snapshot()).toBe(before);
    });

    it("세션이 다른 참여자 것이면 401", async () => {
      const result = await withdrawParticipant(authOf("a", "s-b", "member"));
      expect(result.kind).toBe("unauthenticated");
    });
  });
});
