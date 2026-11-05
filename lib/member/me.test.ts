import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));

import { getMyParticipation } from "./me";
import type { PromiseSession } from "./session-auth";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const NOW = new Date("2026-11-10T12:00:00.400+09:00");
const DB_NOW = new Date(NOW.getTime() + 5);
const EXPIRES = new Date(NOW.getTime() + 3600_000);
const DEADLINE = new Date("2026-11-11T18:00:00+09:00");
const AUTH: PromiseSession = {
  promise: { id: PROMISE_ID, status: "collecting", promiseLinkId: "l-1" },
  participant: { id: "pt-me", role: "host" },
  session: { id: "s-1", token: "tok", expiresAt: EXPIRES },
  now: NOW,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    expires_at: EXPIRES,
    participant_id: "pt-me",
    participant_promise_id: PROMISE_ID,
    nickname: "방장",
    role: "host",
    participant_status: "active",
    availability_submitted_at: null,
    promise_status: "collecting",
    voting_deadline_at: DEADLINE,
    now: DB_NOW,
    ...overrides,
  };
}

describe("getMyParticipation", () => {
  beforeEach(() => queryRaw.mockReset());

  it("collecting 방장, 마감 전 → 모든 권한, 판정 시각은 재조회한 DB 시각", async () => {
    queryRaw.mockResolvedValueOnce([row()]);
    expect(await getMyParticipation(AUTH)).toEqual({
      kind: "ok",
      participantId: "pt-me",
      nickname: "방장",
      role: "host",
      status: "active",
      availabilitySubmittedAt: null,
      promiseStatus: "collecting",
      deadlinePassed: false,
      permissions: {
        canEditAvailability: true,
        canSubmit: true,
        canManagePromise: true,
        canLeave: true,
      },
      sessionExpiresAt: EXPIRES,
      session: { expiresAt: EXPIRES, now: DB_NOW },
    });
  });

  it("세션 id로 조회한다(세션·참여자·약속 한 문장)", async () => {
    queryRaw.mockResolvedValueOnce([row()]);
    await getMyParticipation(AUTH);
    const [strings, ...values] = queryRaw.mock.calls[0];
    expect(strings.join("?")).toContain("FROM participant_sessions s");
    expect(values).toEqual(["s-1"]);
  });

  it("상태가 collecting이어도 정확히 마감 시각이면 deadlinePassed=true, 입력·제출 불가 (TIME-15-04)", async () => {
    queryRaw.mockResolvedValueOnce([
      row({
        voting_deadline_at: DEADLINE,
        now: DEADLINE,
        expires_at: new Date(DEADLINE.getTime() + 3600_000),
      }),
    ]);
    const result = await getMyParticipation(AUTH);
    expect(result).toMatchObject({
      kind: "ok",
      promiseStatus: "collecting",
      deadlinePassed: true,
      permissions: { canEditAvailability: false, canSubmit: false, canLeave: true },
    });
  });

  it("draft 방장: 마감 없음 → deadlinePassed=false, 관리 가능", async () => {
    queryRaw.mockResolvedValueOnce([row({ promise_status: "draft", voting_deadline_at: null })]);
    expect(await getMyParticipation(AUTH)).toMatchObject({
      kind: "ok",
      role: "host",
      promiseStatus: "draft",
      deadlinePassed: false,
      permissions: { canManagePromise: true, canEditAvailability: false },
    });
  });

  it("제출 시각을 그대로 돌려준다", async () => {
    const submitted = new Date("2026-11-10T03:35:10.027Z");
    queryRaw.mockResolvedValueOnce([row({ availability_submitted_at: submitted })]);
    expect(await getMyParticipation(AUTH)).toMatchObject({ availabilitySubmittedAt: submitted });
  });

  it("취소된 약속 → 200용 결과, 권한 모두 false", async () => {
    queryRaw.mockResolvedValueOnce([row({ promise_status: "cancelled" })]);
    expect(await getMyParticipation(AUTH)).toMatchObject({
      kind: "ok",
      promiseStatus: "cancelled",
      permissions: {
        canEditAvailability: false,
        canSubmit: false,
        canManagePromise: false,
        canLeave: false,
      },
    });
  });

  it("세션 행이 사라짐 → unauthenticated, 쿠키 삭제용 expiresAt=null", async () => {
    queryRaw.mockResolvedValueOnce([]);
    expect(await getMyParticipation(AUTH)).toEqual({
      kind: "unauthenticated",
      session: { expiresAt: null, now: NOW },
    });
  });

  it.each([
    ["세션 만료 경계(expires_at = DB 시각)", { expires_at: DB_NOW }],
    ["인증 뒤 탈퇴·내보내기(cancelled 참여자, C-07)", { participant_status: "cancelled" }],
    ["다른 약속 소속", { participant_promise_id: "0e2a9d61-3b7c-4f15-8a40-6c1d2e9f7b33" }],
    ["다른 참여자", { participant_id: "pt-other" }],
  ])("%s → unauthenticated", async (_, overrides) => {
    queryRaw.mockResolvedValueOnce([row(overrides)]);
    const result = await getMyParticipation(AUTH);
    expect(result.kind).toBe("unauthenticated");
    expect(result.session.now).toBe(DB_NOW);
  });
});
