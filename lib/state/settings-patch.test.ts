import { describe, expect, it } from "vitest";
import { applySettingsPatch, parseReopenSettings, parseSettingsPatch } from "./settings-patch";

const DEADLINE = "2026-11-09T18:00:00+09:00";

describe("parseSettingsPatch / parseReopenSettings", () => {
  it("마감만 보내면 마감만 담는다(생략한 필드는 유지)", () => {
    expect(parseReopenSettings({ votingDeadlineAt: DEADLINE })).toEqual({
      votingDeadlineAt: new Date(DEADLINE),
    });
  });

  it("모든 필드를 STATE-API-02와 같은 형식으로 읽는다(24:00 → 1440)", () => {
    expect(
      parseReopenSettings({
        votingDeadlineAt: "2026-11-09T09:00:00Z",
        participantLimit: 10,
        dateRange: { startDate: "2026-11-10", endDate: "2026-11-20" },
        dailyTimeRange: { startTime: "18:00", endTime: "24:00" },
        durationMinutes: 90,
        unknown: "무시",
      }),
    ).toEqual({
      votingDeadlineAt: new Date("2026-11-09T18:00:00+09:00"),
      participantLimit: 10,
      dateRange: { startDate: "2026-11-10", endDate: "2026-11-20" },
      dailyTimeRange: { startMinute: 1080, endMinute: 1440 },
      durationMinutes: 90,
    });
  });

  it("재조율은 마감이 없으면 400", () => {
    expect(parseReopenSettings({ participantLimit: 5 })).toBeNull();
    expect(parseReopenSettings({})).toBeNull();
    expect(parseSettingsPatch({})).toEqual({});
  });

  it.each([
    ["본문이 배열", []],
    ["본문이 null", null],
    ["마감 오프셋 없음", { votingDeadlineAt: "2026-11-09T18:00:00" }],
    ["마감 null", { votingDeadlineAt: null }],
    ["정원 문자열", { votingDeadlineAt: DEADLINE, participantLimit: "5" }],
    ["정원 null", { votingDeadlineAt: DEADLINE, participantLimit: null }],
    ["소요 시간 NaN 대신 문자열", { votingDeadlineAt: DEADLINE, durationMinutes: "60" }],
    ["날짜 범위 null", { votingDeadlineAt: DEADLINE, dateRange: null }],
    ["날짜 범위 종료만", { votingDeadlineAt: DEADLINE, dateRange: { endDate: "2026-11-20" } }],
    ["없는 날짜", { votingDeadlineAt: DEADLINE, dateRange: { startDate: "2026-11-10", endDate: "2026-02-30" } }],
    ["하루 범위 시작만", { votingDeadlineAt: DEADLINE, dailyTimeRange: { startTime: "09:00" } }],
    ["하루 범위 24:30", { votingDeadlineAt: DEADLINE, dailyTimeRange: { startTime: "09:00", endTime: "24:30" } }],
  ])("%s → 400", (_n, body) => {
    expect(parseReopenSettings(body)).toBeNull();
  });

  it("30분 경계가 아닌 시각·범위 밖 정원은 형식이 맞으면 통과시키고 422 검증에 맡긴다", () => {
    expect(
      parseReopenSettings({
        votingDeadlineAt: DEADLINE,
        participantLimit: 31,
        dailyTimeRange: { startTime: "09:15", endTime: "10:00" },
      }),
    ).toMatchObject({ participantLimit: 31, dailyTimeRange: { startMinute: 555, endMinute: 600 } });
  });
});

describe("applySettingsPatch", () => {
  const current = {
    participantLimit: 5,
    startDate: "2026-11-01",
    endDate: "2026-11-12",
    startMinute: 540,
    endMinute: 720,
    durationMinutes: 60,
  };

  it("보낸 값만 덮어쓰고 나머지는 기존 값", () => {
    expect(
      applySettingsPatch(current, {
        votingDeadlineAt: new Date(DEADLINE),
        dailyTimeRange: { startMinute: 600, endMinute: 780 },
      }),
    ).toEqual({ ...current, startMinute: 600, endMinute: 780, votingDeadlineAt: new Date(DEADLINE) });
  });

  it("전부 보내면 전부 바뀐다", () => {
    expect(
      applySettingsPatch(current, {
        votingDeadlineAt: new Date(DEADLINE),
        participantLimit: 8,
        dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" },
        dailyTimeRange: { startMinute: 0, endMinute: 1440 },
        durationMinutes: 30,
      }),
    ).toEqual({
      participantLimit: 8,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
      startMinute: 0,
      endMinute: 1440,
      durationMinutes: 30,
      votingDeadlineAt: new Date(DEADLINE),
    });
  });
});
