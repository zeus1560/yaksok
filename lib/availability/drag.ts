import type { CellPos } from "./grid";

// 마우스 드래그 상태 (TIME-10-04, fix 002)
// 놓기는 화면 렌더와 관계없이 마지막으로 들어간 칸까지 반영해야 한다. React 상태와 그 상태를 붙든 리스너는
// 렌더·효과가 끝나야 바뀌므로, 마지막 칸에 들어간 직후 놓으면 앞 칸 기준으로 확정됐다(WebKit 0ms 놓기)
// 그래서 드래그 상태는 이 객체가 이벤트마다 즉시 바꾸고, 화면은 onChange로 받은 값을 그리기만 한다

export type Drag = { anchor: CellPos; current: CellPos; mode: boolean };

export type DragTracker = {
  start(anchor: CellPos, mode: boolean): void;
  // 드래그 중이 아니거나 같은 칸이면 아무것도 하지 않는다
  move(pos: CellPos): void;
  // 끝난 드래그를 돌려준다. 이미 끝났으면 null — pointerup 뒤 blur처럼 여러 번 불려도 한 번만 확정한다
  end(): Drag | null;
};

export function createDragTracker(onChange: (drag: Drag | null) => void): DragTracker {
  let drag: Drag | null = null;
  return {
    start(anchor, mode) {
      drag = { anchor, current: anchor, mode };
      onChange(drag);
    },
    move(pos) {
      if (!drag || (drag.current.day === pos.day && drag.current.row === pos.row)) return;
      drag = { ...drag, current: pos };
      onChange(drag);
    },
    end() {
      const last = drag;
      if (!last) return null;
      drag = null;
      onChange(null);
      return last;
    },
  };
}
