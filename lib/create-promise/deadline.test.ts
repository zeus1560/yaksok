import { describe, expect, it } from "vitest";
import { defaultDeadline, resolveDeadline, toDeadlinePayload } from "@/lib/create-promise/deadline";

const at = (iso: string) => new Date(iso);

describe("마감 기본값 (TIME-13-02)", () => {
  const range = { start: "2026-11-10", end: "2026-11-20" };

  it("시작일 전날 23:59", () => {
    expect(defaultDeadline(range, at("2026-11-05T10:00:00+09:00"))).toBe("2026-11-09T23:59");
  });

  it("시작일 전날 23:59가 지났으면 종료일 전날 23:59", () => {
    const todayStart = { start: "2026-11-05", end: "2026-11-20" };
    expect(defaultDeadline(todayStart, at("2026-11-05T10:00:00+09:00"))).toBe("2026-11-19T23:59");
  });

  it("경계: 시작일 전날 23:59 정각이면 이미 지난 것으로 본다", () => {
    const tomorrowStart = { start: "2026-11-06", end: "2026-11-08" };
    expect(defaultDeadline(tomorrowStart, at("2026-11-05T23:58:59+09:00"))).toBe(
      "2026-11-05T23:59",
    );
    expect(defaultDeadline(tomorrowStart, at("2026-11-05T23:59:00+09:00"))).toBe(
      "2026-11-07T23:59",
    );
  });

  it("오늘 시작·내일 종료면 오늘 23:59", () => {
    const r = { start: "2026-11-05", end: "2026-11-06" };
    expect(defaultDeadline(r, at("2026-11-05T22:00:00+09:00"))).toBe("2026-11-05T23:59");
  });

  it("둘 다 지났거나 범위가 미완성이면 null", () => {
    const r = { start: "2026-11-05", end: "2026-11-06" };
    expect(defaultDeadline(r, at("2026-11-05T23:59:30+09:00"))).toBeNull();
    expect(
      defaultDeadline({ start: "2026-11-10", end: null }, at("2026-11-05T10:00:00+09:00")),
    ).toBeNull();
  });

  it("기기 시간대와 무관하게 한국 날짜 기준 (UTC 표기 입력)", () => {
    // 2026-11-05 15:30Z = 11-06 00:30 KST → 시작일 11-06의 전날 23:59는 이미 지남
    const r = { start: "2026-11-06", end: "2026-11-10" };
    expect(defaultDeadline(r, at("2026-11-05T15:30:00Z"))).toBe("2026-11-09T23:59");
  });
});

describe("resolveDeadline — 직접 수정 후 유지", () => {
  const now = at("2026-11-05T10:00:00+09:00");

  it("수정하지 않았으면 날짜 범위가 바뀔 때 다시 계산한다", () => {
    const a = resolveDeadline({
      range: { start: "2026-11-10", end: "2026-11-20" },
      now,
      current: null,
      touched: false,
    });
    const b = resolveDeadline({
      range: { start: "2026-11-15", end: "2026-11-20" },
      now,
      current: a,
      touched: false,
    });
    expect(a).toBe("2026-11-09T23:59");
    expect(b).toBe("2026-11-14T23:59");
  });

  it("직접 수정했으면 범위가 바뀌어도 그 값을 유지한다", () => {
    expect(
      resolveDeadline({
        range: { start: "2026-11-15", end: "2026-11-20" },
        now,
        current: "2026-11-08T18:00",
        touched: true,
      }),
    ).toBe("2026-11-08T18:00");
  });
});

describe("toDeadlinePayload", () => {
  it("+09:00 오프셋을 붙인다", () => {
    expect(toDeadlinePayload("2026-11-09T23:59")).toBe("2026-11-09T23:59:00+09:00");
  });

  it("형식이 다르면 null", () => {
    expect(toDeadlinePayload("")).toBeNull();
    expect(toDeadlinePayload("2026-11-09 23:59")).toBeNull();
  });
});
