import { describe, expect, it } from "vitest";
import { parseCandidatePage, sliceCandidatePage } from "./candidate-page";

const parse = (query: string) => parseCandidatePage(new URLSearchParams(query));

describe("parseCandidatePage (STATE-API-10 limit·offset)", () => {
  it("없으면 limit 5, offset 0", () => {
    expect(parse("")).toEqual({ kind: "ok", limit: 5, offset: 0 });
  });

  it("경계값 limit 1·5, offset 0·큰 값", () => {
    expect(parse("limit=1&offset=0")).toEqual({ kind: "ok", limit: 1, offset: 0 });
    expect(parse("limit=5&offset=1000000")).toEqual({ kind: "ok", limit: 5, offset: 1000000 });
  });

  it("다른 쿼리 이름은 무시한다", () => {
    expect(parse("foo=bar&limit=2")).toEqual({ kind: "ok", limit: 2, offset: 0 });
  });

  it.each(["0", "6", "-1", "1.5", "1.0", "abc", "", " 1", "+1", "01", "1e1", "0x2"])(
    "limit=%j → invalid limit",
    (value) => {
      expect(parse(`limit=${encodeURIComponent(value)}`)).toEqual({ kind: "invalid", field: "limit" });
    },
  );

  it.each(["-1", "1.5", "abc", "", "-0", "9007199254740992", "99999999999999999999"])(
    "offset=%j → invalid offset",
    (value) => {
      expect(parse(`offset=${encodeURIComponent(value)}`)).toEqual({
        kind: "invalid",
        field: "offset",
      });
    },
  );

  it("같은 이름 반복은 거절한다", () => {
    expect(parse("limit=1&limit=2")).toEqual({ kind: "invalid", field: "limit" });
    expect(parse("offset=0&offset=1")).toEqual({ kind: "invalid", field: "offset" });
  });

  it("둘 다 틀리면 limit을 먼저 알린다", () => {
    expect(parse("limit=9&offset=-1")).toEqual({ kind: "invalid", field: "limit" });
  });
});

describe("sliceCandidatePage", () => {
  const all = ["a", "b", "c", "d", "e", "f", "g"];

  it("첫 페이지: 다음이 있으면 hasMore·nextOffset", () => {
    expect(sliceCandidatePage(all, { limit: 5, offset: 0 })).toEqual({
      total: 7,
      hasMore: true,
      nextOffset: 5,
      items: ["a", "b", "c", "d", "e"],
    });
  });

  it("마지막 페이지: 남은 만큼만, hasMore=false·nextOffset=null", () => {
    expect(sliceCandidatePage(all, { limit: 5, offset: 5 })).toEqual({
      total: 7,
      hasMore: false,
      nextOffset: null,
      items: ["f", "g"],
    });
  });

  it("딱 맞게 끝나면 hasMore=false", () => {
    expect(sliceCandidatePage(all, { limit: 2, offset: 5 })).toMatchObject({
      hasMore: false,
      nextOffset: null,
      items: ["f", "g"],
    });
  });

  it("offset ≥ total이면 빈 배열·hasMore=false·nextOffset=null, total은 그대로", () => {
    for (const offset of [7, 8, 1000]) {
      expect(sliceCandidatePage(all, { limit: 5, offset })).toEqual({
        total: 7,
        hasMore: false,
        nextOffset: null,
        items: [],
      });
    }
  });

  it("후보 없음 → total 0, 빈 배열", () => {
    expect(sliceCandidatePage([], { limit: 5, offset: 0 })).toEqual({
      total: 0,
      hasMore: false,
      nextOffset: null,
      items: [],
    });
  });
});
