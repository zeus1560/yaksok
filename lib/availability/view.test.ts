import { describe, expect, it } from "vitest";
import { applyRect, buildGrid, cellMs, toggleDay } from "./grid";
import { cellAtPoint, createDragTracker } from "./drag";
import {
  AUTO_SCROLL_MAX,
  autoScrollSpeed,
  dayPage,
  groupMode,
  groupRangeLabel,
  groupRows,
  groupState,
  groupStateText,
  type GroupState,
  initialPage,
  pageCount,
  parseUnit,
  pressGroup,
  restoreDay,
  toSlotRect,
} from "./view";

// 034 휴대폰 그리드 보기. 하루 10:00~14:00(30분 8칸) × 2일
const GRID = buildGrid({
  dateRangeStart: "2026-11-17",
  dateRangeEnd: "2026-11-18",
  dailyStartTime: "10:00",
  dailyEndTime: "14:00",
});
const ms = (day: number, row: number) => cellMs(GRID, { day, row });
const TWO_HOURS = { start: 0, end: 3 }; // 10:00–12:00 = 30분 칸 4개

describe("2시간 묶음 (034)", () => {
  it("2시간 보기에서 일부 선택된 묶음은 n/m을 내고 지난 칸은 m에서 뺀다", () => {
    // 지금 = 11/17 10:30 → 10:00·10:30 칸이 지났다. 지난 10:00(선택됨)은 세지 않는다
    const now = ms(0, 1);
    const selection = new Set([ms(0, 0), ms(0, 2)]);
    expect(groupState(selection, GRID, 0, TWO_HOURS, now)).toEqual({
      kind: "some",
      selected: 1,
      total: 2,
    });
  });

  it("일부 선택 묶음을 누르면 지나지 않은 칸이 모두 선택된다", () => {
    const now = ms(0, 0); // 10:00 칸만 지났다
    const selection = new Set([ms(0, 2), ms(1, 0)]);
    const next = pressGroup(selection, GRID, 0, TWO_HOURS, now);
    expect([...next].sort()).toEqual([ms(0, 1), ms(0, 2), ms(0, 3), ms(1, 0)].sort());
  });

  it("상태: 전부·없음·전부 지남. 전부 선택은 지나지 않은 칸 기준", () => {
    const now = ms(0, 0);
    const all = new Set([ms(0, 1), ms(0, 2), ms(0, 3)]); // 지난 10:00은 선택하지 않았어도 '전부'
    expect(groupState(all, GRID, 0, TWO_HOURS, now)).toEqual({
      kind: "all",
      selected: 3,
      total: 3,
    });
    expect(groupState(new Set(), GRID, 0, TWO_HOURS, now)).toEqual({
      kind: "none",
      selected: 0,
      total: 3,
    });
    expect(groupState(new Set([ms(0, 0)]), GRID, 0, TWO_HOURS, ms(0, 3))).toEqual({
      kind: "past",
      selected: 0,
      total: 0,
    });
  });

  it("전부 선택된 묶음을 누르면 안의 칸이 전부 해제되고 지난 칸·다른 칸은 그대로", () => {
    const now = ms(0, 0);
    const selection = new Set([ms(0, 0), ms(0, 1), ms(0, 2), ms(0, 3), ms(0, 4)]);
    const next = pressGroup(selection, GRID, 0, TWO_HOURS, now);
    expect([...next].sort()).toEqual([ms(0, 0), ms(0, 4)].sort());
  });

  it("전부 지난 묶음을 눌러도 아무것도 바뀌지 않는다", () => {
    const selection = new Set([ms(0, 1)]);
    const next = pressGroup(selection, GRID, 0, TWO_HOURS, ms(0, 3));
    expect([...next]).toEqual([ms(0, 1)]);
  });

  it("누름 상태는 첫 칸의 반대: 전부 선택이면 해제, 일부·없음이면 선택", () => {
    expect(groupMode({ kind: "all", selected: 2, total: 2 })).toBe(false);
    expect(groupMode({ kind: "some", selected: 1, total: 2 })).toBe(true);
    expect(groupMode({ kind: "none", selected: 0, total: 2 })).toBe(true);
  });
});

