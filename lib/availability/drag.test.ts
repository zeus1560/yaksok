import { describe, expect, it, vi } from "vitest";
import { createDragTracker } from "./drag";

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
