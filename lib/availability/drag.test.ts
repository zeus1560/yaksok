import { describe, expect, it, vi } from "vitest";
import { applyRect, buildGrid, cellMs } from "./grid";
import { cellAtPoint, createDragTracker, dragInput } from "./drag";

const at = (row: number) => ({ day: 2, row });

describe("createDragTracker", () => {
  it("마지막 칸에 들어간 직후 끝내도(화면 반영 전) 그 칸까지 돌려준다", () => {
    // onChange를 화면에 반영하지 않는 것으로 렌더가 밀린 상황을 흉내 낸다
    const tracker = createDragTracker(() => {});
    tracker.start(at(8), true);
    tracker.move(at(9));
    tracker.move(at(10));
    expect(tracker.end()).toEqual({ anchor: at(8), current: at(10), mode: true });
  });

  it("누르자마자 놓으면 누른 칸 하나", () => {
    const tracker = createDragTracker(() => {});
    tracker.start(at(8), false);
    expect(tracker.end()).toEqual({ anchor: at(8), current: at(8), mode: false });
  });

  it("끝난 뒤에는 null — pointerup 뒤 blur가 와도 한 번만 확정", () => {
    const tracker = createDragTracker(() => {});
    tracker.start(at(8), true);
    expect(tracker.end()).not.toBeNull();
    expect(tracker.end()).toBeNull();
  });

  it("드래그 중이 아니면 칸 이동을 무시한다", () => {
    const onChange = vi.fn();
    const tracker = createDragTracker(onChange);
    tracker.move(at(9));
    expect(onChange).not.toHaveBeenCalled();
    expect(tracker.end()).toBeNull();
  });

  it("화면에는 바뀔 때만 알린다 — 같은 칸 이동은 알리지 않고 끝나면 null", () => {
    const onChange = vi.fn();
    const tracker = createDragTracker(onChange);
    tracker.start(at(8), true);
    tracker.move(at(8));
    tracker.move(at(9));
    tracker.end();
    expect(onChange.mock.calls).toEqual([
      [{ anchor: at(8), current: at(8), mode: true }],
      [{ anchor: at(8), current: at(9), mode: true }],
      [null],
    ]);
  });
});

// 033 휴대폰 드래그 선택. 4일 × 16칸(14:00~22:00) 그리드, 칸 120×30px
const GRID = buildGrid({
  dateRangeStart: "2026-11-20",
  dateRangeEnd: "2026-11-23",
  dailyStartTime: "14:00",
  dailyEndTime: "22:00",
});
const SIZE = { days: GRID.days.length, rows: GRID.rows.length };

describe("휴대폰 선택 모드 (033)", () => {
  it("선택 모드가 켜지면 손가락 위치의 칸까지 사각형으로 선택된다", () => {
    // 두 번째 날 18:00(행 8) 칸을 눌렀다. 그 칸의 화면 위치는 (200, 300)부터 120×30
    const box = { pos: { day: 1, row: 8 }, left: 200, top: 300, width: 120, height: 30 };
    const tracker = createDragTracker(() => {});
    tracker.start(box.pos, true);
    // 손가락이 오른쪽 한 칸, 아래 두 칸 칸의 가운데로 움직였다
    tracker.move(cellAtPoint(box, SIZE, 200 + 120 + 60, 300 + 60 + 15));
    const drag = tracker.end()!;
    const selected = applyRect(new Set(), GRID, drag.anchor, drag.current, drag.mode, 0);
    expect([...selected].sort()).toEqual(
      [
        { day: 1, row: 8 },
        { day: 1, row: 9 },
        { day: 1, row: 10 },
        { day: 2, row: 8 },
        { day: 2, row: 9 },
        { day: 2, row: 10 },
      ]
        .map((pos) => cellMs(GRID, pos))
        .sort(),
    );
    // 선택 모드에서 손가락으로 누르면 터치 드래그가 시작된다
    expect(dragInput({ pointerType: "touch", button: 0 }, true)).toBe("touch");
  });

  it("선택 모드가 꺼져 있으면 터치로 끌어도 드래그가 시작되지 않는다 (켜면 시작, 마우스는 그대로)", () => {
    expect([
      dragInput({ pointerType: "touch", button: 0 }, false),
      dragInput({ pointerType: "touch", button: 0 }, true),
      dragInput({ pointerType: "mouse", button: 0 }, false),
      dragInput({ pointerType: "mouse", button: 2 }, false),
      dragInput({ pointerType: "pen", button: 0 }, true),
    ]).toEqual([null, "touch", "mouse", null, null]);
  });

  describe("cellAtPoint (손가락 좌표 → 칸)", () => {
    const box = { pos: { day: 1, row: 8 }, left: 200, top: 300, width: 120, height: 30 };

    it("누른 칸 안이면 그 칸, 경계에 닿으면 다음 칸", () => {
      expect(cellAtPoint(box, SIZE, 200, 300)).toEqual({ day: 1, row: 8 });
      expect(cellAtPoint(box, SIZE, 319.9, 329.9)).toEqual({ day: 1, row: 8 });
      expect(cellAtPoint(box, SIZE, 320, 330)).toEqual({ day: 2, row: 9 });
    });

    it("왼쪽·위로 끌면 앞 칸", () => {
      expect(cellAtPoint(box, SIZE, 199, 299)).toEqual({ day: 0, row: 7 });
      expect(cellAtPoint(box, SIZE, 200 - 120, 300 - 30 * 3)).toEqual({ day: 0, row: 5 });
    });

    it("그리드 밖으로 나가면 가장자리 칸으로 고정", () => {
      expect(cellAtPoint(box, SIZE, -500, -500)).toEqual({ day: 0, row: 0 });
      expect(cellAtPoint(box, SIZE, 5000, 5000)).toEqual({ day: 3, row: 15 });
    });
  });
});