describe("묶음 나누기 (034)", () => {
  it("하루 시작 시각부터 끊고 끝에 남는 칸은 짧은 묶음", () => {
    // 09:00~24:00 = 30칸. 2시간(4칸) → 7개 + 23:00–24:00(2칸)
    const rows = groupRows(30, 4);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual({ start: 0, end: 3 });
    expect(rows[7]).toEqual({ start: 28, end: 29 });
    expect(groupRows(3, 2)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 2 },
    ]);
    expect(groupRows(3, 1)).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ]);
  });

  it("묶은 칸 이름: 시각 범위(마지막 묶음 24:00)와 상태 문구", () => {
    const late = buildGrid({
      dateRangeStart: "2026-11-17",
      dateRangeEnd: "2026-11-17",
      dailyStartTime: "21:00",
      dailyEndTime: "24:00",
    });
    const groups = groupRows(late.rows.length, 4);
    expect(groups.map((g) => groupRangeLabel(late, g))).toEqual(["21:00–23:00", "23:00–24:00"]);
    expect(
      [
        { kind: "some", selected: 2, total: 4 },
        { kind: "all", selected: 4, total: 4 },
        { kind: "none", selected: 0, total: 3 },
        { kind: "past", selected: 0, total: 0 },
      ].map((s) => groupStateText(s as GroupState)),
    ).toEqual(["4칸 중 2칸 선택", "4칸 모두 선택", "3칸, 선택 없음", "지난 시간"]);
  });

  it("단위 저장값 읽기: 모르는 값은 30분", () => {
    expect([
      parseUnit("1"),
      parseUnit("2"),
      parseUnit("4"),
      parseUnit(null),
      parseUnit("8"),
    ]).toEqual([1, 2, 4, 1, 1]);
  });

  it("묶은 칸 드래그 사각형 → 30분 칸 사각형(위로 끌어도, 구간 날짜 위치 보정)", () => {
    const groups = groupRows(8, 4);
    expect(toSlotRect(groups, 4, { day: 1, row: 1 }, { day: 0, row: 0 })).toEqual({
      anchor: { day: 5, row: 0 },
      current: { day: 4, row: 7 },
    });
  });

  it("묶은 칸 단위로 손가락을 끌면 applyRect가 30분 칸 사각형을 첫 칸의 반대 상태로 바꾼다", () => {
    // 2시간 묶음 2개 × 2일. 첫 날 첫 묶음(120×48px)을 누르고 둘째 날 둘째 묶음까지 끌었다
    const groups = groupRows(GRID.rows.length, 4);
    const box = { pos: { day: 0, row: 0 }, left: 50, top: 100, width: 70, height: 48 };
    const tracker = createDragTracker(() => {});
    tracker.start(box.pos, true);
    tracker.move(cellAtPoint(box, { days: 2, rows: groups.length }, 50 + 70 + 10, 100 + 48 + 10));
    const drag = tracker.end()!;
    const rect = toSlotRect(groups, 0, drag.anchor, drag.current);
    const next = applyRect(new Set(), GRID, rect.anchor, rect.current, drag.mode, 0);
    expect(next.size).toBe(16);
  });
});

describe("날짜 4일씩 넘기기 (034)", () => {
  const WEEK = buildGrid({
    dateRangeStart: "2026-11-16",
    dateRangeEnd: "2026-11-25", // 10일 → 4·4·2
    dailyStartTime: "09:00",
    dailyEndTime: "12:00",
  });
  const at = (day: number, row = 0) => cellMs(WEEK, { day, row });

  it("첫날부터 4일씩 끊고 마지막은 남은 날", () => {
    expect(pageCount(10)).toBe(3);
    expect([0, 1, 2].map((p) => dayPage(10, p))).toEqual([
      { start: 0, count: 4 },
      { start: 4, count: 4 },
      { start: 8, count: 2 },
    ]);
    expect(pageCount(3)).toBe(1);
    expect(dayPage(3, 0)).toEqual({ start: 0, count: 3 });
  });

  it("범위 밖 구간은 첫·마지막 구간으로 고정(날짜가 줄어든 경우)", () => {
    expect(dayPage(10, 7)).toEqual({ start: 8, count: 2 });
    expect(dayPage(5, -1)).toEqual({ start: 0, count: 4 });
  });

  it("처음 구간 = 지나지 않은 첫 날이 들어 있는 구간", () => {
    expect(initialPage(WEEK, at(0) - 1)).toBe(0); // 아직 시작 전
    expect(initialPage(WEEK, at(5, 2))).toBe(1); // 6일째(11/21) 10:00 — 그날 10:30부터 남음
    // 4일째(11/19) 마지막 칸까지 지났으면 다음 날(11/20)이 있는 둘째 구간
    expect(initialPage(WEEK, at(3, WEEK.rows.length - 1))).toBe(1);
    expect(initialPage(WEEK, at(9, WEEK.rows.length - 1))).toBe(2); // 모두 지남 → 마지막 구간
  });
});

describe("자동 스크롤 속도 (034)", () => {
  // 보이는 영역 0~700px(아래 고정 제출 바 위)
  it("끝에서 48px 밖이면 0", () => {
    expect(autoScrollSpeed(48, 0, 700)).toBe(0);
    expect(autoScrollSpeed(350, 0, 700)).toBe(0);
    expect(autoScrollSpeed(652, 0, 700)).toBe(0);
  });

  it("끝에 가까울수록 빠르고, 위는 음수·아래는 양수, 끝을 넘으면 최대", () => {
    const down = [660, 680, 699, 800].map((y) => autoScrollSpeed(y, 0, 700));
    expect(down.every((v, i) => i === 0 || v >= down[i - 1])).toBe(true);
    expect(down[0]).toBeGreaterThan(0);
    expect(down[3]).toBe(AUTO_SCROLL_MAX);
    expect(autoScrollSpeed(10, 0, 700)).toBeLessThan(0);
    expect(autoScrollSpeed(-30, 0, 700)).toBe(-AUTO_SCROLL_MAX);
    expect(autoScrollSpeed(47, 0, 700)).toBe(-2); // 경계 바로 안은 최소 속도
  });
});

describe("하루 토글 되돌리기 (034)", () => {
  it("그날의 지나지 않은 칸만 직전 상태로, 다른 날·지난 칸은 지금 그대로", () => {
    const now = ms(0, 0);
    const before = new Set([ms(0, 0), ms(0, 2), ms(1, 5)]);
    const toggled = toggleDay(before, GRID, 0, now); // 첫 날 전체 선택
    const later = new Set([...toggled, ms(1, 1)]); // 그 뒤 다른 날을 하나 더 골랐다
    const restored = restoreDay(later, GRID, 0, before, now);
    expect([...restored].sort()).toEqual([ms(0, 0), ms(0, 2), ms(1, 1), ms(1, 5)].sort());
  });
});
