import { describe, expect, it } from "vitest";
import {
  appendCandidates,
  formatSeoulRange,
  inviteUrl,
  isAvailableThroughout,
  type CandidateItem,
} from "./format";

describe("formatSeoulRange", () => {
  it("한국 날짜·시각으로 표기한다 (기기 시간대 무관)", () => {
    expect(formatSeoulRange("2026-11-10T14:00:00+09:00", "2026-11-10T16:00:00+09:00")).toEqual({
      date: "11월 10일 (화)",
      time: "14:00 – 16:00",
    });
  });
  it("UTC 표기로 와도 한국 날짜로 읽는다 (UTC로는 전날)", () => {
    expect(formatSeoulRange("2026-11-09T15:30:00Z", "2026-11-09T16:30:00Z")).toEqual({
      date: "11월 10일 (화)",
      time: "00:30 – 01:30",
    });
  });
  it("다음 날 00:00에 끝나면 24:00", () => {
    expect(formatSeoulRange("2026-11-10T23:00:00+09:00", "2026-11-11T00:00:00+09:00").time).toBe(
      "23:00 – 24:00",
    );
  });
  it("그 밖에 날짜를 넘으면 끝 날짜를 함께 적는다", () => {
    expect(formatSeoulRange("2026-11-10T23:00:00+09:00", "2026-11-11T01:00:00+09:00").time).toBe(
      "23:00 – 11월 11일 01:00",
    );
  });
  it("연말 경계", () => {
    expect(formatSeoulRange("2026-12-31T23:30:00+09:00", "2027-01-01T00:00:00+09:00")).toEqual({
      date: "12월 31일 (목)",
      time: "23:30 – 24:00",
    });
  });
});

const c = (startAt: string, count = 2): CandidateItem => ({
  startAt,
  endAt: startAt,
  availableParticipantCount: count,
});

describe("appendCandidates", () => {
  it("다음 페이지를 뒤에 붙인다", () => {
    const first = [c("2026-11-10T10:00:00+09:00", 3), c("2026-11-10T10:30:00+09:00", 3)];
    const next = [c("2026-11-11T10:00:00+09:00")];
    expect(appendCandidates(first, next)).toEqual([...first, ...next]);
  });
  it("같은 시작 시각은 표기가 달라도 한 번만 둔다", () => {
    const first = [c("2026-11-10T10:00:00+09:00", 3)];
    expect(appendCandidates(first, [c("2026-11-10T01:00:00Z", 2)])).toEqual(first);
  });
  it("겹치는 후보(시작이 다름)는 묶지 않는다 (RESULT-07-02 미결)", () => {
    const list = appendCandidates(
      [c("2026-11-10T10:00:00+09:00")],
      [c("2026-11-10T10:30:00+09:00"), c("2026-11-10T11:00:00+09:00")],
    );
    expect(list).toHaveLength(3);
  });
});

describe("isAvailableThroughout", () => {
  const s = (iso: string) => Date.parse(iso);
  const slots = [s("2026-11-10T14:00:00+09:00"), s("2026-11-10T14:30:00+09:00")];

  it("구간의 모든 30분 칸이 있으면 참석 가능", () => {
    expect(
      isAvailableThroughout(
        { submitted: true, slots },
        "2026-11-10T14:00:00+09:00",
        "2026-11-10T15:00:00+09:00",
      ),
    ).toBe(true);
  });
  it("한 칸이라도 빠지면 불참", () => {
    expect(
      isAvailableThroughout(
        { submitted: true, slots },
        "2026-11-10T14:00:00+09:00",
        "2026-11-10T15:30:00+09:00",
      ),
    ).toBe(false);
  });
  it("제출하지 않았으면 슬롯이 있어도 불참", () => {
    expect(
      isAvailableThroughout(
        { submitted: false, slots },
        "2026-11-10T14:00:00+09:00",
        "2026-11-10T15:00:00+09:00",
      ),
    ).toBe(false);
  });
  it("Z 표기 구간도 같은 시각으로 비교한다", () => {
    expect(
      isAvailableThroughout({ submitted: true, slots }, "2026-11-10T05:00:00Z", "2026-11-10T06:00:00Z"),
    ).toBe(true);
  });
  it("잘못된 구간은 불참", () => {
    expect(isAvailableThroughout({ submitted: true, slots }, "x", "y")).toBe(false);
    expect(
      isAvailableThroughout(
        { submitted: true, slots },
        "2026-11-10T15:00:00+09:00",
        "2026-11-10T14:00:00+09:00",
      ),
    ).toBe(false);
  });
});

describe("inviteUrl", () => {
  it("초대 링크 주소", () => {
    expect(inviteUrl("https://example.com", "abc_DEF-123")).toBe("https://example.com/p/abc_DEF-123");
  });
});
