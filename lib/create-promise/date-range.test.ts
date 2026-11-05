import { describe, expect, it } from "vitest";
import {
  TODAY_ONLY_NOTICE,
  addDays,
  isSelectableDate,
  isSelectableEnd,
  maxSelectableDate,
  monthGrid,
  selectDate,
} from "@/lib/create-promise/date-range";

describe("선택 가능 날짜 (R-07)", () => {
  it("오늘 이전은 고를 수 없고 오늘은 고를 수 있다", () => {
    expect(isSelectableDate("2026-11-04", "2026-11-05")).toBe(false);
    expect(isSelectableDate("2026-11-05", "2026-11-05")).toBe(true);
  });

  it("상한은 오늘부터 3개월(달력 월 단위)", () => {
    expect(maxSelectableDate("2026-11-05")).toBe("2027-02-05");
    expect(isSelectableDate("2027-02-05", "2026-11-05")).toBe(true);
    expect(isSelectableDate("2027-02-06", "2026-11-05")).toBe(false);
  });

  it("해당 날짜가 없으면 말일로 보정한다 (11-30 → 02-28, 윤년 02-29)", () => {
    expect(maxSelectableDate("2026-11-30")).toBe("2027-02-28");
    expect(isSelectableDate("2027-03-01", "2026-11-30")).toBe(false);
    expect(maxSelectableDate("2027-11-30")).toBe("2028-02-29");
    expect(maxSelectableDate("2026-12-31")).toBe("2027-03-31");
  });

  it("종료일은 내일부터, 시작일 이후만 가능하다", () => {
    expect(isSelectableEnd("2026-11-05", "2026-11-05", "2026-11-05")).toBe(false);
    expect(isSelectableEnd("2026-11-06", "2026-11-05", "2026-11-05")).toBe(true);
    expect(isSelectableEnd("2026-11-07", "2026-11-08", "2026-11-05")).toBe(false);
    expect(isSelectableEnd("2027-02-06", "2026-11-06", "2026-11-05")).toBe(false);
  });

  it("addDays는 월·연 경계를 넘는다", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("selectDate — 첫 클릭 시작일, 두 번째 클릭 종료일", () => {
  const today = "2026-11-05";
  const empty = { start: null, end: null };

  it("첫 클릭은 시작일, 두 번째 클릭은 종료일", () => {
    const first = selectDate(empty, "2026-11-10", today);
    expect(first).toEqual({ range: { start: "2026-11-10", end: null }, notice: null });
    const second = selectDate(first.range, "2026-11-20", today);
    expect(second).toEqual({ range: { start: "2026-11-10", end: "2026-11-20" }, notice: null });
  });

  it("시작일과 같은 날(내일 이후)을 다시 누르면 하루짜리 범위", () => {
    const r = selectDate({ start: "2026-11-10", end: null }, "2026-11-10", today);
    expect(r.range).toEqual({ start: "2026-11-10", end: "2026-11-10" });
  });

  it("오늘만 고르면 안내하고 범위를 바꾸지 않는다", () => {
    const r = selectDate({ start: today, end: null }, today, today);
    expect(r).toEqual({ range: { start: today, end: null }, notice: TODAY_ONLY_NOTICE });
  });

  it("오늘 시작 → 내일 종료는 가능하다", () => {
    const r = selectDate({ start: today, end: null }, "2026-11-06", today);
    expect(r.range).toEqual({ start: today, end: "2026-11-06" });
  });

  it("시작일보다 이른 날을 누르면 새 시작일", () => {
    const r = selectDate({ start: "2026-11-10", end: null }, "2026-11-08", today);
    expect(r.range).toEqual({ start: "2026-11-08", end: null });
  });

  it("범위가 완성된 뒤 누르면 새로 시작한다", () => {
    const r = selectDate({ start: "2026-11-10", end: "2026-11-12" }, "2026-11-20", today);
    expect(r.range).toEqual({ start: "2026-11-20", end: null });
  });

  it("선택 불가 날짜는 무시한다", () => {
    const range = { start: "2026-11-10", end: null };
    expect(selectDate(range, "2026-11-04", today)).toEqual({ range, notice: null });
    expect(selectDate(range, "2027-02-06", today)).toEqual({ range, notice: null });
  });
});

describe("monthGrid", () => {
  it("2026년 11월은 일요일 시작, 30일, 7의 배수 칸", () => {
    const cells = monthGrid(2026, 11);
    expect(cells[0]).toBe("2026-11-01");
    expect(cells.filter(Boolean)).toHaveLength(30);
    expect(cells.length % 7).toBe(0);
  });

  it("2026년 10월은 목요일 시작이라 앞에 빈칸 4개", () => {
    const cells = monthGrid(2026, 10);
    expect(cells.slice(0, 4)).toEqual([null, null, null, null]);
    expect(cells[4]).toBe("2026-10-01");
  });
});
