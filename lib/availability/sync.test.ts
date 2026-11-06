import { describe, expect, it } from "vitest";
import {
  decideDraft,
  draftStorageKey,
  estimateServerNow,
  formatRemaining,
  formatSeoulDateTime,
  nextDraft,
  parseDraft,
  parseSlotList,
  serializeDraft,
  submissionState,
  SUBMISSION_LABELS,
  toSlotStrings,
} from "./sync";

const ms = (iso: string) => Date.parse(iso);
const A = ms("2026-11-10T14:00:00+09:00");
const B = ms("2026-11-10T14:30:00+09:00");
const C = ms("2026-11-11T09:00:00+09:00");
const NOW = ms("2026-11-10T12:00:00+09:00");

describe("슬롯 변환", () => {
  it("초 단위·밀리초 표기를 같은 시각으로 본다", () => {
    expect(
      parseSlotList(["2026-11-10T14:00:00.000+09:00", "2026-11-10T14:00:00+09:00", "x", 3]),
    ).toEqual([A]);
  });
  it("+09:00 초 단위 문자열로 정렬해 보낸다 (기기 시간대 무관)", () => {
    expect(toSlotStrings([B, A])).toEqual([
      "2026-11-10T14:00:00+09:00",
      "2026-11-10T14:30:00+09:00",
    ]);
    expect(toSlotStrings([ms("2026-11-10T00:30:00+09:00")])).toEqual(["2026-11-10T00:30:00+09:00"]);
  });
});

describe("로컬 저장 형식 { v: 1, baseVersion, slots }", () => {
  it("키는 약속ID + 참여자ID (TIME-10-02)", () => {
    expect(draftStorageKey("p1", "u1")).toBe("yaksok:availability:p1:u1");
  });
  it("직렬화 후 다시 읽으면 같다", () => {
    const raw = serializeDraft({ baseVersion: 3, slots: [B, A] });
    expect(JSON.parse(raw)).toEqual({
      v: 1,
      baseVersion: 3,
      slots: ["2026-11-10T14:00:00+09:00", "2026-11-10T14:30:00+09:00"],
    });
    expect(parseDraft(raw)).toEqual({ baseVersion: 3, slots: [A, B] });
  });
  it("형식이 틀리면 null", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("{")).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 2, baseVersion: 0, slots: [] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, baseVersion: -1, slots: [] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, baseVersion: 1.5, slots: [] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, baseVersion: 0, slots: "x" }))).toBeNull();
  });
});

describe("decideDraft (TIME-10-04)", () => {
  const me = (version: number, submitted: boolean, slots: number[]) => ({
    version,
    submitted,
    slots,
  });

  it("로컬 입력이 없으면 none", () => {
    expect(decideDraft(null, me(0, false, []), "collecting", NOW)).toEqual({ kind: "none" });
  });
  it("버전이 같으면 유지", () => {
    expect(
      decideDraft({ baseVersion: 3, slots: [A] }, me(3, true, [B]), "collecting", NOW),
    ).toEqual({ kind: "keep" });
  });
  it("버전이 같고 서버 값과 같아졌으면 조용히 지운다", () => {
    expect(
      decideDraft({ baseVersion: 3, slots: [A] }, me(3, true, [A]), "collecting", NOW),
    ).toEqual({ kind: "drop", reason: "same" });
  });
  it.each([
    ["다른 기기에서 제출", 3, 4, true],
    ["처음 제출을 다른 기기에서 함", 0, 1, true],
    ["제출 해제(범위 확대)", 3, 4, false],
  ])("%s → 폐기·안내", (_name, base, server, submitted) => {
    expect(
      decideDraft({ baseVersion: base, slots: [A] }, me(server, submitted, [C]), "collecting", NOW),
    ).toEqual({ kind: "drop", reason: "changed" });
  });
  it("버전이 달라도 서버가 제출 상태이고 미래 슬롯이 같으면 응답 유실 복구로 조용히 지운다", () => {
    const past = ms("2026-11-10T10:00:00+09:00");
    expect(
      decideDraft({ baseVersion: 3, slots: [A, B] }, me(4, true, [past, A, B]), "collecting", NOW),
    ).toEqual({ kind: "drop", reason: "already_saved" });
  });
  it("미래 슬롯이 같아도 제출 해제 상태면 바뀐 것으로 본다", () => {
    expect(
      decideDraft({ baseVersion: 3, slots: [A] }, me(4, false, [A]), "collecting", NOW),
    ).toEqual({ kind: "drop", reason: "changed" });
  });
  it.each(["closed", "confirmed"] as const)("%s면 지우고 저장되지 않았음을 알린다", (status) => {
    expect(decideDraft({ baseVersion: 3, slots: [A] }, me(3, true, [B]), status, NOW)).toEqual({
      kind: "drop",
      reason: "closed",
    });
    expect(decideDraft({ baseVersion: 3, slots: [B] }, me(3, true, [B]), status, NOW)).toEqual({
      kind: "drop",
      reason: "same",
    });
  });
});

describe("nextDraft", () => {
  const me = { version: 5, submitted: true, slots: [A] };
  it("수정을 시작한 시점의 서버 버전을 기준으로 둔다", () => {
    expect(nextDraft(null, [B, A], me)).toEqual({ baseVersion: 5, slots: [A, B] });
    expect(nextDraft({ baseVersion: 4, slots: [B] }, [B, C], me)).toEqual({
      baseVersion: 4,
      slots: [B, C],
    });
  });
  it("서버 값과 같아지면 null", () => {
    expect(nextDraft({ baseVersion: 5, slots: [B] }, [A], me)).toBeNull();
  });
});

describe("제출 상태 (TIME-11-02)", () => {
  it.each([
    [false, false, "아직 제출하지 않았어요"],
    [false, true, "입력 중 · 제출 전"],
    [true, false, "제출됨"],
    [true, true, "수정 중, 다시 제출 필요"],
  ])("submitted=%s dirty=%s → %s", (submitted, dirty, label) => {
    expect(SUBMISSION_LABELS[submissionState(submitted, dirty)]).toBe(label);
  });
});

describe("서버 시각·남은 시간", () => {
  it("받은 serverTime + 흐른 시간", () => {
    expect(estimateServerNow(NOW, 1000, 4500)).toBe(NOW + 3500);
    expect(estimateServerNow(NOW, 1000, 900)).toBe(NOW); // 단조 시계가 거꾸로 가면 0
  });
  it("남은 시간 표기", () => {
    expect(formatRemaining(0)).toBeNull();
    expect(formatRemaining(-5)).toBeNull();
    expect(formatRemaining(45_000)).toBe("45초 남음");
    expect(formatRemaining(5 * 60_000 + 3_000)).toBe("5분 3초 남음");
    expect(formatRemaining(3 * 3_600_000)).toBe("3시간 남음");
    expect(formatRemaining(3 * 3_600_000 + 12 * 60_000)).toBe("3시간 12분 남음");
    expect(formatRemaining(2 * 86_400_000 + 3 * 3_600_000)).toBe("2일 3시간 남음");
    expect(formatRemaining(86_400_000)).toBe("1일 남음");
  });
  it("마감 시각은 한국 시간으로 표기", () => {
    expect(formatSeoulDateTime(ms("2026-11-10T23:59:00+09:00"))).toBe("11/10(화) 23:59");
    expect(formatSeoulDateTime(ms("2026-11-10T15:00:00Z"))).toBe("11/11(수) 00:00");
  });
});
