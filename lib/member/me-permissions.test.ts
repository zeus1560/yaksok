import { describe, expect, it } from "vitest";

import { computeMePermissions, isDeadlinePassed } from "./me-permissions";

const DEADLINE = new Date("2026-11-11T18:00:00.000+09:00");

describe("isDeadlinePassed", () => {
  it("마감 1ms 전 → false", () => {
    expect(isDeadlinePassed(DEADLINE, new Date(DEADLINE.getTime() - 1))).toBe(false);
  });

  it("정확히 마감 시각 → true (경계는 지난 것으로 본다)", () => {
    expect(isDeadlinePassed(DEADLINE, new Date(DEADLINE.getTime()))).toBe(true);
  });

  it("마감 1ms 후 → true", () => {
    expect(isDeadlinePassed(DEADLINE, new Date(DEADLINE.getTime() + 1))).toBe(true);
  });

  it("마감이 없는 draft → false", () => {
    expect(isDeadlinePassed(null, DEADLINE)).toBe(false);
  });
});

const NONE = {
  canEditAvailability: false,
  canSubmit: false,
  canManagePromise: false,
  canLeave: false,
};

describe("computeMePermissions", () => {
  const STATUSES = ["draft", "collecting", "closed", "confirmed", "cancelled"] as const;

  // [promiseStatus, deadlinePassed, role] → 기대값 (참여자 active)
  const cases: [string, boolean, string, typeof NONE][] = [
    ["draft", false, "host", { ...NONE, canManagePromise: true, canLeave: true }],
    ["draft", false, "member", { ...NONE, canLeave: true }],
    [
      "collecting",
      false,
      "host",
      { canEditAvailability: true, canSubmit: true, canManagePromise: true, canLeave: true },
    ],
    [
      "collecting",
      false,
      "member",
      { canEditAvailability: true, canSubmit: true, canManagePromise: false, canLeave: true },
    ],
    // 상태 전환 전이라도 마감이 지났으면 입력·제출 불가 (TIME-15-04)
    ["collecting", true, "host", { ...NONE, canManagePromise: true, canLeave: true }],
    ["collecting", true, "member", { ...NONE, canLeave: true }],
    ["closed", true, "host", { ...NONE, canManagePromise: true, canLeave: true }],
    ["closed", true, "member", { ...NONE, canLeave: true }],
    // 재조율 등으로 closed인데 마감 전인 경우에도 입력은 collecting에서만
    ["closed", false, "member", { ...NONE, canLeave: true }],
    ["confirmed", true, "host", { ...NONE, canManagePromise: true, canLeave: true }],
    ["confirmed", true, "member", { ...NONE, canLeave: true }],
    ["cancelled", false, "host", NONE],
    ["cancelled", true, "member", NONE],
  ];

  it.each(cases)("active %s, 마감 경과 %s, %s", (promiseStatus, deadlinePassed, role, expected) => {
    expect(computeMePermissions({ role, status: "active", promiseStatus, deadlinePassed })).toEqual(
      expected,
    );
  });

  it("canSubmit은 항상 canEditAvailability와 같다", () => {
    for (const promiseStatus of STATUSES) {
      for (const deadlinePassed of [false, true]) {
        for (const role of ["host", "member"]) {
          const p = computeMePermissions({ role, status: "active", promiseStatus, deadlinePassed });
          expect(p.canSubmit).toBe(p.canEditAvailability);
        }
      }
    }
  });

  it("cancelled 참여자는 상태·역할·마감과 무관하게 모두 false", () => {
    for (const promiseStatus of STATUSES) {
      for (const deadlinePassed of [false, true]) {
        for (const role of ["host", "member"]) {
          expect(
            computeMePermissions({ role, status: "cancelled", promiseStatus, deadlinePassed }),
          ).toEqual(NONE);
        }
      }
    }
  });
});
