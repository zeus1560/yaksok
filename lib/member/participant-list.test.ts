import { beforeEach, describe, expect, it, vi } from "vitest";

// 메모리 가짜 DB. participants 행을 두고 findMany의 where(promiseId·status)·orderBy(createdAt·id)를 흉내 낸다
// $queryRaw는 판정 시각 → 약속 행 순서로 응답을 꺼낸다. 쓰기 메서드는 두지 않는다(호출되면 실패)
type Row = {
  id: string;
  promiseId: string;
  nickname: string;
  normalizedNickname: string;
  passwordHash: string;
  role: string;
  status: string;
  availabilitySubmittedAt: Date | null;
  availabilityVersion: number;
  cancelledAt: Date | null;
  createdAt: Date;
};
let rows: Row[] = [];
const txQueryResults: unknown[][] = [];

type FindManyArgs = {
  where?: { promiseId?: string; status?: string };
  orderBy?: Record<string, "asc" | "desc">[];
  select?: Record<string, boolean>;
};
function findMany(args: FindManyArgs) {
  let list = rows.filter(
    (r) =>
      (args.where?.promiseId === undefined || r.promiseId === args.where.promiseId) &&
      (args.where?.status === undefined || r.status === args.where.status),
  );
  const order = args.orderBy ?? [];
  list = [...list].sort((a, b) => {
    for (const o of order) {
      const [key, dir] = Object.entries(o)[0] as [keyof Row, "asc" | "desc"];
      const x = a[key] instanceof Date ? (a[key] as Date).getTime() : String(a[key]);
      const y = b[key] instanceof Date ? (b[key] as Date).getTime() : String(b[key]);
      if (x < y) return dir === "asc" ? -1 : 1;
      if (x > y) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
  if (!args.select) return list;
  return list.map((r) =>
    Object.fromEntries(
      Object.entries(args.select!)
        .filter(([, on]) => on)
        .map(([key]) => [key, r[key as keyof Row]]),
    ),
  );
}

const tx = {
  $queryRaw: vi.fn(async () => txQueryResults.shift() ?? []),
  participantSession: { findUnique: vi.fn() },
  participant: { findMany: vi.fn(async (args: FindManyArgs) => findMany(args)) },
};
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

import type { PromiseSession } from "@/lib/member/session-auth";
import { getParticipantList } from "./participant-list";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const OTHER_PROMISE_ID = "0b5d1e7a-2c3f-4a6b-8d9e-1f2a3b4c5d6e";
const NOW = new Date("2026-11-10T10:10:00.123+09:00"); // 트랜잭션 now()
const SESSION_EXPIRES = new Date("2026-11-18T18:00:00+09:00");
const at = (iso: string) => new Date(iso);
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-me", role: "member" },
  session: { id: "s-1", token: "tok", expiresAt: SESSION_EXPIRES },
  now: new Date(NOW.getTime() - 50),
};

function row(overrides: Partial<Row> & { id: string }): Row {
  return {
    promiseId: PROMISE_ID,
    nickname: overrides.id,
    normalizedNickname: overrides.id,
    passwordHash: "scrypt$32768$8$1$secret",
    role: "member",
    status: "active",
    availabilitySubmittedAt: null,
    availabilityVersion: 0,
    cancelledAt: null,
    createdAt: at("2026-11-08T09:00:00+09:00"),
    ...overrides,
  };
}

function promiseRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "collecting",
    participant_limit: 6,
    voting_deadline_at: at("2026-11-12T18:00:00+09:00"),
    ...overrides,
  };
}

type SessionRow = {
  expiresAt?: Date;
  participant?: { id?: string; promiseId?: string; status?: string };
};

function prepare(
  promise: unknown,
  { session = {} as SessionRow, sessionMissing = false } = {},
) {
  txQueryResults.push([{ now: NOW }], promise ? [promise] : []);
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
}

const keep = { session: { expiresAt: SESSION_EXPIRES, now: NOW } };

