import { describe, expect, it } from "vitest";
import { toSeoulIsoString } from "./seoul";

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
