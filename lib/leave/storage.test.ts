import { describe, expect, it } from "vitest";
import { draftStorageKey } from "@/lib/availability/sync";
import { setupStorageKey } from "@/lib/create-promise/countdown";
import { promiseStorageKeys } from "./storage";

const P = "7c1b2f40-808a-4f31-8a27-d849330dd123";
const OTHER = "11111111-2222-4333-8444-555555555555";
const TOKEN = "tok_abc";

describe("promiseStorageKeys", () => {
  it("이 약속의 제출 전 입력(모든 참여자 키)과 카운트다운 기준값만 고른다", () => {
    const keys = [
      draftStorageKey(P, "me"),
      draftStorageKey(P, "earlier-nickname"),
      draftStorageKey(OTHER, "me"),
      setupStorageKey(TOKEN),
      setupStorageKey("tok_other"),
      "unrelated",
    ];
    expect(promiseStorageKeys(keys, P, TOKEN)).toEqual([
      draftStorageKey(P, "me"),
      draftStorageKey(P, "earlier-nickname"),
      setupStorageKey(TOKEN),
    ]);
  });

  it("지울 값이 없으면 빈 목록", () => {
    expect(promiseStorageKeys([draftStorageKey(OTHER, "me")], P, TOKEN)).toEqual([]);
  });
});
