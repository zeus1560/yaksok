import { beforeEach, describe, expect, it, vi } from "vitest";

// 메모리 가짜 DB. 서비스가 쓰는 tx 메서드만 흉내 내고, 테스트는 실행된 SQL이 아니라 끝난 뒤의 상태를 본다
// 참여자 변경마다 DB 제약(방장 UNIQUE, host이면 active, cancelled이면 cancelled_at 있음)을 검사한다
type Person = {
  id: string;
  promiseId: string;
  createdAt: Date;
  role: string;
  status: string;
  cancelledAt: Date | null;
  nickname: string;
  normalizedNickname: string;
  passwordHash: string;
  availabilitySubmittedAt: Date | null;
  availabilityVersion: number;
  slots: string[];
};
type Session = { id: string; participantId: string; expiresAt: Date };
type PromiseRow = {
  id: string;
  status: string;
  participant_limit: number | null;
  voting_deadline_at: Date | null;
  created_at: Date;
};

const db = vi.hoisted(() => ({
  promise: null as unknown as PromiseRow | null,
  people: [] as unknown as Person[],
  sessions: [] as unknown as Session[],
  now: new Date(0),
  locks: [] as string[],
  writes: 0,
}));

const sqlOf = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ").trim();

function checkConstraints() {
  for (const promiseId of new Set(db.people.map((p) => p.promiseId))) {
    const hosts = db.people.filter((p) => p.promiseId === promiseId && p.role === "host");
    if (hosts.length > 1) throw new Error("방장 부분 UNIQUE 위반");
  }
  for (const p of db.people) {
    if (p.role === "host" && p.status !== "active") throw new Error("host이면 active CHECK 위반");
    if ((p.status === "cancelled") !== (p.cancelledAt !== null)) throw new Error("cancelled_at CHECK 위반");
  }
}

const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = sqlOf(strings);
    if (sql.includes("clock_timestamp()")) return [{ now: db.now }];
    if (sql.includes("FROM promise_links") && sql.includes("FOR UPDATE") && !sql.includes("JOIN")) {
      db.locks.push("promise_links");
      return [];
    }
    if (sql.includes("FROM promises") && sql.includes("FOR UPDATE")) {
      db.locks.push("promises");
      const row = db.promise;
      if (!row || values[0] !== row.id) return [];
      return [
        {
          status: row.status,
          participant_limit: row.participant_limit,
          date_range_start: "2026-11-10",
          date_range_end: "2026-11-12",
          daily_start_minute: 540,
          daily_end_minute: 1080,
          duration_minutes: 60,
          voting_deadline_at: row.voting_deadline_at,
          link_created_at: new Date("2026-11-08T09:00:00+09:00"),
        },
      ];
    }
    if (sql.startsWith("UPDATE participant_sessions")) {
      db.writes += 1;
      const now = values[0] as Date;
      const participantId = values[1] as string;
      const touched = db.sessions.filter(
        (s) => s.participantId === participantId && s.expiresAt.getTime() > now.getTime(),
      );
      for (const s of touched) s.expiresAt = now;
      return touched.map((s) => ({ id: s.id }));
    }
    throw new Error(`예상하지 못한 SQL: ${sql}`);
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
    throw new Error(`예상하지 못한 SQL: ${sqlOf(strings)}`);
  }),
  participantSession: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const s = db.sessions.find((row) => row.id === where.id);
      if (!s) return null;
      const p = db.people.find((row) => row.id === s.participantId)!;
      return {
        expiresAt: s.expiresAt,
        participant: { id: p.id, promiseId: p.promiseId, role: p.role, status: p.status },
      };
    }),
  },
  participant: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const p = db.people.find((row) => row.id === where.id);
      return p ? { id: p.id, promiseId: p.promiseId, status: p.status } : null;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: { status?: string; cancelledAt?: Date } }) => {
        db.writes += 1;
        const p = db.people.find((row) => row.id === where.id)!;
        if (data.status !== undefined) p.status = data.status;
        if (data.cancelledAt !== undefined) p.cancelledAt = data.cancelledAt;
        checkConstraints();
        return { id: p.id };
      },
    ),
    count: vi.fn(async ({ where }: { where: { promiseId: string; status: string } }) => {
      return db.people.filter((p) => p.promiseId === where.promiseId && p.status === where.status).length;
    }),
  },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "./session-auth";
