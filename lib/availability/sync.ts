import { toSeoulIsoString } from "@/lib/time/seoul";
import { isSlotInRange, type SlotRange } from "@/lib/time/slots";
import { timeToMinute } from "./grid";

// 가능 시간 입력 화면의 로컬 임시 입력·서버 동기화 (TIME-10-02·10-04·11-02). 브라우저에서도 import하는 순수 함수다
// 슬롯은 epoch ms로 다룬다. 서버 표기(초 단위·밀리초 3자리)가 달라도 같은 시각이면 같은 값이다

export type AvailabilityStatusValue = "collecting" | "closed" | "confirmed";

export type ServerMe = { version: number; submitted: boolean; slots: number[] };

// 로컬 저장 형식 { v: 1, baseVersion, slots } (time.md 시간 표기 규약)
export type LocalDraft = { baseVersion: number; slots: number[] }; // slots 오름차순, 중복 없음

const DRAFT_FORMAT_VERSION = 1;

// TIME-10-02: 키는 약속ID와 참여자ID 조합
export function draftStorageKey(promiseId: string, participantId: string): string {
  return `yaksok:availability:${promiseId}:${participantId}`;
}

// 형식이 틀린 시각은 버린다. 서버 표기가 .000을 붙여도 Date.parse 값은 같다
export function parseSlotList(values: readonly unknown[]): number[] {
  const set = new Set<number>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) set.add(ms);
  }
  return [...set].sort((a, b) => a - b);
}

export function toSlotStrings(slots: Iterable<number>): string[] {
  return [...slots].sort((a, b) => a - b).map((ms) => toSeoulIsoString(new Date(ms)));
}

export function serializeDraft(draft: LocalDraft): string {
  return JSON.stringify({
    v: DRAFT_FORMAT_VERSION,
    baseVersion: draft.baseVersion,
    slots: toSlotStrings(draft.slots),
  });
}

// 저장값이 없거나 형식이 맞지 않으면 null (호출자가 지운다)
export function parseDraft(raw: string | null): LocalDraft | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { v, baseVersion, slots } = value as {
    v?: unknown;
    baseVersion?: unknown;
    slots?: unknown;
  };
  if (v !== DRAFT_FORMAT_VERSION) return null;
  if (typeof baseVersion !== "number" || !Number.isSafeInteger(baseVersion) || baseVersion < 0) {
    return null;
  }
  if (!Array.isArray(slots)) return null;
  return { baseVersion, slots: parseSlotList(slots) };
}

export function sameSlots(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((ms) => set.has(ms));
}

function future(slots: readonly number[], nowMs: number): number[] {
  return slots.filter((ms) => ms > nowMs);
}

export type DraftDecision =
  | { kind: "none" } // 로컬 입력 없음
  | { kind: "keep" } // 로컬 입력 유지(본인 화면에 로컬 값)
  | { kind: "drop"; reason: "same" | "already_saved" | "changed" | "closed" };

// 서버 응답(폴링·첫 조회)을 받을 때 로컬 입력을 어떻게 할지 (TIME-10-04)
// - 마감(closed·confirmed): 더 제출할 수 없으므로 지우고 저장되지 않았음을 알린다
// - 버전이 같으면 유지. 단 서버 값과 같아졌으면 수정 사항이 없으므로 조용히 지운다
// - 버전이 다르면 다른 기기 제출·범위 변경이다. 지우고 알린다
//   예외: 서버가 제출 상태이고 미래 슬롯이 로컬과 같으면 이 기기의 제출 응답이 유실된 경우다(서버 재시도 판정과 같은 기준) — 조용히 지운다
export function decideDraft(
  draft: LocalDraft | null,
  me: ServerMe,
  status: AvailabilityStatusValue,
  serverNowMs: number,
): DraftDecision {
  if (!draft) return { kind: "none" };
  if (status !== "collecting") {
    return { kind: "drop", reason: sameSlots(draft.slots, me.slots) ? "same" : "closed" };
  }
  if (draft.baseVersion === me.version) {
    return sameSlots(draft.slots, me.slots) ? { kind: "drop", reason: "same" } : { kind: "keep" };
  }
  if (me.submitted && sameSlots(future(draft.slots, serverNowMs), future(me.slots, serverNowMs))) {
    return { kind: "drop", reason: "already_saved" };
  }
  return { kind: "drop", reason: "changed" };
}

