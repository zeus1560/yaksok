import { describe, expect, it } from "vitest";
import type { SlotRange } from "@/lib/time/slots";
import { hasAddedSelectableSlots, planRangeChange, type RangeChangeParticipant } from "./range-change";

const at = (iso: string) => new Date(`${iso}:00+09:00`);
const NOW = at("2026-11-08T12:00");
// 11-10~11-12, 09:00~12:00
const BASE: SlotRange = {
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  dailyStartMinute: 540,
  dailyEndMinute: 720,
};

// A: 11-10 09:00, 11-12 11:00 / B: 11-11 10:00 / C: 미제출(슬롯 없음)
const PEOPLE: RangeChangeParticipant[] = [
  {
    id: "A",
    slots: [
      { id: "a1", startAt: at("2026-11-10T09:00") },
      { id: "a2", startAt: at("2026-11-12T11:00") },
    ],
  },
  { id: "B", slots: [{ id: "b1", startAt: at("2026-11-11T10:00") }] },
  { id: "C", slots: [] },
];

const plan = (after: Partial<SlotRange>, now = NOW, participants = PEOPLE) =>
  planRangeChange({ before: BASE, after: { ...BASE, ...after }, now, participants });

describe("planRangeChange (STATE-09-03·09-04)", () => {
  it("날짜 범위 축소만: 제출 유지, 범위 밖 슬롯만 삭제, 슬롯이 지워진 참여자만 버전 증가", () => {
    expect(plan({ endDate: "2026-11-11" })).toEqual({
      hasAddedSelectableSlots: false,
      submissionsReset: false,
      removedSlotIds: ["a2"],
      versionChangedParticipantIds: ["A"],
    });
  });

  it("축소했지만 아무 슬롯도 지워지지 않으면 아무도 버전이 오르지 않는다", () => {
    expect(plan({ dailyEndMinute: 690 }).versionChangedParticipantIds).toEqual([]);
    expect(plan({ dailyEndMinute: 690 }).removedSlotIds).toEqual([]);
  });

  it("날짜 범위 확대: 모든 참여자(미제출자 포함) 제출 해제·버전 증가, 슬롯은 그대로", () => {
    expect(plan({ endDate: "2026-11-13" })).toEqual({
      hasAddedSelectableSlots: true,
      submissionsReset: true,
      removedSlotIds: [],
      versionChangedParticipantIds: ["A", "B", "C"],
    });
  });

  it("이동(일부 겹침): 범위 밖 슬롯 삭제 + 추가 칸이 있으므로 전원 해제", () => {
    // 11-11~11-13: 11-10 칸은 빠지고 11-13 칸이 생긴다
    expect(plan({ startDate: "2026-11-11", endDate: "2026-11-13" })).toEqual({
      hasAddedSelectableSlots: true,
      submissionsReset: true,
      removedSlotIds: ["a1"],
      versionChangedParticipantIds: ["A", "B", "C"],
    });
  });

  it("하루 범위만 축소: 10:00~12:00이면 09:00 슬롯만 지워진다", () => {
    expect(plan({ dailyStartMinute: 600 })).toEqual({
      hasAddedSelectableSlots: false,
      submissionsReset: false,
      removedSlotIds: ["a1"],
      versionChangedParticipantIds: ["A"],
    });
  });

  it("하루 범위만 확대: 12:00~12:30 칸이 생기면 전원 해제", () => {
    expect(plan({ dailyEndMinute: 750 })).toMatchObject({
      hasAddedSelectableSlots: true,
      submissionsReset: true,
      versionChangedParticipantIds: ["A", "B", "C"],
    });
  });

  it("하루 범위 이동(09:00~12:00 → 10:00~13:00)도 확대·이동으로 본다", () => {
    expect(plan({ dailyStartMinute: 600, dailyEndMinute: 780 })).toEqual({
      hasAddedSelectableSlots: true,
      submissionsReset: true,
      removedSlotIds: ["a1"],
      versionChangedParticipantIds: ["A", "B", "C"],
    });
  });

  it("범위 그대로(소요 시간·마감·정원만 변경): 슬롯·제출·버전 모두 유지", () => {
    expect(plan({})).toEqual({
      hasAddedSelectableSlots: false,
      submissionsReset: false,
      removedSlotIds: [],
      versionChangedParticipantIds: [],
    });
  });

  it("범위 밖에 남아 있던 지난 슬롯도 새 범위 밖이면 지운다(시각과 관계없이 범위로 판정)", () => {
    const past = [{ id: "P", slots: [{ id: "p1", startAt: at("2026-11-07T09:00") }] }];
    expect(plan({}, NOW, past)).toMatchObject({ removedSlotIds: ["p1"], versionChangedParticipantIds: ["P"] });
  });

  it("24:00 종료면 23:30 칸이 그날 마지막 칸이다", () => {
    const late = [{ id: "L", slots: [{ id: "l1", startAt: at("2026-11-10T23:30") }] }];
    const before: SlotRange = { ...BASE, dailyEndMinute: 1440 };
    expect(
      planRangeChange({ before, after: before, now: NOW, participants: late }).removedSlotIds,
    ).toEqual([]);
    expect(
      planRangeChange({ before, after: { ...before, dailyEndMinute: 1410 }, now: NOW, participants: late })
        .removedSlotIds,
    ).toEqual(["l1"]);
  });

  it("참여자가 없어도 계산한다", () => {
    expect(plan({ endDate: "2026-11-13" }, NOW, [])).toEqual({
      hasAddedSelectableSlots: true,
      submissionsReset: true,
      removedSlotIds: [],
      versionChangedParticipantIds: [],
    });
  });
});

