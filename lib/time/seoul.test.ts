import { describe, expect, it } from "vitest";
import {
  addCalendarMonths,
  isCalendarDate,
  seoulDateOf,
  seoulMidnight,
  toSeoulIsoString,
} from "./seoul";

describe("서울 날짜 헬퍼", () => {
  it("seoulDateOf: UTC 15:00 이후는 서울 기준 다음 날", () => {
    expect(seoulDateOf(new Date("2026-11-03T14:59:59.999Z"))).toBe("2026-11-03");
    expect(seoulDateOf(new Date("2026-11-03T15:00:00Z"))).toBe("2026-11-04");
  });

  it("seoulMidnight: 서울 00:00 = 전날 UTC 15:00", () => {
    expect(seoulMidnight("2026-11-20").toISOString()).toBe("2026-11-19T15:00:00.000Z");
  });

  it.each([
    ["2026-02-28", true],
    ["2026-02-29", false],
    ["2028-02-29", true],
    ["2026-13-01", false],
    ["2026-04-31", false],
    ["2026-4-01", false],
  ])("isCalendarDate(%s) = %s", (ymd, ok) => {
    expect(isCalendarDate(ymd)).toBe(ok);
  });

  it.each([
    ["2026-11-04", "2027-02-04"],
    ["2026-11-30", "2027-02-28"],
    ["2027-11-30", "2028-02-29"],
    ["2026-10-31", "2027-01-31"],
    ["2026-12-31", "2027-03-31"],
  ])("addCalendarMonths(%s, 3) = %s (말일 보정)", (ymd, expected) => {
    expect(addCalendarMonths(ymd, 3)).toBe(expected);
  });
});

describe("toSeoulIsoString", () => {
  it("+09:00 오프셋으로 표기하고 밀리초는 버린다", () => {
    expect(toSeoulIsoString(new Date("2026-10-11T03:10:00.999Z"))).toBe(
      "2026-10-11T12:10:00+09:00",
    );
  });

  it("UTC 기준 전날이어도 서울 날짜로 넘어간다", () => {
    expect(toSeoulIsoString(new Date("2026-10-11T15:30:00Z"))).toBe("2026-10-12T00:30:00+09:00");
  });
});
