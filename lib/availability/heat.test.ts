import { describe, expect, it } from "vitest";
import { heatLevel, maxAvailable, peopleBySlot } from "./heat";

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
