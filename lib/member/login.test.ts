import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/prisma/generated/client";

const promiseFindUnique = vi.hoisted(() => vi.fn());
const participantFindUnique = vi.hoisted(() => vi.fn());
const sessionCreate = vi.hoisted(() => vi.fn());
const queryRaw = vi.hoisted(() => vi.fn());
const executeRaw = vi.hoisted(() => vi.fn());
const failureFindMany = vi.hoisted(() => vi.fn());
const failureCreate = vi.hoisted(() => vi.fn());
const failureDeleteMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => {
  const client: Record<string, unknown> = {
    promise: { findUnique: promiseFindUnique },
    participant: { findUnique: participantFindUnique },
    participantSession: { create: sessionCreate },
    loginFailure: {
      findMany: failureFindMany,
      create: failureCreate,
      deleteMany: failureDeleteMany,
    },
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
  };
  // 시도 제한 트랜잭션도 같은 가짜 클라이언트로 돈다
  client.$transaction = (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

const verifyPin = vi.hoisted(() => vi.fn());
const hashPin = vi.hoisted(() => vi.fn());
vi.mock("./pin", () => ({ verifyPin, hashPin }));

import type { LinkPromise } from "./link-status";
import { loginParticipant, resolveLoginAccess } from "./login";
import { hashSessionToken } from "./session";

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const LINK_CREATED = new Date("2026-10-01T10:00:00+09:00");
const CREATED = new Date("2026-10-01T10:05:00+09:00");
const DEADLINE = new Date("2026-10-10T23:00:00+09:00");
const CONFIRMED_START = new Date("2026-10-20T19:00:00+09:00");

function promise(overrides: Partial<LinkPromise> = {}): LinkPromise {
  return {
    id: PROMISE_ID,
    status: "collecting",
    createdAt: CREATED,
    votingDeadlineAt: DEADLINE,
    confirmedStartAt: null,
    ...overrides,
  };
}

function access(overrides: Partial<LinkPromise>, now: Date) {
  return resolveLoginAccess(
    { inviteToken: "k3Zq8vTb1mRak3Zq8vTb1m", createdAt: LINK_CREATED, promise: promise(overrides) },
    now,
  );
}

describe("resolveLoginAccess (MEMBER-API-04 판정)", () => {
  it("cancelled → cancelled (접근 기간과 무관)", () => {
    expect(access({ status: "cancelled" }, CREATED)).toEqual({ kind: "cancelled" });
  });

  it("진행 중 draft → 판정 시각 + 24시간 세션", () => {
    const now = new Date(CREATED.getTime() + 9 * MIN);
    expect(access({ status: "draft", votingDeadlineAt: null }, now)).toEqual({
      kind: "ok",
      sessionExpiresAt: new Date(now.getTime() + DAY),
    });
  });

  it("draft 10분 경계: 1ms 전은 통과, 정확히 10분이면 draft_expired", () => {
    const draft = { status: "draft", votingDeadlineAt: null };
    const boundary = CREATED.getTime() + 10 * MIN;
    expect(access(draft, new Date(boundary - 1)).kind).toBe("ok");
    expect(access(draft, new Date(boundary))).toEqual({ kind: "draft_expired" });
  });

  it.each(["collecting", "closed"])("%s: 마감 + 7일 경계 (정확히 같으면 expired)", (status) => {
    const boundary = DEADLINE.getTime() + 7 * DAY;
    expect(access({ status }, new Date(boundary - 1))).toEqual({
      kind: "ok",
      sessionExpiresAt: new Date(boundary),
    });
    expect(access({ status }, new Date(boundary))).toEqual({ kind: "expired" });
  });

  it("확정 약속은 마감 + 7일이 지나도 confirmed_start_at + 7일 전이면 통과", () => {
    const now = new Date(DEADLINE.getTime() + 8 * DAY);
    const confirmed = { status: "confirmed", confirmedStartAt: CONFIRMED_START };
    expect(access(confirmed, now)).toEqual({
      kind: "ok",
      sessionExpiresAt: new Date(CONFIRMED_START.getTime() + 7 * DAY),
    });
    expect(access(confirmed, new Date(CONFIRMED_START.getTime() + 7 * DAY))).toEqual({
      kind: "expired",
    });
  });

  it("재조율 중(collecting, 새 마감)이면 새 voting_deadline_at 기준", () => {
    const newDeadline = new Date("2026-10-25T23:00:00+09:00");
    const now = new Date(DEADLINE.getTime() + 10 * DAY); // 이전 마감 + 7일은 지남
    expect(access({ status: "collecting", votingDeadlineAt: newDeadline }, now)).toEqual({
      kind: "ok",
      sessionExpiresAt: new Date(newDeadline.getTime() + 7 * DAY),
    });
  });

  it("약속 없음 → not_found", () => {
    expect(
      resolveLoginAccess({ inviteToken: "t", createdAt: LINK_CREATED, promise: null }, CREATED),
    ).toEqual({ kind: "not_found" });
  });
});

const NOW = new Date("2026-10-05T12:00:00.400+09:00");
const HOST = {
  id: "b9a4c7e1-2f03-4a88-91ad-5c7e6b2d1f90",
  nickname: "승주",
  role: "host",
  status: "active",
  passwordHash: "stored-hash",
};

function mockPromise(overrides: Partial<LinkPromise> = {}) {
  promiseFindUnique.mockResolvedValueOnce({
    ...promise(overrides),
    promiseLink: { inviteToken: "k3Zq8vTb1mRak3Zq8vTb1m", createdAt: LINK_CREATED },
  });
  // 약속 판정 시각, 시도 제한 잠금 + 판정 시각 (같은 시각으로 둔다)
  queryRaw.mockResolvedValueOnce([{ now: NOW }]);
  queryRaw.mockResolvedValueOnce([{ now: NOW }]);
}

const INPUT = { nickname: "승주", pin: "4827" };

describe("loginParticipant", () => {
  beforeEach(() => {
    for (const fn of [promiseFindUnique, participantFindUnique, sessionCreate, queryRaw]) {
      fn.mockReset();
    }
    for (const fn of [executeRaw, failureFindMany, failureCreate, failureDeleteMany]) {
      fn.mockReset().mockResolvedValue(fn === failureFindMany ? [] : { count: 0 });
    }
    verifyPin.mockReset();
    hashPin.mockReset().mockResolvedValue("dummy-hash");
    sessionCreate.mockResolvedValue({ id: "s-1" });
  });

  it.each(["not-a-uuid", "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c4", ""])(
    "UUID 형식이 아닌 promiseId(%s)는 DB 조회 없이 invalid_request",
    async (id) => {
      expect(await loginParticipant(id, INPUT)).toEqual({ kind: "invalid_request" });
      expect(promiseFindUnique).not.toHaveBeenCalled();
    },
  );

  it("없는 약속 → not_found", async () => {
    promiseFindUnique.mockResolvedValueOnce(null);
    queryRaw.mockResolvedValueOnce([{ now: NOW }]);
    expect(await loginParticipant(PROMISE_ID, INPUT)).toEqual({ kind: "not_found" });
  });

  it("약속 상태 판정을 PIN 검증보다 먼저 한다 (cancelled → PIN 비교 없음)", async () => {
    mockPromise({ status: "cancelled" });
    expect(await loginParticipant(PROMISE_ID, INPUT)).toEqual({ kind: "cancelled" });
    expect(participantFindUnique).not.toHaveBeenCalled();
    expect(verifyPin).not.toHaveBeenCalled();
  });

  it("10분 지난 draft → draft_expired, PIN 비교·세션 생성 없음 (로그인은 삭제하지 않는다)", async () => {
    mockPromise({
      status: "draft",
      votingDeadlineAt: null,
      createdAt: new Date(NOW.getTime() - 10 * MIN),
    });
    expect(await loginParticipant(PROMISE_ID, INPUT)).toEqual({ kind: "draft_expired" });
    expect(verifyPin).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("접근 기간 만료 → expired, PIN 비교 없음", async () => {
    mockPromise({ votingDeadlineAt: new Date(NOW.getTime() - 7 * DAY) });
    expect(await loginParticipant(PROMISE_ID, INPUT)).toEqual({ kind: "expired" });
    expect(verifyPin).not.toHaveBeenCalled();
  });

  it("없는 닉네임과 틀린 PIN은 같은 invalid_credentials, 없는 닉네임도 더미 해시와 비교한다", async () => {
    mockPromise();
    participantFindUnique.mockResolvedValueOnce(null);
    verifyPin.mockResolvedValueOnce(false);
    const missing = await loginParticipant(PROMISE_ID, INPUT);
    expect(verifyPin).toHaveBeenLastCalledWith("4827", "dummy-hash");

    mockPromise();
    participantFindUnique.mockResolvedValueOnce(HOST);
    verifyPin.mockResolvedValueOnce(false);
    const wrong = await loginParticipant(PROMISE_ID, INPUT);
    expect(verifyPin).toHaveBeenLastCalledWith("4827", "stored-hash");

    expect(missing).toEqual({ kind: "invalid_credentials" });
    expect(wrong).toEqual(missing);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("더미 해시가 우연히 맞아도 행이 없으면 실패한다", async () => {
    mockPromise();
    participantFindUnique.mockResolvedValueOnce(null);
    verifyPin.mockResolvedValueOnce(true);
    expect(await loginParticipant(PROMISE_ID, INPUT)).toEqual({ kind: "invalid_credentials" });
  });

  it("(promise_id, normalized_nickname)으로 참여자를 찾는다", async () => {
    mockPromise();
    participantFindUnique.mockResolvedValueOnce(HOST);
    verifyPin.mockResolvedValueOnce(true);
    await loginParticipant(PROMISE_ID, INPUT);
    expect(participantFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          promiseId_normalizedNickname: { promiseId: PROMISE_ID, normalizedNickname: "승주" },
        },
      }),
    );
  });

  it("PIN이 맞아도 cancelled 참여자는 participant_cancelled, 세션 없음", async () => {
    mockPromise();
    participantFindUnique.mockResolvedValueOnce({ ...HOST, status: "cancelled" });
    verifyPin.mockResolvedValueOnce(true);
    expect(await loginParticipant(PROMISE_ID, INPUT)).toEqual({ kind: "participant_cancelled" });
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("성공: 새 세션 행만 만들고(기존 세션 삭제·갱신 없음) 마감 + 7일 만료, Max-Age는 남은 초", async () => {
    mockPromise();
    participantFindUnique.mockResolvedValueOnce(HOST);
    verifyPin.mockResolvedValueOnce(true);

    const result = await loginParticipant(PROMISE_ID, INPUT, { sessionToken: "tok" });

    const expiresAt = new Date(DEADLINE.getTime() + 7 * DAY);
    expect(sessionCreate).toHaveBeenCalledTimes(1);
    expect(sessionCreate).toHaveBeenCalledWith({
      data: { participantId: HOST.id, sessionTokenHash: hashSessionToken("tok"), expiresAt },
      select: { id: true },
    });
    expect(result).toEqual({
      kind: "ok",
      promiseId: PROMISE_ID,
      participantId: HOST.id,
      nickname: "승주",
      role: "host",
      status: "active",
      promiseStatus: "collecting",
      sessionExpiresAt: expiresAt,
      sessionToken: "tok",
      sessionMaxAgeSeconds: Math.floor((expiresAt.getTime() - NOW.getTime()) / 1000),
    });
  });

  it("draft 성공: 판정 시각 + 24시간, Max-Age=86400", async () => {
    mockPromise({
      status: "draft",
      createdAt: new Date(NOW.getTime() - 5 * MIN),
      votingDeadlineAt: null,
    });
    participantFindUnique.mockResolvedValueOnce(HOST);
    verifyPin.mockResolvedValueOnce(true);

    const result = await loginParticipant(PROMISE_ID, INPUT);
    expect(result).toMatchObject({
      kind: "ok",
      promiseStatus: "draft",
      sessionExpiresAt: new Date(NOW.getTime() + DAY),
      sessionMaxAgeSeconds: 86400,
    });
  });

  it("판정 직후 약속이 삭제되어 FK 오류(P2003)면 not_found", async () => {
    mockPromise();
    participantFindUnique.mockResolvedValueOnce(HOST);
    verifyPin.mockResolvedValueOnce(true);
    sessionCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "7.10.0" }),
    );
    expect(await loginParticipant(PROMISE_ID, INPUT)).toEqual({ kind: "not_found" });
  });

  it("그 밖의 저장 오류는 그대로 던진다", async () => {
    mockPromise();
    participantFindUnique.mockResolvedValueOnce(HOST);
    verifyPin.mockResolvedValueOnce(true);
    sessionCreate.mockRejectedValueOnce(new Error("boom"));
    await expect(loginParticipant(PROMISE_ID, INPUT)).rejects.toThrow("boom");
  });

  it("같은 참여자·같은 IP로 5번 연속 실패한 뒤에는 PIN이 맞아도 too_many_attempts, PIN 비교·세션 없음", async () => {
    mockPromise();
    failureFindMany.mockResolvedValueOnce(
      [4, 3, 2, 1, 0].map((s) => ({
        ipKey: "203.0.113.7",
        failedAt: new Date(NOW.getTime() - s * 1000),
      })),
    );
    participantFindUnique.mockResolvedValueOnce(HOST);
    verifyPin.mockResolvedValueOnce(true);

    const result = await loginParticipant(PROMISE_ID, INPUT, { ipKey: "203.0.113.7" });

    expect(result).toEqual({ kind: "too_many_attempts", retryAfterSeconds: 15 * 60 });
    expect(verifyPin).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("성공하면 이 참여자·이 IP의 실패 기록을 지워 실패 횟수를 초기화한다", async () => {
    mockPromise();
    participantFindUnique.mockResolvedValueOnce(HOST);
    verifyPin.mockResolvedValueOnce(true);

    await loginParticipant(PROMISE_ID, INPUT, { ipKey: "203.0.113.7" });

    expect(failureDeleteMany).toHaveBeenCalledWith({
      where: { promiseId: PROMISE_ID, normalizedNickname: "승주", ipKey: "203.0.113.7" },
    });
  });

  describe("PIN 시도 제한 (R-41)", () => {
    const IP = "203.0.113.7";
    const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);

    it("틀린 PIN은 판정 시각·IP와 함께 실패를 남기고 49시간 넘은 기록을 조금 지운다", async () => {
      mockPromise();
      participantFindUnique.mockResolvedValueOnce(HOST);
      verifyPin.mockResolvedValueOnce(false);
      expect(await loginParticipant(PROMISE_ID, INPUT, { ipKey: IP })).toEqual({
        kind: "invalid_credentials",
      });
      expect(failureCreate).toHaveBeenCalledWith({
        data: { promiseId: PROMISE_ID, normalizedNickname: "승주", ipKey: IP, failedAt: NOW },
        select: { id: true },
      });
      expect(executeRaw).toHaveBeenCalledTimes(1);
      expect(failureDeleteMany).not.toHaveBeenCalled();
    });

    it("없는 닉네임도 같은 실패 기록을 남긴다(닉네임 존재가 잠금으로 드러나지 않게)", async () => {
      mockPromise();
      participantFindUnique.mockResolvedValueOnce(null);
      verifyPin.mockResolvedValueOnce(false);
      await loginParticipant(PROMISE_ID, INPUT, { ipKey: IP });
      expect(failureCreate).toHaveBeenCalledTimes(1);
    });

    it("없는 닉네임도 5번 실패한 뒤에는 같은 too_many_attempts", async () => {
      mockPromise();
      failureFindMany.mockResolvedValueOnce(
        [4, 3, 2, 1, 0].map((sec) => ({ ipKey: IP, failedAt: ago(sec) })),
      );
      expect(await loginParticipant(PROMISE_ID, INPUT, { ipKey: IP })).toEqual({
        kind: "too_many_attempts",
        retryAfterSeconds: 15 * 60,
      });
      expect(participantFindUnique).not.toHaveBeenCalled();
    });

    it("48시간(하루 상한 24시간 창 + 24시간 잠금) 안의 기록만 읽는다", async () => {
      mockPromise();
      participantFindUnique.mockResolvedValueOnce(HOST);
      verifyPin.mockResolvedValueOnce(true);
      await loginParticipant(PROMISE_ID, INPUT, { ipKey: IP });
      expect(failureFindMany).toHaveBeenCalledWith({
        where: {
          promiseId: PROMISE_ID,
          normalizedNickname: "승주",
          failedAt: { gt: new Date(NOW.getTime() - 48 * 60 * MIN) },
        },
        select: { ipKey: true, failedAt: true },
      });
    });

    it("다른 IP의 5번 실패는 이 IP의 로그인을 막지 않는다", async () => {
      mockPromise();
      failureFindMany.mockResolvedValueOnce(
        [4, 3, 2, 1, 0].map((sec) => ({ ipKey: "198.51.100.9", failedAt: ago(sec) })),
      );
      participantFindUnique.mockResolvedValueOnce(HOST);
      verifyPin.mockResolvedValueOnce(true);
      expect(await loginParticipant(PROMISE_ID, INPUT, { ipKey: IP })).toMatchObject({
        kind: "ok",
      });
    });

    it("IP와 관계없이 1시간에 21번째 실패가 생기면 새 IP도 too_many_attempts", async () => {
      mockPromise();
      failureFindMany.mockResolvedValueOnce(
        Array.from({ length: 21 }, (_, i) => ({ ipKey: `198.51.100.${i}`, failedAt: ago(60) })),
      );
      expect(await loginParticipant(PROMISE_ID, INPUT, { ipKey: IP })).toEqual({
        kind: "too_many_attempts",
        retryAfterSeconds: 14 * 60,
      });
    });

    it("잠금 키는 DB의 약속 id(소문자)와 정규화 닉네임으로 만든다", async () => {
      promiseFindUnique.mockResolvedValueOnce({
        ...promise(),
        promiseLink: { inviteToken: "k3Zq8vTb1mRak3Zq8vTb1m", createdAt: LINK_CREATED },
      });
      queryRaw.mockResolvedValueOnce([{ now: NOW }]);
      queryRaw.mockResolvedValueOnce([{ now: NOW }]);
      participantFindUnique.mockResolvedValueOnce(HOST);
      verifyPin.mockResolvedValueOnce(true);
      await loginParticipant(PROMISE_ID.toUpperCase(), INPUT, { ipKey: IP });
      const lockCall = queryRaw.mock.calls[1];
      expect(lockCall.slice(1)).toEqual([`login:${PROMISE_ID}:승주`]);
    });

    it("IP 키를 받지 못하면 unknown 한 키로 센다", async () => {
      mockPromise();
      participantFindUnique.mockResolvedValueOnce(HOST);
      verifyPin.mockResolvedValueOnce(false);
      await loginParticipant(PROMISE_ID, INPUT);
      expect(failureCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ipKey: "unknown" }) }),
      );
    });

    it("하루 상한: 24시간에 50번 실패한 참여자는 새 IP·맞는 PIN도 too_many_attempts(남은 시간 약 24시간)", async () => {
      mockPromise();
      failureFindMany.mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, i) => ({
          ipKey: `198.51.100.${i}`,
          failedAt: new Date(NOW.getTime() - (49 - i) * 28 * MIN),
        })),
      );
      expect(await loginParticipant(PROMISE_ID, INPUT, { ipKey: IP })).toEqual({
        kind: "too_many_attempts",
        retryAfterSeconds: 24 * 60 * 60,
      });
      expect(verifyPin).not.toHaveBeenCalled();
    });
  });
});
