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

// 033 휴대폰 드래그 선택 (R-38): 포인터를 누른 순간 어떤 드래그를 시작할지
// 마우스 왼쪽 버튼은 늘 드래그, 손가락은 선택 모드에서만(꺼져 있으면 끌어서 스크롤, 누르면 click으로 한 칸).
// 펜은 지금처럼 칸 하나 토글
export type DragInput = "mouse" | "touch" | null;

export function dragInput(
  event: { pointerType: string; button: number },
  selectMode: boolean,
): DragInput {
  if (event.pointerType === "mouse") return event.button === 0 ? "mouse" : null;
  if (event.pointerType === "touch" && selectMode) return "touch";
  return null;
}

// 손가락 좌표의 칸. 터치는 처음 누른 칸이 포인터를 붙잡아 다른 칸의 pointerenter가 오지 않으므로
// 누른 칸의 화면 위치·크기를 기준으로 좌표에서 칸을 계산한다(칸은 모두 같은 폭·높이 — grid-frame.tsx).
// 그리드 밖으로 나가면 가장자리 칸으로 고정한다(마우스는 그리드 밖에서 마지막 칸이 유지되는 것과 같은 결과)
export type CellBox = { pos: CellPos; left: number; top: number; width: number; height: number };

export function cellAtPoint(
  box: CellBox,
  size: { days: number; rows: number },
  x: number,
  y: number,
): CellPos {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max - 1);
  return {
    day: clamp(box.pos.day + Math.floor((x - box.left) / box.width), size.days),
    row: clamp(box.pos.row + Math.floor((y - box.top) / box.height), size.rows),
  };
}
