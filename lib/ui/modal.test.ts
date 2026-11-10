import { describe, expect, it } from "vitest";
import { modalKeyAction, shouldCloseOnBackdrop } from "./modal";

const key = (key: string, extra: Partial<Parameters<typeof modalKeyAction>[0]> = {}) =>
  modalKeyAction({ key, shiftKey: false, busy: false, focusIndex: 0, focusableCount: 3, ...extra });

describe("modalKeyAction", () => {
  it("모달은 요청 중 Esc로 닫히지 않는다", () => {
    expect(key("Escape", { busy: true })).toEqual({ kind: "none" });
  });

  it("요청 중이 아니면 Esc로 닫힌다", () => {
    expect(key("Escape")).toEqual({ kind: "close" });
  });

  it("Tab은 마지막 요소에서 첫 요소로 돌아간다", () => {
    expect(key("Tab", { focusIndex: 2 })).toEqual({ kind: "focus", index: 0 });
  });

  it("Shift+Tab은 첫 요소에서 마지막 요소로 간다", () => {
    expect(key("Tab", { shiftKey: true, focusIndex: 0 })).toEqual({ kind: "focus", index: 2 });
  });

  it("포커스가 창 밖(-1)이면 Tab은 첫 요소, Shift+Tab은 마지막 요소로 간다", () => {
    expect(key("Tab", { focusIndex: -1 })).toEqual({ kind: "focus", index: 0 });
    expect(key("Tab", { shiftKey: true, focusIndex: -1 })).toEqual({ kind: "focus", index: 2 });
  });

  it("중간 요소의 Tab은 브라우저 기본 이동에 맡긴다", () => {
    expect(key("Tab", { focusIndex: 1 })).toEqual({ kind: "none" });
    expect(key("Tab", { shiftKey: true, focusIndex: 1 })).toEqual({ kind: "none" });
  });

  it("요청 중이라 누를 수 있는 요소가 없으면 Tab은 창 안에 머문다", () => {
    expect(key("Tab", { busy: true, focusableCount: 0, focusIndex: -1 })).toEqual({
      kind: "focus",
      index: -1,
    });
  });

  it("다른 키는 처리하지 않는다", () => {
    expect(key("Enter")).toEqual({ kind: "none" });
  });
});

describe("shouldCloseOnBackdrop", () => {
  it("바깥을 눌렀다 바깥에서 떼면 닫힌다", () => {
    expect(
      shouldCloseOnBackdrop({ busy: false, pressedOnBackdrop: true, releasedOnBackdrop: true }),
    ).toBe(true);
  });

  it("요청 중에는 바깥 클릭으로 닫히지 않는다", () => {
    expect(
      shouldCloseOnBackdrop({ busy: true, pressedOnBackdrop: true, releasedOnBackdrop: true }),
    ).toBe(false);
  });

  it("창 안에서 누르고 바깥에서 떼면(글자 끌기) 닫지 않는다", () => {
    expect(
      shouldCloseOnBackdrop({ busy: false, pressedOnBackdrop: false, releasedOnBackdrop: true }),
    ).toBe(false);
  });
});
