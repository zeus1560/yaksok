import { describe, expect, it } from "vitest";
import { RATE_LIMITED_MESSAGE, loginLockedMessage, retryAfterSecondsOf } from "./notice";

describe("429 안내 (R-41)", () => {
  it("남은 시간은 분으로 올림(1초도 1분), 값이 없으면 잠시 뒤에", () => {
    expect(loginLockedMessage(900)).toBe(
      "PIN을 여러 번 틀려 잠시 막혔어요. 15분 뒤에 다시 시도해 주세요.",
    );
    expect(loginLockedMessage(841)).toContain("15분 뒤에");
    expect(loginLockedMessage(1)).toContain("1분 뒤에");
    // 하루 상한(24시간 잠금)은 시간으로
    expect(loginLockedMessage(3600)).toContain("60분 뒤에");
    expect(loginLockedMessage(3601)).toContain("2시간 뒤에");
    expect(loginLockedMessage(86400)).toContain("24시간 뒤에");
    expect(loginLockedMessage(null)).toBe(
      "PIN을 여러 번 틀려 잠시 막혔어요. 잠시 뒤에 다시 시도해 주세요.",
    );
  });

  it("남은 시도 횟수 같은 숫자 힌트는 문구에 없다(시간만)", () => {
    expect(loginLockedMessage(900).match(/\d+/g)).toEqual(["15"]);
  });

  it("details.retryAfterSeconds만 양의 숫자로 읽는다", () => {
    expect(retryAfterSecondsOf({ retryAfterSeconds: 120 })).toBe(120);
    for (const bad of [undefined, null, {}, { retryAfterSeconds: "120" }, { retryAfterSeconds: 0 }])
      expect(retryAfterSecondsOf(bad)).toBeNull();
  });

  it("요청 수 초과 문구", () => {
    expect(RATE_LIMITED_MESSAGE).toBe("요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
  });
});
