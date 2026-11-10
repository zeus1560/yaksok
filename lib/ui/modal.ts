// 공통 확인 창(모달)의 키보드·바깥 클릭 판단 (029, Figma Dialogs). 브라우저에서도 import한다
// - 요청 중(busy)에는 Esc·바깥 클릭으로 닫지 않는다. 요청 결과를 받기 전에 창이 사라지면 결과를 보여 줄 곳이 없다
// - Tab은 창 안에서만 돈다(포커스 가두기). 처음·끝에서만 직접 옮기고 중간은 브라우저 기본 이동에 맡긴다

export type ModalKeyAction =
  { kind: "close" } | { kind: "focus"; index: number } | { kind: "none" };

export function modalKeyAction(input: {
  key: string;
  shiftKey: boolean;
  busy: boolean;
  focusIndex: number; // 창 안 누를 수 있는 요소 중 지금 포커스의 위치. 창 밖이면 -1
  focusableCount: number;
}): ModalKeyAction {
  const { key, shiftKey, busy, focusIndex, focusableCount } = input;
  if (key === "Escape") return busy ? { kind: "none" } : { kind: "close" };
  if (key !== "Tab") return { kind: "none" };
  // 요청 중이라 모든 버튼이 막혔으면 창(-1 = 창 자체)에 머문다
  if (focusableCount === 0) return { kind: "focus", index: -1 };
  const last = focusableCount - 1;
  if (shiftKey) {
    return focusIndex <= 0 ? { kind: "focus", index: last } : { kind: "none" };
  }
  return focusIndex === -1 || focusIndex >= last ? { kind: "focus", index: 0 } : { kind: "none" };
}

// 바깥(덮개)을 눌렀다 바깥에서 뗐을 때만 닫는다. 창 안에서 글자를 끌다 바깥에서 뗀 경우는 닫지 않는다
export function shouldCloseOnBackdrop(input: {
  busy: boolean;
  pressedOnBackdrop: boolean;
  releasedOnBackdrop: boolean;
}): boolean {
  return !input.busy && input.pressedOnBackdrop && input.releasedOnBackdrop;
}
