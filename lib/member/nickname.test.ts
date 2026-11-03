import { describe, expect, it } from "vitest";
import { normalizeNickname, validateNickname } from "./nickname";

describe("validateNickname (MEMBER-05-01·05-03·05-04)", () => {
  it("한글 12자는 통과, 13자는 거절", () => {
    expect(validateNickname("가나다라마바사아자차카타")).toEqual({
      ok: true,
      nickname: "가나다라마바사아자차카타",
    });
    expect(validateNickname("가나다라마바사아자차카타파")).toEqual({ ok: false, reason: "length" });
  });

  it("1자와 공백뿐인 입력은 거절, 2자는 통과", () => {
    expect(validateNickname("가")).toEqual({ ok: false, reason: "length" });
    expect(validateNickname("   ")).toEqual({ ok: false, reason: "length" });
    expect(validateNickname("승주").ok).toBe(true);
  });

  it("앞뒤 공백만 제거하고 중간 공백·대소문자는 보존한다", () => {
    expect(validateNickname("  승 주  ")).toEqual({ ok: true, nickname: "승 주" });
    expect(validateNickname("Kim  Lee")).toEqual({ ok: true, nickname: "Kim  Lee" });
  });

  it("앞뒤 공백은 길이에 세지 않는다", () => {
    expect(validateNickname(" 가 ")).toEqual({ ok: false, reason: "length" });
    expect(validateNickname("  가나다라마바사아자차카타  ").ok).toBe(true);
  });

  // 조합형 ᄀ(U+1100) + ᅡ(U+1161), 완성형 가(U+AC00)
  const DECOMPOSED_GA = String.fromCharCode(0x1100, 0x1161);
  const COMPOSED_GA = String.fromCharCode(0xac00);

  it("조합형 한글은 NFC 완성형으로 저장한다", () => {
    expect(DECOMPOSED_GA).not.toBe(COMPOSED_GA);
    expect(validateNickname(DECOMPOSED_GA + "나")).toEqual({
      ok: true,
      nickname: COMPOSED_GA + "나",
    });
    expect(normalizeNickname(`  ${DECOMPOSED_GA}${DECOMPOSED_GA} `)).toBe(
      COMPOSED_GA + COMPOSED_GA,
    );
  });

  it("조합형 입력의 글자 수는 완성형과 같게 센다", () => {
    expect(validateNickname(DECOMPOSED_GA)).toEqual({ ok: false, reason: "length" });
    expect(validateNickname(DECOMPOSED_GA.repeat(12))).toEqual({
      ok: true,
      nickname: COMPOSED_GA.repeat(12),
    });
    expect(validateNickname(DECOMPOSED_GA.repeat(13))).toEqual({ ok: false, reason: "length" });
  });

  it("라틴 결합 문자도 NFC로 합치고 한 글자로 센다", () => {
    const decomposedE = "e" + String.fromCharCode(0x0301);
    expect(validateNickname(decomposedE + decomposedE)).toEqual({
      ok: true,
      nickname: String.fromCharCode(0xe9, 0xe9),
    });
  });

  it("NFKC가 아니므로 호환 문자·대소문자는 바꾸지 않는다", () => {
    const fullwidthA = String.fromCharCode(0xff21); // 전각 Ａ, NFKC라면 A로 바뀐다
    expect(normalizeNickname(`${fullwidthA}b`)).toBe(`${fullwidthA}b`);
    expect(normalizeNickname("AbC")).toBe("AbC");
  });

  it.each(["승주😀", "👨‍👩‍👧‍👦가족", "❤️하트", "가나👍"])("이모지(%s)는 거절한다", (input) => {
    expect(validateNickname(input)).toEqual({ ok: false, reason: "emoji" });
  });

  it("이모지가 아닌 기호·숫자는 허용한다 (MEMBER-05-02 제한 없음)", () => {
    expect(validateNickname("A-1_#").ok).toBe(true);
  });
});