// 선택을 바꾼 뒤의 로컬 입력. 서버 값과 같아지면 수정 사항이 없으므로 null(로컬 삭제)
// 기준 버전은 수정을 시작한 시점의 서버 버전이다 (TIME-10-04)
export function nextDraft(
  current: LocalDraft | null,
  selection: Iterable<number>,
  me: ServerMe,
): LocalDraft | null {
  const slots = [...new Set(selection)].sort((a, b) => a - b);
  if (sameSlots(slots, me.slots)) return null;
  return { baseVersion: current?.baseVersion ?? me.version, slots };
}

// 화면이 받은 설정(TIME-API-02 settings) → 슬롯 범위. 하루 시각 "HH:mm"(24:00 = 1440)
export function settingsRange(settings: {
  dateRangeStart: string;
  dateRangeEnd: string;
  dailyStartTime: string;
  dailyEndTime: string;
}): SlotRange {
  return {
    startDate: settings.dateRangeStart,
    endDate: settings.dateRangeEnd,
    dailyStartMinute: timeToMinute(settings.dailyStartTime),
    dailyEndMinute: timeToMinute(settings.dailyEndTime),
  };
}

// 새 설정 범위 밖 칸을 제출 전 입력에서 지운다 (028, STATE-09-03)
// 방장이 범위를 줄여도 서버는 저장된 슬롯만 정리하고 버전을 올린다. 그 범위에 저장된 슬롯이 없던 참여자는
// 버전이 그대로라 로컬 입력이 유지되므로(decideDraft keep), 화면이 같은 기준(isSlotInRange)으로 잘라 낸다
// 지난 칸은 시각과 무관하게 범위만 본다(서버 범위 정리와 같은 기준)
export function clipDraftToRange(
  draft: LocalDraft,
  range: SlotRange,
): { draft: LocalDraft; removed: number } {
  const slots = draft.slots.filter((ms) => isSlotInRange(ms, range));
  if (slots.length === draft.slots.length) return { draft, removed: 0 };
  return {
    draft: { baseVersion: draft.baseVersion, slots },
    removed: draft.slots.length - slots.length,
  };
}

export function rangeClippedNotice(removed: number): string {
  return `약속 설정이 바뀌어 범위 밖 입력 ${removed}칸을 지웠어요. 제출 전이에요.`;
}

export type SubmissionState = "not_submitted" | "editing" | "submitted" | "editing_resubmit";

export function submissionState(submitted: boolean, dirty: boolean): SubmissionState {
  if (dirty) return submitted ? "editing_resubmit" : "editing";
  return submitted ? "submitted" : "not_submitted";
}

export const SUBMISSION_LABELS: Record<SubmissionState, string> = {
  not_submitted: "아직 제출하지 않았어요",
  editing: "입력 중 · 제출 전",
  submitted: "제출됨",
  editing_resubmit: "수정 중, 다시 제출 필요",
};

// 서버 시각 추정: 받은 serverTime + 받은 뒤 흐른 시간(단조 시계). 기기 시계의 절대값은 쓰지 않는다
export function estimateServerNow(
  serverTimeMs: number,
  receivedAtMonotonic: number,
  nowMonotonic: number,
): number {
  return serverTimeMs + Math.max(0, nowMonotonic - receivedAtMonotonic);
}

// 마감까지 남은 시간 표기. 0 이하이면 null
export function formatRemaining(ms: number): string | null {
  if (ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간 남음` : `${days}일 남음`;
  if (hours > 0) return minutes > 0 ? `${hours}시간 ${minutes}분 남음` : `${hours}시간 남음`;
  if (minutes > 0) return `${minutes}분 ${seconds}초 남음`;
  return `${seconds}초 남음`;
}

// 마감 시각 표기 "11/10(화) 23:59" — 한국 시간
export function formatSeoulDateTime(ms: number): string {
  const seoul = new Date(ms + 9 * 60 * 60 * 1000);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][seoul.getUTCDay()];
  const hh = String(seoul.getUTCHours()).padStart(2, "0");
  const mm = String(seoul.getUTCMinutes()).padStart(2, "0");
  return `${seoul.getUTCMonth() + 1}/${seoul.getUTCDate()}(${weekday}) ${hh}:${mm}`;
}
