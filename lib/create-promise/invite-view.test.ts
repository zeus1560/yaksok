import { describe, expect, it } from "vitest";

import { SETUP_WINDOW_MS } from "./countdown";
import { decideInviteView, setupCountdownBase, type NextAction } from "./invite-view";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";
const OTHER_ID = "0e2a9d61-3b7c-4f15-8a40-6c1d2e9f7b33";
const NOW = 1_800_000_000_000;

describe("decideInviteView", () => {
  it("draft + /me 200 host → 설정 화면", () => {
    expect(decideInviteView("wait_setup", { ok: true, role: "host", promiseStatus: "draft" })).toBe(
      "setup",
    );
  });

  it("draft + /me 실패(401·403 등) → 대기 화면", () => {
    expect(decideInviteView("wait_setup", { ok: false })).toBe("waiting");
  });

  it("draft + /me 200 member → 대기 화면", () => {
    expect(
      decideInviteView("wait_setup", { ok: true, role: "member", promiseStatus: "draft" }),
    ).toBe("waiting");
  });

  it("링크는 draft였지만 /me 시점에 collecting → 방장이어도 설정 화면이 아니라 링크 결과를 따른다", () => {
    expect(
      decideInviteView("wait_setup", { ok: true, role: "host", promiseStatus: "collecting" }),
    ).toBe("waiting");
  });

  it("promiseId가 없어 /me를 부르지 않음 → 방장 등록", () => {
    expect(decideInviteView("register_host", null)).toBe("register");
  });

  it.each<NextAction>(["join", "view_result", "cancelled"])(
    "%s → 방장 여부와 무관하게 임시 참여 화면",
    (nextAction) => {
      expect(
        decideInviteView(nextAction, { ok: true, role: "host", promiseStatus: "collecting" }),
      ).toBe("join");
      expect(decideInviteView(nextAction, { ok: false })).toBe("join");
    },
  );
});

describe("setupCountdownBase", () => {
  const record = (promiseId: string, localExpiresAt: number) =>
    JSON.stringify({ promiseId, localExpiresAt });

  it("같은 약속의 유효한 저장값 → 로컬 만료 시각", () => {
    expect(setupCountdownBase(record(PROMISE_ID, NOW + 60_000), PROMISE_ID, NOW)).toBe(
      NOW + 60_000,
    );
  });

  it("저장값 없음(다른 기기·저장소 삭제) → null", () => {
    expect(setupCountdownBase(null, PROMISE_ID, NOW)).toBeNull();
  });

  it("다른 약속의 저장값 → null", () => {
    expect(setupCountdownBase(record(OTHER_ID, NOW + 60_000), PROMISE_ID, NOW)).toBeNull();
  });

  it("시한이 지났거나 10분보다 많이 남은 값 → null", () => {
    expect(setupCountdownBase(record(PROMISE_ID, NOW), PROMISE_ID, NOW)).toBeNull();
    expect(
      setupCountdownBase(record(PROMISE_ID, NOW + SETUP_WINDOW_MS + 1), PROMISE_ID, NOW),
    ).toBeNull();
  });
});
