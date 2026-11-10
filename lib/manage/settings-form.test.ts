import { describe, expect, it } from "vitest";
import {
  buildReopenBody,
  buildSettingsBody,
  DEADLINE_REQUIRED_MESSAGE,
  formFromSettings,
  INCOMPLETE_RANGE_MESSAGE,
  isShrinkBlockedByDeadline,
  NO_CHANGE_MESSAGE,
  previewRangeChange,
  seoulLocalNow,
  SHRINK_BLOCKED_MESSAGE,
  validateSettingsForm,
  type PromiseSettings,
  type SettingsForm,
} from "./settings-form";

// 판정 시각: 2026-11-10 12:00 (한국 시간)
const NOW = new Date("2026-11-10T12:00:00+09:00");

const CURRENT: PromiseSettings = {
  participantLimit: 4,
  dateRange: { startDate: "2026-11-12", endDate: "2026-11-20" },
  dailyTimeRange: { startTime: "09:00", endTime: "24:00" },
  durationMinutes: 120,
  votingDeadlineAt: "2026-11-11T23:59:00+09:00",
};

const SAME: SettingsForm = {
  participantLimit: 4,
  startDate: "2026-11-12",
  endDate: "2026-11-20",
  startMinute: 540,
  endMinute: 1440,
  durationMinutes: 120,
  deadline: "2026-11-11T23:59",
};

describe("formFromSettings", () => {
  it("설정 변경은 현재 값(마감은 한국 시간 분 단위, 24:00은 1440)으로 채운다", () => {
    expect(formFromSettings(CURRENT, "settings")).toEqual(SAME);
  });

  it("재조율은 새 마감을 고르게 마감을 비운다", () => {
    expect(formFromSettings(CURRENT, "reopen")).toEqual({ ...SAME, deadline: null });
  });
});

describe("seoulLocalNow", () => {
  it("기기 시간대와 관계없이 한국 시간 벽시계", () => {
    expect(seoulLocalNow(new Date("2026-11-10T15:30:45Z"))).toBe("2026-11-11T00:30");
  });
});

describe("buildSettingsBody", () => {
  it("설정 변경은 바꾼 필드만 보내고 날짜 범위를 안 바꿨으면 dateRange를 보내지 않는다", () => {
    expect(
      buildSettingsBody(CURRENT, { ...SAME, participantLimit: 6, deadline: "2026-11-12T10:00" }),
    ).toEqual({
      participantLimit: 6,
      votingDeadlineAt: "2026-11-12T10:00:00+09:00",
    });
  });

  it("아무것도 바꾸지 않으면 빈 본문", () => {
    expect(buildSettingsBody(CURRENT, SAME)).toEqual({});
  });

  it("종료일만 바꿔도 dateRange는 시작·종료를 함께 보낸다", () => {
    expect(buildSettingsBody(CURRENT, { ...SAME, endDate: "2026-11-25" })).toEqual({
      dateRange: { startDate: "2026-11-12", endDate: "2026-11-25" },
    });
  });

  it("종료일을 아직 고르지 않았으면 dateRange를 보내지 않는다", () => {
    expect(buildSettingsBody(CURRENT, { ...SAME, startDate: "2026-11-13", endDate: null })).toEqual(
      {},
    );
  });

  it("하루 시간 범위는 바뀌면 시작·종료를 함께 HH:mm(24:00 포함)으로 보낸다", () => {
    expect(buildSettingsBody(CURRENT, { ...SAME, startMinute: 600 })).toEqual({
      dailyTimeRange: { startTime: "10:00", endTime: "24:00" },
    });
  });

  it("소요 시간만 바꾸면 durationMinutes만", () => {
    expect(buildSettingsBody(CURRENT, { ...SAME, durationMinutes: 90 })).toEqual({
      durationMinutes: 90,
    });
  });

  it("마감 입력이 현재 마감과 같은 분이면 보내지 않는다", () => {
    const current = { ...CURRENT, votingDeadlineAt: "2026-11-11T23:59:30+09:00" };
    expect(buildSettingsBody(current, SAME)).toEqual({});
  });
});

