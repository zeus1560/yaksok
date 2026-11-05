import { describe, expect, it } from "vitest";
import {
  SETUP_WINDOW_MS,
  createSetupRecord,
  formatCountdown,
  isUrgent,
  parseSetupRecord,
  remainingMs,
  setupStorageKey,
} from "@/lib/create-promise/countdown";

const PROMISE_ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";

describe("카운트다운", () => {
  it("남은 시간과 0 이하 처리", () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    expect(remainingMs(10_000, 10_000)).toBe(0);
    expect(remainingMs(10_000, 12_000)).toBe(0);
  });

  it("m:ss 표기, 초는 올림", () => {
    expect(formatCountdown(SETUP_WINDOW_MS)).toBe("10:00");
    expect(formatCountdown(581_000)).toBe("9:41");
    expect(formatCountdown(580_001)).toBe("9:41");
    expect(formatCountdown(59_000)).toBe("0:59");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });

  it("1분 이하이면 강조", () => {
    expect(isUrgent(60_001)).toBe(false);
    expect(isUrgent(60_000)).toBe(true);
    expect(isUrgent(0)).toBe(true);
  });
});

describe("설정 진행 정보 저장", () => {
  it("토큰별 키", () => {
    expect(setupStorageKey("abc")).toBe("yaksok:setup:abc");
  });

  it("받은 순간 기기 시각 + 10분", () => {
    expect(createSetupRecord(PROMISE_ID, 1_000)).toEqual({
      promiseId: PROMISE_ID,
      localExpiresAt: 1_000 + SETUP_WINDOW_MS,
    });
  });

  it("시한이 남은 값만 복원한다", () => {
    const raw = JSON.stringify(createSetupRecord(PROMISE_ID, 1_000));
    expect(parseSetupRecord(raw, 2_000)?.promiseId).toBe(PROMISE_ID);
    expect(parseSetupRecord(raw, 1_000 + SETUP_WINDOW_MS)).toBeNull();
  });

  it("잘못된 값·형식은 무시한다", () => {
    expect(parseSetupRecord(null, 0)).toBeNull();
    expect(parseSetupRecord("{", 0)).toBeNull();
    expect(parseSetupRecord("null", 0)).toBeNull();
    expect(parseSetupRecord(JSON.stringify({ promiseId: "x", localExpiresAt: 100 }), 0)).toBeNull();
    expect(parseSetupRecord(JSON.stringify({ promiseId: PROMISE_ID }), 0)).toBeNull();
  });

  it("10분보다 많이 남은 값(기기 시계 변경)은 믿지 않는다", () => {
    const raw = JSON.stringify({ promiseId: PROMISE_ID, localExpiresAt: SETUP_WINDOW_MS + 1 });
    expect(parseSetupRecord(raw, 0)).toBeNull();
  });
});