describe("hasAddedSelectableSlots", () => {
  // 11-09~11-12에서 시작일을 오늘(11-08)로 당긴다
  const FROM_TOMORROW: SlotRange = { ...BASE, startDate: "2026-11-09" };
  const FROM_TODAY: SlotRange = { ...BASE, startDate: "2026-11-08" };

  it("추가된 칸이 모두 지난 시각이면 선택 가능한 칸이 늘지 않은 것으로 본다", () => {
    // 오늘 09:00~12:00 칸을 더하지만 판정 시각이 12:00이라 모두 지났다
    expect(hasAddedSelectableSlots(FROM_TOMORROW, FROM_TODAY, NOW)).toBe(false);
    // 하나라도 미래 칸이 있으면 늘어난 것
    expect(hasAddedSelectableSlots(FROM_TOMORROW, FROM_TODAY, at("2026-11-08T08:00"))).toBe(true);
  });

  it("경계: 시작이 판정 시각과 같은 칸은 지난 칸이다", () => {
    const now = at("2026-11-08T11:30"); // 오늘 마지막 칸(11:30) 시작과 같음
    expect(hasAddedSelectableSlots(FROM_TOMORROW, FROM_TODAY, now)).toBe(false);
    expect(hasAddedSelectableSlots(FROM_TOMORROW, FROM_TODAY, new Date(now.getTime() - 1))).toBe(true);
  });

  it("3개월 범위 × 하루 전체도 바로 계산한다", () => {
    const wide: SlotRange = {
      startDate: "2026-11-08",
      endDate: "2027-02-08",
      dailyStartMinute: 0,
      dailyEndMinute: 1440,
    };
    expect(hasAddedSelectableSlots(wide, wide, NOW)).toBe(false);
    expect(hasAddedSelectableSlots(BASE, wide, NOW)).toBe(true);
  });

  it("월말을 넘는 날짜도 하루씩 센다", () => {
    const before: SlotRange = { ...BASE, startDate: "2026-11-29", endDate: "2026-11-30" };
    expect(hasAddedSelectableSlots(before, { ...before, endDate: "2026-12-01" }, NOW)).toBe(true);
    expect(hasAddedSelectableSlots(before, { ...before, startDate: "2026-11-30" }, NOW)).toBe(false);
  });
});
