import { describe, expect, it } from "vitest";
import {
  clampParticipantLimit,
  endAfterStartChange,
  endTimeOptions,
  fitDuration,
  startTimeOptions,
  stepDuration,
} from "@/lib/create-promise/time-options";

describe("시간 드롭다운 목록 (TIME-05-02, TIME-06-01)", () => {
  it("시작은 00:00~23:30, 30분 단위 48개", () => {
    const options = startTimeOptions();
    expect(options).toHaveLength(48);
    expect(options[0]).toBe(0);
    expect(options.at(-1)).toBe(1410);
    expect(options.every((m) => m % 30 === 0)).toBe(true);
  });

  it("종료는 시작보다 늦은 시각만, 24:00 포함", () => {
    const options = endTimeOptions(540);
    expect(options[0]).toBe(570);
    expect(options.at(-1)).toBe(1440);
    expect(options.every((m) => m > 540)).toBe(true);
  });

  it("시작 23:30이면 종료는 24:00 하나, 시작 00:00이면 00:30~24:00", () => {
    expect(endTimeOptions(1410)).toEqual([1440]);
    expect(endTimeOptions(0)).toHaveLength(48);
  });

  it("시작을 종료 이후로 바꾸면 종료를 24:00으로", () => {
    expect(endAfterStartChange(600, 1080)).toBe(1080);
    expect(endAfterStartChange(1080, 1080)).toBe(1440);
    expect(endAfterStartChange(1200, 1080)).toBe(1440);
  });
});

describe("소요 시간 보정 (TIME-06-02)", () => {
  it("범위 축소로 범위보다 길어지면 범위 길이로 줄인다", () => {
    expect(fitDuration(120, 540, 600)).toEqual({ duration: 60, shrunk: true });
  });

  it("범위 안이면 그대로", () => {
    expect(fitDuration(120, 540, 660)).toEqual({ duration: 120, shrunk: false });
    expect(fitDuration(120, 540, 1440)).toEqual({ duration: 120, shrunk: false });
  });

  it("−/+는 30분 단위, 30분 ~ 범위 길이", () => {
    expect(stepDuration(120, 30, 540, 1440)).toBe(150);
    expect(stepDuration(30, -30, 540, 1440)).toBe(30);
    expect(stepDuration(120, 30, 540, 660)).toBe(120);
    expect(stepDuration(900, 30, 540, 1440)).toBe(900);
  });
});

describe("정원 (C-02)", () => {
  it("2~30으로 제한한다", () => {
    expect(clampParticipantLimit(1)).toBe(2);
    expect(clampParticipantLimit(31)).toBe(30);
    expect(clampParticipantLimit(4.7)).toBe(4);
    expect(clampParticipantLimit(Number.NaN)).toBe(2);
  });
});
