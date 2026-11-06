import { describe, expect, it } from "vitest";
import {
  applyRect,
  buildGrid,
  cellMs,
  dailyRows,
  datesBetween,
  dayLabel,
  editableDaySlots,
  isPastSlot,
  slotRangeLabel,
  slotStartMs,
  timeToMinute,
  toggleDay,
  toggleSlot,
} from "./grid";

// 이 파일의 기대값은 기기 시간대와 무관해야 한다. TZ=UTC·America/Los_Angeles로도 실행한다
const ms = (iso: string) => Date.parse(iso);

describe("timeToMinute", () => {
  it("HH:mm을 분으로, 24:00은 1440", () => {
    expect(timeToMinute("00:00")).toBe(0);
    expect(timeToMinute("09:30")).toBe(570);
    expect(timeToMinute("24:00")).toBe(1440);
  });
  it("형식이 틀리면 NaN", () => {
    expect(timeToMinute("9:00")).toBeNaN();
  });
});

describe("dailyRows", () => {
  it("시작 ≥ 하루 시작, 시작 + 30분 ≤ 하루 종료인 칸만", () => {
    const rows = dailyRows(540, 660);
    expect(rows.map((r) => r.label)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(rows.map((r) => r.isHour)).toEqual([true, false, true, false]);
  });
  it("24:00 종료면 23:30이 마지막 칸", () => {
    const rows = dailyRows(1380, 1440);
    expect(rows.map((r) => r.label)).toEqual(["23:00", "23:30"]);
  });
  it("00:00~24:00은 48칸", () => {
    expect(dailyRows(0, 1440)).toHaveLength(48);
  });
});

describe("datesBetween·dayLabel", () => {
  it("월·연 경계를 넘는 한국 날짜 목록", () => {
    expect(datesBetween("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
  it("시작 > 종료면 빈 목록", () => {
    expect(datesBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });
  it("요일은 한국 날짜 기준", () => {
    expect(dayLabel("2026-11-06")).toEqual({ label: "11/6", weekday: "금" });
    expect(dayLabel("2026-11-08")).toEqual({ label: "11/8", weekday: "일" });
  });
});

describe("slotStartMs·buildGrid", () => {
  it("한국 날짜 00:00(+09:00) + 분", () => {
    expect(slotStartMs("2026-11-07", 540)).toBe(ms("2026-11-07T09:00:00+09:00"));
    // 한국 00:30은 UTC로 전날이다
    expect(slotStartMs("2026-11-07", 30)).toBe(ms("2026-11-06T15:30:00Z"));
    expect(slotStartMs("2026-11-07", 1410)).toBe(ms("2026-11-07T23:30:00+09:00"));
  });
  it("설정으로 열·행을 만든다", () => {
    const grid = buildGrid({
      dateRangeStart: "2026-11-07",
      dateRangeEnd: "2026-11-08",
      dailyStartTime: "22:00",
      dailyEndTime: "24:00",
    });
    expect(grid.days.map((d) => d.date)).toEqual(["2026-11-07", "2026-11-08"]);
    expect(grid.rows.map((r) => r.label)).toEqual(["22:00", "22:30", "23:00", "23:30"]);
    expect(cellMs(grid, { day: 1, row: 3 })).toBe(ms("2026-11-08T23:30:00+09:00"));
  });
});

describe("isPastSlot", () => {
  const slot = ms("2026-11-07T09:00:00+09:00");
  it("시작 ≤ 서버 현재면 지난 칸 (경계 포함)", () => {
    expect(isPastSlot(slot, slot)).toBe(true);
    expect(isPastSlot(slot, slot + 1)).toBe(true);
    expect(isPastSlot(slot, slot - 1)).toBe(false);
  });
});

describe("slotRangeLabel", () => {
  it("마지막 칸은 24:00까지", () => {
    expect(slotRangeLabel(840)).toBe("14:00–14:30");
    expect(slotRangeLabel(1410)).toBe("23:30–24:00");
  });
});

describe("선택", () => {
  const grid = buildGrid({
    dateRangeStart: "2026-11-07",
    dateRangeEnd: "2026-11-09",
    dailyStartTime: "09:00",
    dailyEndTime: "11:00",
  });
  const at = (day: number, row: number) => cellMs(grid, { day, row });
  const early = ms("2026-11-01T00:00:00+09:00");

  it("사각형을 mode로 통일한다", () => {
    const base = new Set([at(0, 0)]);
    const on = applyRect(base, grid, { day: 1, row: 2 }, { day: 0, row: 1 }, true, early);
    expect([...on].sort()).toEqual([at(0, 0), at(0, 1), at(0, 2), at(1, 1), at(1, 2)].sort());
    const off = applyRect(on, grid, { day: 0, row: 0 }, { day: 1, row: 1 }, false, early);
    expect([...off].sort()).toEqual([at(0, 2), at(1, 2)].sort());
    expect(base.size).toBe(1); // 원본은 그대로
  });

  it("지난 칸은 사각형에 들어 있어도 바꾸지 않는다", () => {
    const now = at(0, 1); // 11/7 09:30까지 지남
    const base = new Set([at(0, 0)]);
    const off = applyRect(base, grid, { day: 0, row: 0 }, { day: 0, row: 3 }, false, now);
    expect(off.has(at(0, 0))).toBe(true);
    const on = applyRect(new Set(), grid, { day: 0, row: 0 }, { day: 0, row: 3 }, true, now);
    expect([...on].sort()).toEqual([at(0, 2), at(0, 3)].sort());
  });

  it("하루 토글: 일부 선택 → 전체, 전체 → 해제 (TIME-09-01)", () => {
    const partial = new Set([at(1, 0)]);
    const all = toggleDay(partial, grid, 1, early);
    expect(editableDaySlots(grid, 1, early).every((s) => all.has(s))).toBe(true);
    const none = toggleDay(all, grid, 1, early);
    expect(editableDaySlots(grid, 1, early).some((s) => none.has(s))).toBe(false);
  });

  it("하루 토글은 지난 칸을 건드리지 않는다", () => {
    const now = at(0, 1);
    const base = new Set([at(0, 0)]);
    const all = toggleDay(base, grid, 0, now);
    expect([...all].sort()).toEqual([at(0, 0), at(0, 2), at(0, 3)].sort());
    const none = toggleDay(all, grid, 0, now);
    expect([...none]).toEqual([at(0, 0)]);
  });

  it("하루 토글로 켤 때 꺼진 지난 칸은 켜지지 않는다", () => {
    const now = at(0, 1); // 09:00·09:30 지남
    const on = toggleDay(new Set(), grid, 0, now);
    expect(on.has(at(0, 0))).toBe(false);
    expect(on.has(at(0, 1))).toBe(false);
    expect([...on].sort()).toEqual([at(0, 2), at(0, 3)].sort());
  });

  it("'전체 켜짐'은 바꿀 수 있는 칸 기준: 지난 칸이 꺼져 있어도 나머지가 모두 켜졌으면 해제한다", () => {
    const now = at(0, 1);
    const base = new Set([at(0, 2), at(0, 3)]); // 지난 09:00·09:30은 꺼짐
    const off = toggleDay(base, grid, 0, now);
    expect(off.size).toBe(0);
  });

  it("'전체 켜짐'은 바꿀 수 있는 칸 기준: 지난 칸이 켜져 있어도 나머지 일부가 꺼졌으면 켠다", () => {
    const now = at(0, 1);
    const base = new Set([at(0, 0), at(0, 1), at(0, 2)]); // 지난 칸 모두 켜짐, 10:30 꺼짐
    const on = toggleDay(base, grid, 0, now);
    expect([...on].sort()).toEqual([at(0, 0), at(0, 1), at(0, 2), at(0, 3)].sort());
  });

  it("하루 토글은 다른 날의 칸을 건드리지 않는다", () => {
    const base = new Set([at(1, 0), at(2, 3)]);
    const on = toggleDay(base, grid, 0, early);
    expect(on.has(at(1, 0)) && on.has(at(2, 3))).toBe(true);
    const off = toggleDay(on, grid, 0, early);
    expect([...off].sort()).toEqual([at(1, 0), at(2, 3)].sort());
  });

  it("모두 지난 날은 토글해도 그대로", () => {
    const now = at(2, 3);
    expect(editableDaySlots(grid, 0, now)).toEqual([]);
    expect(toggleDay(new Set(), grid, 0, now).size).toBe(0);
  });

  it("한 칸 토글", () => {
    const one = toggleSlot(new Set(), at(0, 0));
    expect(one.has(at(0, 0))).toBe(true);
    expect(toggleSlot(one, at(0, 0)).size).toBe(0);
  });
});
