import { describe, expect, it } from "vitest";
import { buildGrid, cellMs } from "./grid";
import { groupPeople, heatLevel, maxAvailable, peopleBySlot, rangesText } from "./heat";

const A = Date.parse("2026-11-10T14:00:00+09:00");
const B = Date.parse("2026-11-10T14:30:00+09:00");

describe("peopleBySlot", () => {
  it("칸별 가능한 사람을 등록순으로 모은다. 미제출·빈 제출([])은 세지 않는다", () => {
    const map = peopleBySlot([
      { participantId: "1", nickname: "방장", isHost: true, slots: [A, B] },
      { participantId: "2", nickname: "미제출", isHost: false, slots: [] },
      { participantId: "3", nickname: "셋", isHost: false, slots: [A, A] },
    ]);
    expect(map.get(A)?.map((p) => p.nickname)).toEqual(["방장", "셋"]);
    expect(map.get(B)?.map((p) => p.nickname)).toEqual(["방장"]);
    expect(map.size).toBe(2);
  });
});

describe("heatLevel (분모 = 전체 참여자)", () => {
  it("0명은 0단계, 전원은 마지막 단계", () => {
    expect(heatLevel(0, 5)).toBe(0);
    expect(heatLevel(5, 5)).toBe(4);
    expect(heatLevel(1, 1)).toBe(4);
  });
  it("비율에 따라 1~3단계", () => {
    expect([1, 2, 3, 4].map((n) => heatLevel(n, 5))).toEqual([1, 2, 2, 3]);
    expect(heatLevel(1, 30)).toBe(1);
    expect(heatLevel(29, 30)).toBe(3);
  });
  it("참여자가 없으면 0", () => {
    expect(heatLevel(0, 0)).toBe(0);
  });
});

// 034 모두의 시간 묶은 칸. 하루 10:00~14:00(30분 8칸), 2시간 묶음 = 10:00–12:00(행 0~3)
const G = buildGrid({
  dateRangeStart: "2026-11-17",
  dateRangeEnd: "2026-11-17",
  dailyStartTime: "10:00",
  dailyEndTime: "14:00",
});
const at = (row: number) => cellMs(G, { day: 0, row });
const TWO_HOURS = { start: 0, end: 3 };
const person = (id: string, rows: number[]) => ({
  participantId: id,
  nickname: id,
  isHost: false,
  slots: rows.map(at),
});

describe("groupPeople (묶은 칸의 내내 가능·일부만 가능, 034)", () => {
  it("2시간 칸의 수는 네 칸 모두 가능한 사람만 센다", () => {
    const list = [
      person("철수", [0, 1, 2, 3]),
      person("영희", [0, 1]),
      person("민수", [0, 1, 2, 3, 4]),
    ];
    const result = groupPeople(list, peopleBySlot(list), G, 0, TWO_HOURS, 0);
    expect(result.full.map((p) => p.nickname)).toEqual(["철수", "민수"]);
    expect(result.total).toBe(4);
  });

  it("일부만 가능한 사람은 가능한 시간과 함께 따로 나온다", () => {
    const list = [person("철수", [0, 1]), person("영희", [0, 2, 3])];
    const result = groupPeople(list, peopleBySlot(list), G, 0, TWO_HOURS, 0);
    expect(result.full).toEqual([]);
    expect(result.partial.map((p) => ({ name: p.person.nickname, ranges: p.ranges }))).toEqual([
      { name: "철수", ranges: [{ start: 0, end: 1 }] },
      {
        name: "영희",
        ranges: [
          { start: 0, end: 0 },
          { start: 2, end: 3 },
        ],
      },
    ]);
  });
});

describe("groupPeople 경계 (034)", () => {
  it("지난 칸은 셈에서 뺀다 — 지난 10:00에 없던 사람도 남은 세 칸 모두면 내내 가능", () => {
    const list = [person("철수", [1, 2, 3]), person("영희", [0, 1])];
    const result = groupPeople(list, peopleBySlot(list), G, 0, TWO_HOURS, at(0));
    expect(result.total).toBe(3);
    expect(result.full.map((p) => p.nickname)).toEqual(["철수"]);
    expect(result.partial).toEqual([{ person: list[1], ranges: [{ start: 1, end: 1 }] }]);
  });

  it("전부 지났으면 past, 지난 칸에만 가능한 사람은 나오지 않는다", () => {
    const list = [person("철수", [0, 1, 2, 3])];
    expect(groupPeople(list, peopleBySlot(list), G, 0, TWO_HOURS, at(3))).toEqual({
      kind: "past",
      total: 0,
      full: [],
      partial: [],
    });
  });

  it("아무도 없으면 둘 다 비어 있다. 제출하지 않은 사람([])은 나오지 않는다", () => {
    const list = [person("미제출", []), person("오후", [6, 7])];
    const result = groupPeople(list, peopleBySlot(list), G, 0, TWO_HOURS, 0);
    expect(result).toEqual({ kind: "open", total: 4, full: [], partial: [] });
  });

  it("목록 순서는 등록순(늦은 시간에 가능한 사람이 먼저 등록했어도)", () => {
    const list = [person("가", [3]), person("나", [0, 1, 2, 3]), person("다", [0])];
    const result = groupPeople(list, peopleBySlot(list), G, 0, TWO_HOURS, 0);
    expect(result.full.map((p) => p.nickname)).toEqual(["나"]);
    expect(result.partial.map((p) => p.person.nickname)).toEqual(["가", "다"]);
  });

  it("30분 칸(한 칸 묶음)은 그 30분에 가능한 사람만, 일부만 가능은 없다", () => {
    const list = [person("철수", [2]), person("영희", [1, 3])];
    const result = groupPeople(list, peopleBySlot(list), G, 0, { start: 2, end: 2 }, 0);
    expect(result.total).toBe(1);
    expect(result.full.map((p) => p.nickname)).toEqual(["철수"]);
    expect(result.partial).toEqual([]);
  });

  it("가능한 시간 글자: 「10:00–11:00, 11:30–12:00」", () => {
    expect(
      rangesText(G, [
        { start: 0, end: 1 },
        { start: 3, end: 3 },
      ]),
    ).toBe("10:00–11:00, 11:30–12:00");
  });
});

describe("maxAvailable", () => {
  it("한 칸에 가장 많이 겹친 인원을 준다. 아무도 없으면 0", () => {
    const map = peopleBySlot([
      { participantId: "1", nickname: "가", isHost: true, slots: [A, B] },
      { participantId: "2", nickname: "나", isHost: false, slots: [A] },
    ]);
    expect(maxAvailable(map)).toBe(2);
    expect(maxAvailable(peopleBySlot([]))).toBe(0);
  });
});
