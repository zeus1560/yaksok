import { describe, expect, it } from "vitest";
import {
  accessExpiresAt,
  DRAFT_EXPIRY_MS,
  LINK_EXPIRY_MS,
  linkExpiryBase,
  resolveLinkStatus,
  type LinkPromise,
  type LinkWithPromise,
} from "./link-status";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";
const LINK_CREATED = new Date("2026-11-01T10:00:00+09:00");
const MS = 1;

function at(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

function link(promise: Partial<LinkPromise> | null): LinkWithPromise {
  return {
    inviteToken: TOKEN,
    createdAt: LINK_CREATED,
    promise: promise && {
      id: "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42",
      status: "collecting",
      createdAt: at(LINK_CREATED, 60_000),
      votingDeadlineAt: null,
      confirmedStartAt: null,
      ...promise,
    },
  };
}

describe("linkExpiryBase (MEMBER-01-02)", () => {
  const deadline = new Date("2026-11-05T18:00:00+09:00");
  const start = new Date("2026-11-10T19:00:00+09:00");

  it("방장 등록 전 링크는 링크 발급 시각", () => {
    expect(linkExpiryBase(link(null))).toEqual(LINK_CREATED);
  });

  it("마감이 없는 draft는 링크 발급 시각", () => {
    expect(linkExpiryBase(link({ status: "draft" }))).toEqual(LINK_CREATED);
  });

  it.each(["draft", "collecting", "closed", "cancelled"])(
    "미확정(%s)은 voting_deadline_at",
    (status) => {
      expect(linkExpiryBase(link({ status, votingDeadlineAt: deadline }))).toEqual(deadline);
    },
  );

  it("확정은 confirmed_start_at", () => {
    expect(
      linkExpiryBase(
        link({ status: "confirmed", votingDeadlineAt: deadline, confirmedStartAt: start }),
      ),
    ).toEqual(start);
  });

  it("재조율로 다시 모집 중이면 새 마감이 기준이 된다", () => {
    const newDeadline = new Date("2026-11-20T18:00:00+09:00");
    expect(
      linkExpiryBase(
        link({ status: "collecting", votingDeadlineAt: newDeadline, confirmedStartAt: null }),
      ),
    ).toEqual(newDeadline);
  });
});

describe("accessExpiresAt (draft를 뺀 세션 만료 = 링크 만료)", () => {
  const deadline = new Date("2026-11-05T18:00:00+09:00");
  const start = new Date("2026-11-10T19:00:00+09:00");
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  it("확정 약속은 confirmed_start_at + 7일", () => {
    expect(
      accessExpiresAt(
        link({ status: "confirmed", votingDeadlineAt: deadline, confirmedStartAt: start }),
      ),
    ).toEqual(new Date("2026-11-17T19:00:00+09:00"));
  });

  it.each(["collecting", "closed"])("미확정(%s)은 voting_deadline_at + 7일", (status) => {
    expect(accessExpiresAt(link({ status, votingDeadlineAt: deadline }))).toEqual(
      new Date("2026-11-12T18:00:00+09:00"),
    );
  });

  it("방장 등록 전·마감 없는 draft는 링크 발급 + 7일", () => {
    expect(accessExpiresAt(link(null))).toEqual(at(LINK_CREATED, SEVEN_DAYS));
    expect(accessExpiresAt(link({ status: "draft" }))).toEqual(at(LINK_CREATED, SEVEN_DAYS));
  });

  it("링크 정보 없이 약속 상태만 넘겨도 된다 (세션 일괄 갱신용 좁은 입력)", () => {
    expect(
      accessExpiresAt({
        createdAt: LINK_CREATED,
        promise: { status: "collecting", votingDeadlineAt: deadline, confirmedStartAt: null },
      }),
    ).toEqual(new Date("2026-11-12T18:00:00+09:00"));
  });
});

describe("resolveLinkStatus 링크 만료 경계 (기준 + 7일 ≤ 판정 시각이면 만료)", () => {
  const deadline = new Date("2026-11-05T18:00:00+09:00");
  const start = new Date("2026-11-10T19:00:00+09:00");

  it.each([
    ["방장 등록 전", link(null), LINK_CREATED],
    ["collecting", link({ status: "collecting", votingDeadlineAt: deadline }), deadline],
    [
      "confirmed",
      link({ status: "confirmed", votingDeadlineAt: deadline, confirmedStartAt: start }),
      start,
    ],
  ] as const)("%s: 7일 직전은 유효, 정확히 7일이면 만료", (_name, target, base) => {
    expect(resolveLinkStatus(target, at(base, LINK_EXPIRY_MS - MS)).kind).toBe("ok");
    expect(resolveLinkStatus(target, at(base, LINK_EXPIRY_MS))).toEqual({ kind: "expired" });
  });

  it("확정 약속은 마감 + 7일이 지나도 시작 시각 + 7일 전이면 유효하다", () => {
    const target = link({
      status: "confirmed",
      votingDeadlineAt: deadline,
      confirmedStartAt: start,
    });
    expect(resolveLinkStatus(target, at(deadline, LINK_EXPIRY_MS)).kind).toBe("ok");
  });

  it("재조율로 마감이 늦춰지면 이전 마감 + 7일이 지나도 유효하다", () => {
    const newDeadline = new Date("2026-11-20T18:00:00+09:00");
    const target = link({ status: "collecting", votingDeadlineAt: newDeadline });
    expect(resolveLinkStatus(target, at(deadline, LINK_EXPIRY_MS)).kind).toBe("ok");
  });

  // CHECK(ck_promise_required_settings)는 cancelled에 voting_deadline_at을 요구하지 않는다
  it("마감 없이 취소된 약속은 링크 발급 시각 기준이다", () => {
    const target = link({ status: "cancelled", votingDeadlineAt: null });

    expect(linkExpiryBase(target)).toEqual(LINK_CREATED);
    expect(resolveLinkStatus(target, at(LINK_CREATED, LINK_EXPIRY_MS - MS))).toMatchObject({
      kind: "ok",
      body: { promiseStatus: "cancelled", nextAction: "cancelled" },
    });
    expect(resolveLinkStatus(target, at(LINK_CREATED, LINK_EXPIRY_MS))).toEqual({
      kind: "expired",
    });
  });
});

describe("resolveLinkStatus 응답 본문", () => {
  const now = at(LINK_CREATED, 2 * 60 * 60 * 1000);
  const deadline = new Date("2026-11-05T18:00:00+09:00");

  it("방장 등록 전: unclaimed + register_host", () => {
    expect(resolveLinkStatus(link(null), now)).toEqual({
      kind: "ok",
      body: {
        inviteToken: TOKEN,
        promiseStatus: "unclaimed",
        promiseId: null,
        nextAction: "register_host",
        pollAfterMs: null,
        draftExpired: false,
      },
    });
  });

  it("10분 안의 draft: wait_setup + pollAfterMs", () => {
    const draftCreated = at(now, -(DRAFT_EXPIRY_MS - MS));
    const result = resolveLinkStatus(link({ status: "draft", createdAt: draftCreated }), now);
    expect(result).toMatchObject({
      kind: "ok",
      body: {
        promiseStatus: "draft",
        nextAction: "wait_setup",
        pollAfterMs: 3000,
        draftExpired: false,
      },
    });
  });

  it("draft 생성 + 10분이 되면 unclaimed로 계산하고 draftExpired=true (STATE-02-02)", () => {
    const draftCreated = at(now, -DRAFT_EXPIRY_MS);
    expect(resolveLinkStatus(link({ status: "draft", createdAt: draftCreated }), now)).toEqual({
      kind: "ok",
      body: {
        inviteToken: TOKEN,
        promiseStatus: "unclaimed",
        promiseId: null,
        nextAction: "register_host",
        pollAfterMs: null,
        draftExpired: true,
      },
    });
  });

  it("링크 7일 만료와 draft 10분 만료가 겹치면 410이 먼저다 (처리 순서 3 → 5)", () => {
    const target = link({
      status: "draft",
      createdAt: at(LINK_CREATED, LINK_EXPIRY_MS - DRAFT_EXPIRY_MS),
    });
    expect(resolveLinkStatus(target, at(LINK_CREATED, LINK_EXPIRY_MS))).toEqual({
      kind: "expired",
    });
  });

  it.each([
    ["collecting", "join"],
    ["closed", "view_result"],
    ["confirmed", "view_result"],
    ["cancelled", "cancelled"],
  ])("%s → %s, promiseId 포함, pollAfterMs null", (status, nextAction) => {
    const result = resolveLinkStatus(
      link({
        status,
        votingDeadlineAt: deadline,
        confirmedStartAt: status === "confirmed" ? deadline : null,
      }),
      now,
    );
    expect(result).toEqual({
      kind: "ok",
      body: {
        inviteToken: TOKEN,
        promiseStatus: status,
        promiseId: "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42",
        nextAction,
        pollAfterMs: null,
        draftExpired: false,
      },
    });
  });

  it("collecting·closed는 draft 10분 규칙을 적용하지 않는다", () => {
    const old = at(now, -DRAFT_EXPIRY_MS * 6);
    const result = resolveLinkStatus(
      link({ status: "collecting", createdAt: old, votingDeadlineAt: deadline }),
      now,
    );
    expect(result).toMatchObject({ body: { promiseStatus: "collecting", draftExpired: false } });
  });

  it("알 수 없는 상태는 오류로 던진다", () => {
    expect(() => resolveLinkStatus(link({ status: "toString" }), now)).toThrow();
  });
});
