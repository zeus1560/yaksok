import { describe, expect, it } from "vitest";
import { MIN_POLL_DELAY_MS, pollDelay } from "./poll-delay";

describe("pollDelay", () => {
  it("직전 요청 소요 시간만큼 줄여 요청 시작 간격을 5초로 맞춘다", () => {
    expect(pollDelay(780, 5000)).toBe(4220);
    expect(pollDelay(0, 5000)).toBe(5000);
  });
  it("직전 요청이 6초 걸렸으면 다음 간격은 최소 간격(1초) 이상 — 0 이하로 연달아 보내지 않는다", () => {
    const delay = pollDelay(6000, 5000);
    expect(delay).toBeGreaterThanOrEqual(MIN_POLL_DELAY_MS);
    expect(delay).toBe(1000);
  });
  it("직전 요청이 정확히 5초면 0이 아니라 최소 간격", () => {
    expect(pollDelay(5000, 5000)).toBe(MIN_POLL_DELAY_MS);
  });
  it("응답이 매우 느려도 최소 간격을 둔다", () => {
    expect(pollDelay(4800, 5000)).toBe(MIN_POLL_DELAY_MS);
    expect(pollDelay(9000, 5000)).toBe(MIN_POLL_DELAY_MS);
  });
  it("잘못된 측정값이면 기본 간격", () => {
    expect(pollDelay(Number.NaN, 5000)).toBe(5000);
    expect(pollDelay(-1, 5000)).toBe(5000);
  });
});
