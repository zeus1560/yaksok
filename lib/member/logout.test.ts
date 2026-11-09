import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 메모리 가짜 DB. 서비스가 쓰는 메서드만 흉내 내고, 테스트는 실행된 SQL이 아니라 끝난 뒤의 행 상태를 본다
type Person = {
  id: string;
  promiseId: string;
  role: string;
  status: string;
  cancelledAt: Date | null;
  nickname: string;
  passwordHash: string;
  availabilitySubmittedAt: Date | null;
  availabilityVersion: number;
  slots: string[];
};
type Session = { id: string; participantId: string; tokenHash: string; expiresAt: Date };
type PromiseRow = { id: string; status: string };

const db = vi.hoisted(() => ({
  promises: [] as unknown as PromiseRow[],
  people: [] as unknown as Person[],
  sessions: [] as unknown as Session[],
  now: new Date(0),
}));

const sqlOf = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ").trim();

const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = sqlOf(strings);
    if (sql.includes("FROM participant_sessions") && sql.includes("session_token_hash")) {
      const s = db.sessions.find((row) => row.tokenHash === values[0]);
      if (!s) return [];
      const p = db.people.find((row) => row.id === s.participantId)!;
      return [
        {
          id: s.id,
          participant_id: p.id,
          expires_at: s.expiresAt,
          promise_id: p.promiseId,
          participant_status: p.status,
          now: db.now,
        },
      ];
    }
    throw new Error(`예상하지 못한 SQL: ${sql}`);
  }),
  participantSession: {
    deleteMany: vi.fn(async ({ where }: { where: { id?: string; participantId?: string } }) => {
      const before = db.sessions.length;
      db.sessions = db.sessions.filter(
        (s) =>
          !(
            (where.id === undefined || s.id === where.id) &&
            (where.participantId === undefined || s.participantId === where.participantId)
          ),
      );
      return { count: before - db.sessions.length };
    }),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    promise: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = db.promises.find((p) => p.id === where.id);
        return row ? { id: row.id } : null;
      }),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

import { logoutSession, parseAllDevices } from "./logout";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-10T12:00:00.400+09:00");
const LATER = new Date("2026-11-17T18:00:00+09:00");

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function person(id: string, over: Partial<Person> = {}): Person {
  return {
    id,
    promiseId: PROMISE_ID,
    role: "member",
    status: "active",
    cancelledAt: null,
    nickname: `닉-${id}`,
    passwordHash: `hash-${id}`,
    availabilitySubmittedAt: new Date("2026-11-10T11:00:00+09:00"),
    availabilityVersion: 2,
    slots: [`${id}-slot`],
    ...over,
  };
}

function session(id: string, participantId: string, over: Partial<Session> = {}): Session {
  return { id, participantId, tokenHash: hash(`token-${id}`), expiresAt: LATER, ...over };
}

function request(token: string | null, promiseId = PROMISE_ID): Request {
  const headers = new Headers();
  if (token !== null) headers.set("cookie", `ys_session_${promiseId}=${token}`);
  return new Request(`http://localhost/api/v1/promises/${promiseId}/auth/session`, {
    method: "DELETE",
    headers,
  });
}

const ids = () => db.sessions.map((s) => s.id).sort();
const clone = <T>(value: T): T => structuredClone(value);

beforeEach(() => {
  vi.clearAllMocks();
  db.now = NOW;
  db.promises = [{ id: PROMISE_ID, status: "collecting" }];
  db.people = [person("host", { role: "host" }), person("me"), person("other")];
  db.sessions = [
    session("me-phone", "me"),
    session("me-laptop", "me"),
    session("host-phone", "host"),
    session("other-phone", "other"),
  ];
});

