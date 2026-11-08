import { describe, expect, it } from "vitest";
import {
  minuteToTime,
  parseStartSettings,
  validateStartSettings,
  type StartSettingsInput,
} from "./start-settings";

const NOW = new Date("2026-11-04T12:00:00+09:00"); // 서울 오늘 = 2026-11-04
const BODY = {
  participantLimit: 8,
  dateRange: { startDate: "2026-11-10", endDate: "2026-11-20" },
  dailyTimeRange: { startTime: "09:00", endTime: "18:00" },
  durationMinutes: 60,
  votingDeadlineAt: "2026-11-09T18:00:00+09:00",
};

function parse(overrides: Record<string, unknown> = {}) {
  return parseStartSettings({ ...BODY, ...overrides });
}

function input(overrides: Partial<StartSettingsInput> = {}): StartSettingsInput {
  return { ...parseStartSettings(BODY)!, ...overrides };
}

function check(
  overrides: Partial<StartSettingsInput> = {},
  ctx: { now?: Date; activeCount?: number } = {},
) {
  return validateStartSettings(input(overrides), {
    now: ctx.now ?? NOW,
    activeCount: ctx.activeCount ?? 1,
  });
}

const field = (overrides: Partial<StartSettingsInput>, ctx = {}) => check(overrides, ctx)?.field;

describe("parseStartSettings (400 형식)", () => {
  it("정상 본문을 분 값과 Date로 바꾼다", () => {
    expect(parse()).toEqual({
      participantLimit: 8,
      startDate: "2026-11-10",
      endDate: "2026-11-20",
      startMinute: 540,
      endMinute: 1080,
      durationMinutes: 60,
      votingDeadlineAt: new Date("2026-11-09T09:00:00Z"),
    });
  });

  it("24:00은 1440으로 바꾼다", () => {
    expect(parse({ dailyTimeRange: { startTime: "23:30", endTime: "24:00" } })?.endMinute).toBe(
      1440,
    );
  });

  it("Z 오프셋도 받는다", () => {
    expect(parse({ votingDeadlineAt: "2026-11-09T09:00:00Z" })?.votingDeadlineAt).toEqual(
      new Date("2026-11-09T09:00:00Z"),
    );
  });

  it.each([
    ["본문 null", null],
    ["본문 배열", []],
    ["정원 문자열", { ...BODY, participantLimit: "8" }],
    ["정원 누락", { ...BODY, participantLimit: undefined }],
    ["소요 시간 문자열", { ...BODY, durationMinutes: "60" }],
    ["dateRange 누락", { ...BODY, dateRange: undefined }],
    ["dateRange 배열", { ...BODY, dateRange: ["2026-11-10", "2026-11-20"] }],
    ["날짜 형식", { ...BODY, dateRange: { startDate: "2026/11/10", endDate: "2026-11-20" } }],
    ["없는 날짜", { ...BODY, dateRange: { startDate: "2026-11-10", endDate: "2026-11-31" } }],
    ["시각 형식", { ...BODY, dailyTimeRange: { startTime: "9:00", endTime: "18:00" } }],
    ["없는 시각 25:00", { ...BODY, dailyTimeRange: { startTime: "09:00", endTime: "25:00" } }],
    ["24:30", { ...BODY, dailyTimeRange: { startTime: "09:00", endTime: "24:30" } }],
    ["오프셋 없는 마감", { ...BODY, votingDeadlineAt: "2026-11-09T18:00:00" }],
    ["날짜만 있는 마감", { ...BODY, votingDeadlineAt: "2026-11-09" }],
    ["없는 날짜의 마감", { ...BODY, votingDeadlineAt: "2026-11-31T18:00:00+09:00" }],
    ["마감 숫자", { ...BODY, votingDeadlineAt: 1762678800000 }],
  ])("%s → null", (_name, body) => {
    expect(parseStartSettings(body)).toBeNull();
  });
});