describe("getParticipantList (MEMBER-API-06)", () => {
  beforeEach(() => {
    rows = [];
    txQueryResults.length = 0;
    vi.clearAllMocks();
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  });

  it("탈퇴자는 명단과 인원에서 빠지고 등록순(created_at → id)으로 정렬된다", async () => {
    rows = [
      row({ id: "pt-c", nickname: "철수", createdAt: at("2026-11-08T09:05:00+09:00") }),
      row({ id: "pt-host", nickname: "승주", role: "host", createdAt: at("2026-11-08T09:00:00+09:00") }),
      row({
        id: "pt-left",
        nickname: "탈퇴",
        status: "cancelled",
        cancelledAt: at("2026-11-09T09:00:00+09:00"),
        createdAt: at("2026-11-08T09:01:00+09:00"),
      }),
      // created_at이 같으면 id 오름차순
      row({ id: "pt-me", nickname: "혜승", createdAt: at("2026-11-08T09:03:00+09:00") }),
      row({ id: "pt-b", nickname: "영희", createdAt: at("2026-11-08T09:03:00+09:00") }),
      row({ id: "pt-x", nickname: "남의약속", promiseId: OTHER_PROMISE_ID }),
    ];
    prepare(promiseRow());

    expect(await getParticipantList(AUTH)).toEqual({
      kind: "ok",
      participantLimit: 6,
      participants: [
        { participantId: "pt-host", nickname: "승주", role: "host", isMe: false },
        { participantId: "pt-b", nickname: "영희", role: "member", isMe: false },
        { participantId: "pt-me", nickname: "혜승", role: "member", isMe: true },
        { participantId: "pt-c", nickname: "철수", role: "member", isMe: false },
      ],
      ...keep,
    });
  });

  it("제출 여부·status·PIN 해시·정규화 닉네임을 명단 항목에 넣지 않는다 (미제출자도 포함)", async () => {
    rows = [
      row({ id: "pt-host", role: "host", availabilitySubmittedAt: at("2026-11-09T10:00:00+09:00") }),
      row({ id: "pt-me", createdAt: at("2026-11-08T09:10:00+09:00") }),
    ];
    prepare(promiseRow());

    const result = await getParticipantList(AUTH);
    if (result.kind !== "ok") throw new Error(`ok가 아님: ${result.kind}`);
    expect(result.participants).toHaveLength(2);
    for (const item of result.participants) {
      expect(Object.keys(item).sort()).toEqual(["isMe", "nickname", "participantId", "role"]);
    }
    expect(JSON.stringify(result)).not.toMatch(/submitted|scrypt|normalized|status|version/i);
  });

  it("REPEATABLE READ 트랜잭션 하나, now()를 먼저 읽고 잠금 없이 약속을 읽는다. 명단 조회는 필요한 열만 고른다", async () => {
    rows = [row({ id: "pt-me" })];
    prepare(promiseRow());
    await getParticipantList(AUTH);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    const sqls = tx.$queryRaw.mock.calls.map((call) =>
      ((call as unknown[])[0] as TemplateStringsArray).join("?"),
    );
    expect(sqls[0]).toContain("now()");
    expect(sqls[0]).not.toContain("clock_timestamp");
    expect(sqls[1]).toContain("FROM promises");
    expect(sqls.join(" ")).not.toMatch(/FOR UPDATE|FOR SHARE|UPDATE |INSERT|DELETE/i);
    expect(tx.participant.findMany).toHaveBeenCalledWith({
      where: { promiseId: PROMISE_ID, status: "active" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, nickname: true, role: true },
    });
  });

  it.each(["collecting", "closed", "confirmed"])("%s → ok", async (status) => {
    rows = [row({ id: "pt-me" })];
    prepare(promiseRow({ status }));
    expect((await getParticipantList(AUTH)).kind).toBe("ok");
  });

  it("마감 지난 collecting도 ok (closed로 계산해도 허용 상태라 결과가 같고, DB를 바꾸지 않는다)", async () => {
    rows = [row({ id: "pt-me" })];
    prepare(promiseRow({ voting_deadline_at: at("2026-11-10T10:00:00+09:00") }));
    const result = await getParticipantList(AUTH);
    expect(result.kind).toBe("ok");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("승계 뒤: 인증 시점 역할과 관계없이 스냅샷의 최신 role을 그대로 보여 준다", async () => {
    rows = [
      row({
        id: "pt-old",
        role: "member",
        status: "cancelled",
        cancelledAt: at("2026-11-09T09:00:00+09:00"),
        createdAt: at("2026-11-08T08:00:00+09:00"),
      }),
      row({ id: "pt-me", role: "host" }),
      row({ id: "pt-z", createdAt: at("2026-11-08T09:30:00+09:00") }),
    ];
    prepare(promiseRow());
    const result = await getParticipantList(AUTH); // AUTH.participant.role은 member
    expect(result).toMatchObject({
      kind: "ok",
      participants: [
        { participantId: "pt-me", role: "host", isMe: true },
        { participantId: "pt-z", role: "member", isMe: false },
      ],
    });
  });

  describe("판정 순서", () => {
    it("인증 뒤 약속 행이 사라짐 → not_found, 쿠키 삭제", async () => {
      prepare(null);
      expect(await getParticipantList(AUTH)).toEqual({
        kind: "not_found",
        session: { expiresAt: null, now: NOW },
      });
      expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    });

    it("cancelled → cancelled (세션 재확인 전)", async () => {
      prepare(promiseRow({ status: "cancelled" }), { sessionMissing: true });
      expect(await getParticipantList(AUTH)).toEqual({ kind: "cancelled", ...keep });
      expect(tx.participantSession.findUnique).not.toHaveBeenCalled();
    });

    it("알 수 없는 상태값은 데이터 오류로 예외", async () => {
      prepare(promiseRow({ status: "weird" }));
      await expect(getParticipantList(AUTH)).rejects.toThrow();
    });

    it("세션 행 없음 → unauthenticated, 쿠키 삭제", async () => {
      prepare(promiseRow(), { sessionMissing: true });
      expect(await getParticipantList(AUTH)).toEqual({
        kind: "unauthenticated",
        session: { expiresAt: null, now: NOW },
      });
    });

    it.each([
      ["세션 만료(expires_at = 판정 시각)", { expiresAt: NOW }],
      ["참여자 탈퇴", { participant: { status: "cancelled" } }],
      ["다른 약속 소속", { participant: { promiseId: OTHER_PROMISE_ID } }],
      ["다른 참여자", { participant: { id: "pt-other" } }],
    ] as [string, SessionRow][])("%s → unauthenticated, 명단을 읽지 않는다", async (_label, session) => {
      prepare(promiseRow(), { session });
      expect((await getParticipantList(AUTH)).kind).toBe("unauthenticated");
      expect(tx.participant.findMany).not.toHaveBeenCalled();
    });

    it("draft + 방장 → forbidden, 쿠키 유지, 명단을 읽지 않는다", async () => {
      rows = [row({ id: "pt-me", role: "host" })];
      prepare(promiseRow({ status: "draft", participant_limit: null, voting_deadline_at: null }));
      expect(await getParticipantList({ ...AUTH, participant: { id: "pt-me", role: "host" } })).toEqual({
        kind: "forbidden",
        ...keep,
      });
      expect(tx.participant.findMany).not.toHaveBeenCalled();
    });

    it("draft라도 세션이 무효면 403보다 401이 먼저다", async () => {
      prepare(promiseRow({ status: "draft" }), { session: { participant: { status: "cancelled" } } });
      expect((await getParticipantList(AUTH)).kind).toBe("unauthenticated");
    });

    it("모집 이후인데 정원 값이 없으면 데이터 오류로 예외", async () => {
      prepare(promiseRow({ participant_limit: null }));
      await expect(getParticipantList(AUTH)).rejects.toThrow();
    });
  });
});