describe("buildReopenBody", () => {
  const changed = { ...SAME, participantLimit: 6, deadline: "2026-11-15T20:00" };

  it("설정도 바꾸기를 펼치지 않았으면 새 마감만 보낸다", () => {
    expect(buildReopenBody(CURRENT, changed, false)).toEqual({
      votingDeadlineAt: "2026-11-15T20:00:00+09:00",
    });
  });

  it("펼쳤으면 바꾼 필드와 새 마감을 보내고 범위를 안 바꿨으면 dateRange는 없다", () => {
    expect(buildReopenBody(CURRENT, changed, true)).toEqual({
      participantLimit: 6,
      votingDeadlineAt: "2026-11-15T20:00:00+09:00",
    });
  });

  it("현재 마감과 같은 값이어도 새 마감은 항상 보낸다", () => {
    expect(buildReopenBody(CURRENT, SAME, false)).toEqual({
      votingDeadlineAt: "2026-11-11T23:59:00+09:00",
    });
  });
});

describe("isShrinkBlockedByDeadline", () => {
  it("기존 마감이 새 마지막 날 00:00 이후면 막는다(같은 시각 포함)", () => {
    expect(isShrinkBlockedByDeadline(CURRENT, "2026-11-11")).toBe(true);
    expect(
      isShrinkBlockedByDeadline(
        { ...CURRENT, votingDeadlineAt: "2026-11-12T00:00:00+09:00" },
        "2026-11-12",
      ),
    ).toBe(true);
  });

  it("기존 마감이 새 마지막 날 00:00보다 앞서면 막지 않는다", () => {
    expect(isShrinkBlockedByDeadline(CURRENT, "2026-11-12")).toBe(false);
  });
});

describe("validateSettingsForm — 설정 변경", () => {
  const check = (form: SettingsForm, activeCount = 2) =>
    validateSettingsForm({
      mode: "settings",
      current: CURRENT,
      form,
      changeSettings: true,
      now: NOW,
      activeCount,
    });

  it("정원 증가·마감 연장은 통과", () => {
    expect(check({ ...SAME, participantLimit: 6, deadline: "2026-11-12T10:00" })).toBeNull();
  });

  it("바꾼 내용이 없으면 저장하지 않는다", () => {
    expect(check(SAME)).toEqual({ field: null, message: NO_CHANGE_MESSAGE });
  });

  it("정원 감소는 서버와 같은 함수로 막는다", () => {
    expect(check({ ...SAME, participantLimit: 3 })).toEqual({
      field: "participantLimit",
      message: "모집 중에는 정원을 줄일 수 없습니다.",
    });
  });

  it("마감 단축은 막는다", () => {
    expect(check({ ...SAME, deadline: "2026-11-11T20:00" })).toEqual({
      field: "votingDeadlineAt",
      message: "모집 중에는 응답 마감을 앞당길 수 없습니다.",
    });
  });

  it("기존 마감이 새 마지막 날 00:00 이후가 되는 축소는 이유와 함께 막는다", () => {
    expect(check({ ...SAME, startDate: "2026-11-10", endDate: "2026-11-11" })).toEqual({
      field: "dateRange",
      message: SHRINK_BLOCKED_MESSAGE,
    });
  });

  it("마감보다 뒤로 끝나는 축소는 통과", () => {
    expect(check({ ...SAME, endDate: "2026-11-15" })).toBeNull();
  });

  it("종료일을 고르지 않았으면 안내", () => {
    expect(check({ ...SAME, endDate: null })).toEqual({
      field: "dateRange",
      message: INCOMPLETE_RANGE_MESSAGE,
    });
  });

  it("시작일이 지난 범위라도 범위를 안 바꾸면 시작 날짜 하한을 보지 않는다(R-26)", () => {
    const current = { ...CURRENT, dateRange: { startDate: "2026-11-05", endDate: "2026-11-20" } };
    expect(
      validateSettingsForm({
        mode: "settings",
        current,
        form: { ...formFromSettings(current, "settings"), participantLimit: 5 },
        changeSettings: true,
        now: NOW,
        activeCount: 2,
      }),
    ).toBeNull();
  });

  it("범위를 바꾸면 시작 날짜 하한을 본다", () => {
    const current = { ...CURRENT, dateRange: { startDate: "2026-11-05", endDate: "2026-11-20" } };
    expect(
      validateSettingsForm({
        mode: "settings",
        current,
        form: { ...formFromSettings(current, "settings"), endDate: "2026-11-25" },
        changeSettings: true,
        now: NOW,
        activeCount: 2,
      }),
    ).toEqual({ field: "dateRange", message: "시작 날짜는 오늘 이후여야 합니다." });
  });
});

