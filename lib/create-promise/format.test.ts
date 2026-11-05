import { describe, expect, it } from "vitest";
import {
  formatDailyRange,
  formatDateRange,
  formatDeadline,
  formatDuration,
  formatSummaryTitle,
} from "@/lib/create-promise/format";

describe("요약 표기", () => {
  it("날짜 범위와 정원 요약 제목", () => {
    expect(formatSummaryTitle("2026-10-01", "2026-10-31", 4)).toBe("10.01–10.31 · 방장 포함 4명");
    expect(formatDateRange("2026-10-01", "2026-10-01")).toBe("10.01");
  });

  it("소요 시간·하루 범위·마감", () => {
    expect(formatDuration(120)).toBe("2시간");
    expect(formatDuration(90)).toBe("1시간 30분");
    expect(formatDuration(30)).toBe("30분");
    expect(formatDailyRange(540, 1440)).toBe("09:00–24:00");
    expect(formatDeadline("2026-10-31T23:59")).toBe("10.31 23:59");
    expect(formatDeadline("2026-10-31T23:59:00+09:00")).toBe("10.31 23:59");
  });
});