describe("logoutSession", () => {
  it("이 기기의 세션만 삭제하고 참여자 상태와 다른 기기 세션은 그대로 둔다", async () => {
    const peopleBefore = clone(db.people);

    const result = await logoutSession(request("token-me-phone"), PROMISE_ID, {
      allDevices: false,
    });

    expect(result).toEqual({ kind: "ok", promiseId: PROMISE_ID });
    expect(ids()).toEqual(["host-phone", "me-laptop", "other-phone"]);
    expect(db.people).toEqual(peopleBefore);
  });

  it("allDevices=true면 같은 참여자의 모든 세션을 삭제한다", async () => {
    const peopleBefore = clone(db.people);

    const result = await logoutSession(request("token-me-phone"), PROMISE_ID, {
      allDevices: true,
    });

    expect(result).toEqual({ kind: "ok", promiseId: PROMISE_ID });
    expect(ids()).toEqual(["host-phone", "other-phone"]);
    expect(db.people).toEqual(peopleBefore);
  });

  it("allDevices=true여도 다른 참여자(방장 포함)의 세션은 지우지 않는다", async () => {
    await logoutSession(request("token-host-phone"), PROMISE_ID, { allDevices: true });
    expect(ids()).toEqual(["me-laptop", "me-phone", "other-phone"]);
  });

  it("같은 요청을 반복하면 두 번째는 지울 행이 없어도 ok이고 아무것도 바꾸지 않는다", async () => {
    await logoutSession(request("token-me-phone"), PROMISE_ID, { allDevices: false });
    const after = clone(db.sessions);

    const again = await logoutSession(request("token-me-phone"), PROMISE_ID, { allDevices: false });

    expect(again).toEqual({ kind: "ok", promiseId: PROMISE_ID });
    expect(db.sessions).toEqual(after);
    expect(tx.participantSession.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("allDevices=true 반복도 두 번째는 ok·변경 없음", async () => {
    await logoutSession(request("token-me-phone"), PROMISE_ID, { allDevices: true });
    const again = await logoutSession(request("token-me-phone"), PROMISE_ID, { allDevices: true });
    expect(again).toEqual({ kind: "ok", promiseId: PROMISE_ID });
    expect(ids()).toEqual(["host-phone", "other-phone"]);
  });

  it("위조 토큰(행 없음)은 ok, 아무것도 지우지 않는다", async () => {
    const result = await logoutSession(request("forged"), PROMISE_ID, { allDevices: true });
    expect(result).toEqual({ kind: "ok", promiseId: PROMISE_ID });
    expect(ids()).toHaveLength(4);
  });

  it("만료된 세션은 ok로 자기 행만 지운다. allDevices=true여도 다른 기기의 유효 세션은 남긴다", async () => {
    db.sessions[0].expiresAt = new Date(NOW.getTime() - 1);

    const result = await logoutSession(request("token-me-phone"), PROMISE_ID, { allDevices: true });

    expect(result).toEqual({ kind: "ok", promiseId: PROMISE_ID });
    expect(ids()).toEqual(["host-phone", "me-laptop", "other-phone"]);
  });

  it("만료 경계: expires_at = 판정 시각이면 만료로 보고 전체 로그아웃하지 않는다", async () => {
    db.sessions[0].expiresAt = NOW;
    await logoutSession(request("token-me-phone"), PROMISE_ID, { allDevices: true });
    expect(ids()).toEqual(["host-phone", "me-laptop", "other-phone"]);
  });

  it("만료 1ms 전 세션은 유효하므로 allDevices=true면 모든 기기 세션을 지운다", async () => {
    db.sessions[0].expiresAt = new Date(NOW.getTime() + 1);
    await logoutSession(request("token-me-phone"), PROMISE_ID, { allDevices: true });
    expect(ids()).toEqual(["host-phone", "other-phone"]);
  });

  it("탈퇴·내보내진(cancelled) 참여자의 남은 쿠키는 ok로 자기 행만 지우고 참여자 행은 그대로", async () => {
    db.people[1] = person("me", {
      status: "cancelled",
      cancelledAt: new Date("2026-11-10T10:00:00+09:00"),
    });
    db.sessions[0].expiresAt = new Date("2026-11-10T10:00:00+09:00");
    db.sessions[1].expiresAt = new Date("2026-11-10T10:00:00+09:00");
    const peopleBefore = clone(db.people);

    const result = await logoutSession(request("token-me-phone"), PROMISE_ID, { allDevices: true });

    expect(result).toEqual({ kind: "ok", promiseId: PROMISE_ID });
    expect(ids()).toEqual(["host-phone", "me-laptop", "other-phone"]);
    expect(db.people).toEqual(peopleBefore);
  });

  it.each(["draft", "collecting", "closed", "confirmed", "cancelled"])(
    "약속 상태 %s에서도 ok로 이 기기 세션을 지운다 (cancelled도 409 아님)",
    async (status) => {
      db.promises[0].status = status;
      const result = await logoutSession(request("token-me-phone"), PROMISE_ID, {
        allDevices: false,
      });
      expect(result).toEqual({ kind: "ok", promiseId: PROMISE_ID });
      expect(ids()).toEqual(["host-phone", "me-laptop", "other-phone"]);
    },
  );

  it("다른 약속의 세션이면 forbidden이고 그 세션(그리고 그 참여자의 다른 세션)은 지우지 않는다", async () => {
    const OTHER = "0f0e0d0c-0b0a-4908-8706-050403020100";
    db.promises.push({ id: OTHER, status: "collecting" });
    db.people.push(person("stranger", { promiseId: OTHER }));
    db.sessions.push(session("stranger-a", "stranger"), session("stranger-b", "stranger"));
    const before = clone(db.sessions);

    // 다른 약속의 토큰을 이 약속 이름의 쿠키에 넣어 보낸다
    const result = await logoutSession(request("token-stranger-a"), PROMISE_ID, {
      allDevices: true,
    });

    expect(result).toEqual({ kind: "forbidden" });
    expect(db.sessions).toEqual(before);
    expect(tx.participantSession.deleteMany).not.toHaveBeenCalled();
  });

  it("약속이 없으면 not_found, 쿠키를 읽지 않고 세션도 찾지 않는다", async () => {
    const result = await logoutSession(
      request("token-me-phone", "00000000-0000-4000-8000-000000000000"),
      "00000000-0000-4000-8000-000000000000",
      { allDevices: false },
    );
    expect(result).toEqual({ kind: "not_found" });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(ids()).toHaveLength(4);
  });

  it("이 약속 이름의 쿠키가 없으면 unauthenticated, 아무것도 지우지 않는다", async () => {
    const result = await logoutSession(request(null), PROMISE_ID, { allDevices: true });
    expect(result).toEqual({ kind: "unauthenticated" });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(ids()).toHaveLength(4);
  });

  it("다른 약속 이름의 쿠키만 있으면 unauthenticated", async () => {
    const other = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const result = await logoutSession(request("token-me-phone", other), PROMISE_ID, {
      allDevices: false,
    });
    expect(result).toEqual({ kind: "unauthenticated" });
    expect(ids()).toHaveLength(4);
  });

  it("빈 쿠키 값은 쿠키 없음과 같다", async () => {
    const result = await logoutSession(request(""), PROMISE_ID, { allDevices: false });
    expect(result).toEqual({ kind: "unauthenticated" });
  });
});

describe("parseAllDevices", () => {
  const parse = (query: string) => parseAllDevices(new URLSearchParams(query));

  it("없으면 false, true·false 한 개는 그 값", () => {
    expect(parse("")).toBe(false);
    expect(parse("allDevices=true")).toBe(true);
    expect(parse("allDevices=false")).toBe(false);
    expect(parse("other=1&allDevices=true")).toBe(true);
  });

  it.each([
    "allDevices=",
    "allDevices",
    "allDevices=TRUE",
    "allDevices=True",
    "allDevices=1",
    "allDevices=0",
    "allDevices=yes",
    "allDevices=%20true",
    "allDevices=true&allDevices=true",
    "allDevices=true&allDevices=false",
  ])("%s → null (400)", (query) => {
    expect(parse(query)).toBeNull();
  });
});