describe("validateStartSettings (422 규칙)", () => {
  it("정상 값은 위반 없음", () => {
    expect(check()).toBeNull();
  });

  it.each([
    [1, "participantLimit"],
    [2, undefined],
    [30, undefined],
    [31, "participantLimit"],
    [2.5, "participantLimit"],
  ])("정원 %s → %s", (participantLimit, expected) => {
    expect(field({ participantLimit })).toBe(expected);
  });

  it("정원은 현재 active 인원 이상", () => {
    expect(field({ participantLimit: 3 }, { activeCount: 3 })).toBeUndefined();
    expect(field({ participantLimit: 2 }, { activeCount: 3 })).toBe("participantLimit");
  });

  it("정원 < active 인원만 전용 코드 CAPACITY_BELOW_ACTIVE_COUNT, 2~30 범위 밖은 코드 없음", () => {
    expect(check({ participantLimit: 2 }, { activeCount: 3 })?.code).toBe("CAPACITY_BELOW_ACTIVE_COUNT");
    expect(check({ participantLimit: 1 }, { activeCount: 3 })?.code).toBeUndefined();
    expect(check({ participantLimit: 31 }, { activeCount: 3 })?.code).toBeUndefined();
  });

  it("checkStartDateFloor=false면 지난 시작 날짜를 허용하고 나머지 규칙은 그대로 본다 (재조율 기존 범위 유지)", () => {
    const keep = (overrides: Partial<StartSettingsInput>) =>
      validateStartSettings(input(overrides), { now: NOW, activeCount: 1, checkStartDateFloor: false });
    expect(keep({ startDate: "2026-10-01" })).toBeNull();
    expect(keep({ startDate: "2026-11-21" })?.field).toBe("dateRange"); // 시작 > 종료
    expect(keep({ startDate: "2026-10-01", endDate: "2027-02-05" })?.field).toBe("dateRange"); // 3개월 초과
    expect(
      keep({ startDate: "2026-10-01", endDate: "2026-11-09" })?.field, // 마감(11-09 18:00) ≥ 마지막 날 00:00
    ).toBe("votingDeadlineAt");
  });

  it("시작 날짜: 어제는 거절, 오늘은 허용 (서울 날짜 기준)", () => {
    expect(field({ startDate: "2026-11-03" })).toBe("dateRange");
    expect(field({ startDate: "2026-11-04" })).toBeUndefined();
  });

  it("시작 날짜 오늘 판정은 서울 자정 기준 (UTC로는 전날인 시각)", () => {
    const now = new Date("2026-11-04T00:30:00+09:00");
    expect(field({ startDate: "2026-11-04" }, { now })).toBeUndefined();
    expect(field({ startDate: "2026-11-03" }, { now })).toBe("dateRange");
  });

  it("시작 날짜가 종료 날짜보다 늦으면 거절, 같으면 허용", () => {
    expect(field({ startDate: "2026-11-21" })).toBe("dateRange");
    expect(
      field({
        startDate: "2026-11-20",
        votingDeadlineAt: new Date("2026-11-19T23:59:59+09:00"),
      }),
    ).toBeUndefined();
  });

  it("종료 날짜는 오늘부터 3개월(달력 월) 이내: 2027-02-04 허용, 02-05 거절 (R-07)", () => {
    expect(field({ endDate: "2027-02-04" })).toBeUndefined();
    expect(field({ endDate: "2027-02-05" })).toBe("dateRange");
  });

  it("3개월 상한의 말일 보정: 11-30 기준 02-28 허용, 03-01 거절", () => {
    const now = new Date("2026-11-30T12:00:00+09:00");
    const base = {
      startDate: "2026-12-01",
      votingDeadlineAt: new Date("2026-11-30T18:00:00+09:00"),
    };
    expect(field({ ...base, endDate: "2027-02-28" }, { now })).toBeUndefined();
    expect(field({ ...base, endDate: "2027-03-01" }, { now })).toBe("dateRange");
  });

  it.each([
    ["23:30~24:00", 1410, 1440, 30, undefined],
    ["00:00~24:00", 0, 1440, 60, undefined],
    ["시작 24:00", 1440, 1440, 30, "dailyTimeRange"],
    ["시작 = 종료", 540, 540, 30, "dailyTimeRange"],
    ["시작 > 종료", 600, 540, 30, "dailyTimeRange"],
    ["30분 경계 아님", 555, 1080, 30, "dailyTimeRange"],
    ["종료 00:00", 0, 0, 30, "dailyTimeRange"],
  ])("하루 시간 %s → %s", (_name, startMinute, endMinute, durationMinutes, expected) => {
    expect(field({ startMinute, endMinute, durationMinutes })).toBe(expected);
  });

  it.each([
    [540, undefined], // 범위(09:00~18:00)와 같음
    [570, "durationMinutes"], // 범위보다 큼
    [30, undefined],
    [0, "durationMinutes"],
    [45, "durationMinutes"],
    [60.5, "durationMinutes"],
  ])("소요 시간 %s분 → %s", (durationMinutes, expected) => {
    expect(field({ durationMinutes })).toBe(expected);
  });

  it("마감 = 판정 시각은 거절, 1ms 뒤는 허용", () => {
    expect(field({ votingDeadlineAt: NOW })).toBe("votingDeadlineAt");
    expect(field({ votingDeadlineAt: new Date(NOW.getTime() + 1) })).toBeUndefined();
  });

  it("마감 = endDate 00:00(서울)은 거절, 1ms 전은 허용", () => {
    const midnight = new Date("2026-11-20T00:00:00+09:00");
    expect(field({ votingDeadlineAt: midnight })).toBe("votingDeadlineAt");
    expect(field({ votingDeadlineAt: new Date(midnight.getTime() - 1) })).toBeUndefined();
  });
});

describe("minuteToTime", () => {
  it.each([
    [0, "00:00"],
    [540, "09:00"],
    [1410, "23:30"],
    [1440, "24:00"],
  ])("%i → %s", (minute, time) => {
    expect(minuteToTime(minute)).toBe(time);
  });
});
