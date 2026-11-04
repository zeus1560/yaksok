import { describe, expect, it } from "vitest";
import { filterSlots, MAX_SLOT_COUNT, parseSlotStrings } from "./slots";

const ms = (iso: string) => Date.parse(iso);

describe("parseSlotStrings (TIME-API-01 슬롯 형식)", () => {
  it("정상 슬롯은 epoch 밀리초 오름차순으로 돌려준다", () => {
    expect(parseSlotStrings(["2026-11-10T14:30:00+09:00", "2026-11-10T14:00:00+09:00"])).toEqual({
      kind: "ok",
      slots: [ms("2026-11-10T14:00:00+09:00"), ms("2026-11-10T14:30:00+09:00")],
    });
  });

  it(".000 밀리초는 허용한다", () => {
    expect(parseSlotStrings(["2026-11-10T14:00:00.000+09:00"])).toEqual({
      kind: "ok",
      slots: [ms("2026-11-10T14:00:00+09:00")],
    });
  });

  it("같은 시각은 표기가 달라도 하나로 합친다", () => {
    expect(
      parseSlotStrings([
        "2026-11-10T14:00:00+09:00",
        "2026-11-10T14:00:00.000+09:00",
        "2026-11-10T14:00:00+09:00",
      ]),
    ).toEqual({ kind: "ok", slots: [ms("2026-11-10T14:00:00+09:00")] });
  });

  it("빈 배열은 통과한다", () => {
    expect(parseSlotStrings([])).toEqual({ kind: "ok", slots: [] });
  });

  it.each([
    ["+00:00 오프셋", "2026-11-10T05:00:00+00:00"],
    ["Z 오프셋", "2026-11-10T05:00:00Z"],
    ["오프셋 없음", "2026-11-10T14:00:00"],
    ["분 15", "2026-11-10T14:15:00+09:00"],
    ["초 1", "2026-11-10T14:00:01+09:00"],
    ["밀리초 .001", "2026-11-10T14:00:00.001+09:00"],
    ["없는 날짜 2026-02-30", "2026-02-30T14:00:00+09:00"],
    ["시 24", "2026-11-10T24:00:00+09:00"],
    ["초 생략", "2026-11-10T14:00+09:00"],
    ["날짜만", "2026-11-10"],
    ["빈 문자열", ""],
  ])("%s → invalid_format", (_, value) => {
    expect(parseSlotStrings(["2026-11-10T14:00:00+09:00", value])).toEqual({
      kind: "invalid_format",
    });
  });

  it("5,000개는 통과, 5,001개는 중복이어도 limit_exceeded", () => {
    const same = "2026-11-10T14:00:00+09:00";
    expect(parseSlotStrings(Array(MAX_SLOT_COUNT).fill(same))).toEqual({
      kind: "ok",
      slots: [ms(same)],
    });
    expect(parseSlotStrings(Array(MAX_SLOT_COUNT + 1).fill(same))).toEqual({
      kind: "limit_exceeded",
    });
  });

  it("상한을 형식보다 먼저 본다", () => {
    expect(parseSlotStrings(Array(MAX_SLOT_COUNT + 1).fill("bad"))).toEqual({
      kind: "limit_exceeded",
    });
  });
});

describe("filterSlots (지난 슬롯·범위)", () => {
  const range = {
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    dailyStartMinute: 9 * 60,
    dailyEndMinute: 18 * 60,
  };
  const NOW = new Date("2026-11-05T12:00:00+09:00");
  const run = (isos: string[], r = range, now = NOW) =>
    filterSlots(
      isos.map(ms).sort((a, b) => a - b),
      r,
      now,
    );

  it("날짜 범위 양끝은 남기고 하루 밖은 버린다", () => {
    expect(
      run([
        "2026-11-09T12:00:00+09:00",
        "2026-11-10T12:00:00+09:00",
        "2026-11-12T12:00:00+09:00",
        "2026-11-13T12:00:00+09:00",
      ]),
    ).toEqual({
      kept: [ms("2026-11-10T12:00:00+09:00"), ms("2026-11-12T12:00:00+09:00")],
      droppedSlotCount: 2,
    });
  });

  it("날짜는 한국 날짜로 본다 (UTC로는 전날인 00:00 KST)", () => {
    const allDay = { ...range, dailyStartMinute: 0, dailyEndMinute: 1440 };
    expect(run(["2026-11-10T00:00:00+09:00", "2026-11-09T23:30:00+09:00"], allDay)).toEqual({
      kept: [ms("2026-11-10T00:00:00+09:00")],
      droppedSlotCount: 1,
    });
  });

  it("하루 시작 경계: 시작 시각은 통과, 30분 전은 제외", () => {
    expect(run(["2026-11-10T08:30:00+09:00", "2026-11-10T09:00:00+09:00"])).toEqual({
      kept: [ms("2026-11-10T09:00:00+09:00")],
      droppedSlotCount: 1,
    });
  });

  it("종료 경계: 종료 - 30분 시작은 통과, 종료 시각 시작은 제외", () => {
    expect(run(["2026-11-10T17:30:00+09:00", "2026-11-10T18:00:00+09:00"])).toEqual({
      kept: [ms("2026-11-10T17:30:00+09:00")],
      droppedSlotCount: 1,
    });
  });

  it("23:00 종료면 23:00 시작 슬롯은 제외 (ERD 11절)", () => {
    expect(run(["2026-11-10T23:00:00+09:00"], { ...range, dailyEndMinute: 23 * 60 })).toEqual({
      kept: [],
      droppedSlotCount: 1,
    });
  });

  it("24:00 종료면 마지막 날짜의 23:30 슬롯은 통과, 다음 날 00:00은 범위 밖", () => {
    const late = { ...range, dailyEndMinute: 1440 };
    expect(run(["2026-11-12T23:30:00+09:00", "2026-11-13T00:00:00+09:00"], late)).toEqual({
      kept: [ms("2026-11-12T23:30:00+09:00")],
      droppedSlotCount: 1,
    });
  });

  it("지난 슬롯은 무시하고 droppedSlotCount에도 넣지 않는다", () => {
    const now = new Date("2026-11-10T12:10:00+09:00");
    expect(
      run(
        [
          "2026-11-10T07:00:00+09:00", // 지난 + 범위 밖
          "2026-11-10T12:00:00+09:00", // 지난
          "2026-11-10T12:30:00+09:00", // 미래
          "2026-11-10T20:00:00+09:00", // 미래 + 범위 밖
        ],
        range,
        now,
      ),
    ).toEqual({ kept: [ms("2026-11-10T12:30:00+09:00")], droppedSlotCount: 1 });
  });

  it("판정 시각과 같은 시작 시각은 지난 슬롯으로 본다", () => {
    const now = new Date("2026-11-10T12:00:00+09:00");
    expect(run(["2026-11-10T12:00:00+09:00", "2026-11-10T12:30:00+09:00"], range, now)).toEqual({
      kept: [ms("2026-11-10T12:30:00+09:00")],
      droppedSlotCount: 0,
    });
  });
});