describe("validateSettingsForm — 재조율", () => {
  const closed = {
    ...CURRENT,
    dateRange: { startDate: "2026-11-05", endDate: "2026-11-20" },
    votingDeadlineAt: "2026-11-09T23:59:00+09:00",
  };
  const base = formFromSettings(closed, "reopen");
  const check = (form: SettingsForm, changeSettings: boolean, activeCount = 3) =>
    validateSettingsForm({
      mode: "reopen",
      current: closed,
      form,
      changeSettings,
      now: NOW,
      activeCount,
    });

  it("새 마감만 넣으면 통과(지난 시작일 그대로)", () => {
    expect(check({ ...base, deadline: "2026-11-15T20:00" }, false)).toBeNull();
  });

  it("새 마감이 없으면 안내", () => {
    expect(check(base, false)).toEqual({
      field: "votingDeadlineAt",
      message: DEADLINE_REQUIRED_MESSAGE,
    });
  });

  it("지난 마감은 막는다", () => {
    expect(check({ ...base, deadline: "2026-11-10T11:00" }, false)).toEqual({
      field: "votingDeadlineAt",
      message: "응답 마감은 현재보다 이후여야 합니다.",
    });
  });

  it("마감이 마지막 날 00:00 이후면 막는다", () => {
    expect(check({ ...base, deadline: "2026-11-20T10:00" }, false)).toEqual({
      field: "votingDeadlineAt",
      message: "응답 마감은 마지막 날짜 00:00보다 앞서야 합니다.",
    });
  });

  it("설정도 바꾸기를 펼치지 않았으면 다른 입력은 검증하지 않는다", () => {
    expect(check({ ...base, participantLimit: 2, deadline: "2026-11-15T20:00" }, false)).toBeNull();
  });

  it("펼쳤으면 정원 감소는 허용하되 현재 인원보다 작으면 막는다", () => {
    expect(check({ ...base, participantLimit: 3, deadline: "2026-11-15T20:00" }, true)).toBeNull();
    expect(check({ ...base, participantLimit: 2, deadline: "2026-11-15T20:00" }, true)).toEqual({
      field: "participantLimit",
      message: "정원은 현재 참여 인원보다 적을 수 없습니다.",
    });
  });

  it("재조율은 마감이 기존보다 일러도 된다(축소 막음 없음)", () => {
    expect(
      check(
        { ...base, startDate: "2026-11-12", endDate: "2026-11-14", deadline: "2026-11-11T20:00" },
        true,
      ),
    ).toBeNull();
  });
});

describe("previewRangeChange", () => {
  it("범위가 그대로면 null", () => {
    expect(previewRangeChange(CURRENT, { ...SAME, participantLimit: 9 }, NOW)).toBeNull();
  });

  it("종료일을 고르는 중이면 null", () => {
    expect(previewRangeChange(CURRENT, { ...SAME, endDate: null }, NOW)).toBeNull();
  });

  it("줄이면 삭제만", () => {
    expect(previewRangeChange(CURRENT, { ...SAME, endDate: "2026-11-15" }, NOW)).toEqual({
      removesSlots: true,
      requiresResubmit: false,
    });
    expect(previewRangeChange(CURRENT, { ...SAME, endMinute: 1080 }, NOW)).toEqual({
      removesSlots: true,
      requiresResubmit: false,
    });
  });

  it("넓히면 재제출만", () => {
    expect(previewRangeChange(CURRENT, { ...SAME, endDate: "2026-11-25" }, NOW)).toEqual({
      removesSlots: false,
      requiresResubmit: true,
    });
  });

  it("옮기면 둘 다", () => {
    expect(
      previewRangeChange(CURRENT, { ...SAME, startDate: "2026-11-15", endDate: "2026-11-25" }, NOW),
    ).toEqual({ removesSlots: true, requiresResubmit: true });
  });

  it("늘어난 칸이 모두 지난 칸이면 재제출이 아니다(서버 hasAddedSelectableSlots와 같음)", () => {
    const current = { ...CURRENT, dateRange: { startDate: "2026-11-08", endDate: "2026-11-20" } };
    expect(
      previewRangeChange(
        current,
        { ...formFromSettings(current, "settings"), startDate: "2026-11-07" },
        NOW,
      ),
    ).toEqual({ removesSlots: false, requiresResubmit: false });
  });
});
