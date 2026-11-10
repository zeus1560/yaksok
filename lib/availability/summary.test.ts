import { describe, expect, it } from "vitest";
import { formatSelectionSummary, selectionSummary } from "./summary";

const at = (iso: string) => Date.parse(iso);

describe("selectionSummary", () => {
  it("한국 날짜 수와 30분 칸의 총 시간을 센다", () => {
    const slots = [
      at("2026-11-12T18:00:00+09:00"),
      at("2026-11-12T18:30:00+09:00"),
      at("2026-11-12T19:00:00+09:00"),
      at("2026-11-14T19:00:00+09:00"),
    ];
    expect(selectionSummary(slots)).toEqual({ days: 2, minutes: 120, slots: 4 });
  });

  it("한국 날짜 경계: 00:00(+09:00)은 UTC로 전날이어도 그날로 센다", () => {
    expect(
      selectionSummary([at("2026-11-13T00:00:00+09:00"), at("2026-11-12T23:30:00+09:00")]).days,
    ).toBe(2);
  });

  it("같은 칸은 한 번만 센다", () => {
    const ms = at("2026-11-12T18:00:00+09:00");
    expect(selectionSummary([ms, ms]).slots).toBe(1);
  });
});

describe("formatSelectionSummary", () => {
  it("Figma 아래 바 문구로 보인다", () => {
    const slots = Array.from(
      { length: 11 },
      (_, i) => at("2026-11-12T14:00:00+09:00") + i * 30 * 60e3,
    );
    expect(formatSelectionSummary(slots)).toBe("1일 · 총 5시간 30분 선택");
  });

  it("고른 칸이 없으면 선택 전 문구", () => {
    expect(formatSelectionSummary([])).toBe("아직 선택한 시간이 없어요");
  });
});