import { removeParticipant } from "./remove-participant";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const OTHER_PROMISE_ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const LINK_ID = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-09T12:00:00.400+09:00");
const DEADLINE = new Date("2026-11-09T18:00:00+09:00");
const LATER = new Date("2026-11-16T18:00:00+09:00");
const OLD_EXPIRED = new Date("2026-11-09T09:00:00+09:00");
const EARLIER_LEFT = new Date("2026-11-08T20:00:00+09:00");

function person(id: string, over: Partial<Person> = {}): Person {
  return {
    id,
    promiseId: PROMISE_ID,
    createdAt: new Date("2026-11-08T10:00:00+09:00"),
    role: "member",
    status: "active",
    cancelledAt: null,
    nickname: `닉-${id}`,
    normalizedNickname: `닉-${id}`,
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

// 방장 h, 참여자 a·b, 이미 나간 x, 다른 약속의 o. 정원 6
function seed(status = "collecting") {
  db.promise = {
    id: PROMISE_ID,
    status,
    participant_limit: status === "draft" ? null : 6,
    voting_deadline_at: status === "draft" ? null : DEADLINE,
    created_at: new Date("2026-11-08T09:00:00+09:00"),
  };
  db.people = [
    person("h", { role: "host", createdAt: new Date("2026-11-08T09:30:00+09:00") }),
    person("a"),
    person("b", { availabilitySubmittedAt: null, availabilityVersion: 0, slots: [] }),
    person("x", { status: "cancelled", cancelledAt: EARLIER_LEFT }),
    person("o", { promiseId: OTHER_PROMISE_ID }),
  ];
  db.sessions = [
    { id: "s-h", participantId: "h", expiresAt: LATER },
    { id: "s-a1", participantId: "a", expiresAt: LATER },
    { id: "s-a2", participantId: "a", expiresAt: LATER },
    { id: "s-a-old", participantId: "a", expiresAt: OLD_EXPIRED },
    { id: "s-b", participantId: "b", expiresAt: LATER },
    { id: "s-x", participantId: "x", expiresAt: OLD_EXPIRED },
    { id: "s-o", participantId: "o", expiresAt: LATER },
  ];
}

const personOf = (id: string) => db.people.find((p) => p.id === id)!;
const sessionOf = (id: string) => db.sessions.find((s) => s.id === id)!;
// 내보내도 남아야 하는 값 (처리 순서 8)
const kept = (p: Person) => ({
  nickname: p.nickname,
  normalizedNickname: p.normalizedNickname,
  passwordHash: p.passwordHash,
  availabilitySubmittedAt: p.availabilitySubmittedAt,
  availabilityVersion: p.availabilityVersion,
  slots: p.slots,
  role: p.role,
  createdAt: p.createdAt,
});
const snapshot = () => ({
  promise: { ...db.promise },
  people: db.people.map((p) => ({ ...p })),
  sessions: db.sessions.map((s) => ({ ...s })),
});

describe("removeParticipant (MEMBER-API-08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.now = NOW;
    db.locks = [];
    db.writes = 0;
    seed();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("방장이 참여자를 내보내면 대상만 cancelled가 되고 대상 세션만 만료된다", async () => {
    const before = kept(personOf("a"));

    const result = await removeParticipant(authOf("h", "s-h", "host"), "a");

    expect(result).toEqual({
      kind: "ok",
      participantId: "a",
      currentParticipantCount: 2,
      participantLimit: 6,
      session: { expiresAt: LATER, now: NOW },
    });
    // 대상: cancelled + 내보낸 시각, 슬롯·제출 시각·닉네임·PIN 해시 보존
    expect(personOf("a")).toMatchObject({ status: "cancelled", cancelledAt: NOW, ...before });
    // 다른 참여자는 그대로
    expect(personOf("h")).toMatchObject({ role: "host", status: "active", cancelledAt: null });
    expect(personOf("b")).toMatchObject({ status: "active", cancelledAt: null });
    expect(personOf("x")).toMatchObject({ status: "cancelled", cancelledAt: EARLIER_LEFT });
    // 대상의 유효 세션만 즉시 만료. 이미 만료된 세션 시각은 그대로, 다른 사람 세션은 그대로
    expect(sessionOf("s-a1").expiresAt).toEqual(NOW);
    expect(sessionOf("s-a2").expiresAt).toEqual(NOW);
    expect(sessionOf("s-a-old").expiresAt).toEqual(OLD_EXPIRED);
    for (const id of ["s-h", "s-b", "s-o"]) expect(sessionOf(id).expiresAt).toEqual(LATER);
    // 약속 상태는 변하지 않는다
    expect(db.promise).toMatchObject({ status: "collecting" });
  });

  it("이미 내보낸 대상에 다시 요청하면 아무것도 바꾸지 않고 200", async () => {
    await removeParticipant(authOf("h", "s-h", "host"), "a");
    const afterFirst = snapshot();
    db.now = new Date(NOW.getTime() + 5000);
    db.writes = 0;

    const result = await removeParticipant(authOf("h", "s-h", "host"), "a");

    expect(result).toEqual({
      kind: "ok",
      participantId: "a",
      currentParticipantCount: 2,
      participantLimit: 6,
      session: { expiresAt: LATER, now: db.now },
    });
    // 내보낸 시각이 두 번째 요청 시각으로 바뀌지 않는다
    expect(snapshot()).toEqual(afterFirst);
    expect(personOf("a").cancelledAt).toEqual(NOW);
    expect(db.writes).toBe(0);
  });

  it("본인이 먼저 탈퇴한 대상도 변경 없이 200 (탈퇴 시각 유지)", async () => {
    const before = snapshot();
    const result = await removeParticipant(authOf("h", "s-h", "host"), "x");
    expect(result).toMatchObject({ kind: "ok", participantId: "x", currentParticipantCount: 3 });
    expect(snapshot()).toEqual(before);
    expect(db.writes).toBe(0);
  });

  it("제출하지 않은 참여자도 같은 방식으로 내보낸다", async () => {
    const result = await removeParticipant(authOf("h", "s-h", "host"), "b");
    expect(result).toMatchObject({ kind: "ok", participantId: "b", currentParticipantCount: 2 });
    expect(personOf("b")).toMatchObject({ status: "cancelled", cancelledAt: NOW, availabilitySubmittedAt: null });
    expect(sessionOf("s-b").expiresAt).toEqual(NOW);
    expect(sessionOf("s-a1").expiresAt).toEqual(LATER);
  });

  it("promises 행만 잠근다 (링크는 잠그지 않는다)", async () => {
    await removeParticipant(authOf("h", "s-h", "host"), "a");
    expect(db.locks).toEqual(["promises"]);
  });

  it("응답의 participantId는 DB 값(소문자)이다", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    db.people.push(person(id));
    // 경로 값이 대문자여도 Postgres uuid는 같은 행을 찾는다. 가짜 DB는 정확히 같은 값만 찾으므로 소문자로 찾게 한다
    tx.participant.findUnique.mockImplementationOnce(async ({ where }: { where: { id: string } }) => {
      const p = db.people.find((row) => row.id === where.id.toLowerCase());
      return p ? { id: p.id, promiseId: p.promiseId, status: p.status } : null;
    });
    const result = await removeParticipant(authOf("h", "s-h", "host"), id.toUpperCase());
    expect(result).toMatchObject({ kind: "ok", participantId: id });
  });

  describe("거절 — 아무것도 바꾸지 않는다", () => {
    const rejectsWithoutChange = async (auth: PromiseSession, target: string) => {
      const before = snapshot();
      const result = await removeParticipant(auth, target);
      expect(snapshot()).toEqual(before);
      expect(db.writes).toBe(0);
      return result;
    };

    it("본인 지정 → cannot_remove_self", async () => {
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), "h");
      expect(result).toEqual({ kind: "cannot_remove_self", session: { expiresAt: LATER, now: NOW } });
    });

    it.each([
      ["다른 약속 참여자", "o"],
      ["없는 참여자", "99999999-9999-4999-8999-999999999999"],
    ])("%s → participant_not_found", async (_n, target) => {
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), target);
      expect(result).toEqual({ kind: "participant_not_found", session: { expiresAt: LATER, now: NOW } });
    });

    it("일반 참여자의 요청 → forbidden (대상이 존재해도)", async () => {
      const result = await rejectsWithoutChange(authOf("a", "s-a1", "member"), "b");
      expect(result).toEqual({ kind: "forbidden", session: { expiresAt: LATER, now: NOW } });
    });

    it("인증 뒤 방장이 승계로 바뀌었으면 잠금 후 최신 role로 forbidden", async () => {
      // 인증 시점에는 host였지만 잠금 전에 role이 member가 된 경우(승계는 옛 방장을 cancelled로 만들므로 데이터로만 흉내)
      Object.assign(personOf("h"), { role: "member" });
      Object.assign(personOf("a"), { role: "host" });
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), "b");
      expect(result.kind).toBe("forbidden");
    });

    it.each([
      ["요청자가 이미 탈퇴(승계)", () => Object.assign(personOf("h"), { role: "member", status: "cancelled", cancelledAt: EARLIER_LEFT })],
      ["요청자 세션 만료", () => Object.assign(sessionOf("s-h"), { expiresAt: NOW })],
    ])("%s → unauthenticated", async (_n, mutate) => {
      mutate();
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), "a");
      expect(result.kind).toBe("unauthenticated");
    });

    it("요청자 세션 행이 없으면 unauthenticated, 쿠키는 지운다(expiresAt null)", async () => {
      db.sessions = db.sessions.filter((s) => s.id !== "s-h");
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), "a");
      expect(result).toEqual({ kind: "unauthenticated", session: { expiresAt: null, now: NOW } });
    });

    it("잠금 사이 약속이 사라졌으면 not_found", async () => {
      db.promise = null;
      const result = await removeParticipant(authOf("h", "s-h", "host"), "a");
      expect(result).toEqual({ kind: "not_found", session: { expiresAt: null, now: NOW } });
      expect(db.writes).toBe(0);
    });

    it("잠금 사이 약속이 취소됐으면 cancelled", async () => {
      db.promise!.status = "cancelled";
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), "a");
      expect(result.kind).toBe("cancelled");
    });

    it.each(["draft", "closed", "confirmed"])("%s → invalid_state", async (status) => {
      seed(status);
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), "a");
      expect(result).toEqual({
        kind: "invalid_state",
        promiseStatus: status,
        session: { expiresAt: LATER, now: NOW },
      });
    });

    it("10분 지난 draft도 invalid_state이고 삭제하지 않는다", async () => {
      seed("draft");
      db.now = new Date(db.promise!.created_at.getTime() + 60 * 60_000);
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), "a");
      expect(result.kind).toBe("invalid_state");
      expect(db.promise).not.toBeNull();
    });

    it.each([
      ["마감 시각과 같음(경계)", 0],
      ["마감 1ms 뒤", 1],
    ])("%s → deadline_passed, 약속은 collecting 그대로(closed 저장 없음)", async (_n, after) => {
      db.now = new Date(DEADLINE.getTime() + after);
      const result = await rejectsWithoutChange(authOf("h", "s-h", "host"), "a");
      expect(result).toEqual({ kind: "deadline_passed", session: { expiresAt: LATER, now: db.now } });
      expect(db.promise!.status).toBe("collecting");
    });

    it("마감 1ms 전이면 내보낸다", async () => {
      db.now = new Date(DEADLINE.getTime() - 1);
      const result = await removeParticipant(authOf("h", "s-h", "host"), "a");
      expect(result.kind).toBe("ok");
    });

    it("상태 검사가 대상 검사보다 먼저다 (closed에서 본인 지정 → invalid_state)", async () => {
      seed("closed");
      const result = await removeParticipant(authOf("h", "s-h", "host"), "h");
      expect(result.kind).toBe("invalid_state");
    });

    it("마감 검사가 대상 검사보다 먼저다 (마감 뒤 없는 참여자 → deadline_passed)", async () => {
      db.now = DEADLINE;
      const result = await removeParticipant(authOf("h", "s-h", "host"), "99999999-9999-4999-8999-999999999999");
      expect(result.kind).toBe("deadline_passed");
    });
  });

  it("처리 중 DB 오류는 그대로 던진다 (트랜잭션 롤백)", async () => {
    tx.participant.count.mockRejectedValueOnce(new Error("boom"));
    await expect(removeParticipant(authOf("h", "s-h", "host"), "a")).rejects.toThrow("boom");
  });
});
