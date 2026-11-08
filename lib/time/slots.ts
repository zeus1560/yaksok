import { isCalendarDate, seoulDateOf } from "./seoul";

// TIME-API-01 슬롯 검증·필터. 슬롯은 30분 칸의 시작 시각이며 epoch 밀리초로 다룬다
export const MAX_SLOT_COUNT = 5000;
export const SLOT_MINUTES = 30;

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;

// ISO 8601, +09:00 고정, 분 00·30, 초 00(밀리초는 .000만 허용) (TIME-02-02·02-03·06-01)
const SLOT_PATTERN = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):(00|30):00(?:\.000)?\+09:00$/;

export type ParsedSlots =
  | { kind: "ok"; slots: number[] } // 중복을 합친 오름차순
  | { kind: "limit_exceeded" }
  | { kind: "invalid_format" };

// 상한은 원본 개수(중복 정리 전)로 먼저 본다. 하나라도 형식이 틀리면 전체를 거절한다
export function parseSlotStrings(raw: string[]): ParsedSlots {
  if (raw.length > MAX_SLOT_COUNT) return { kind: "limit_exceeded" };
  const unique = new Set<number>();
  for (const value of raw) {
    const match = SLOT_PATTERN.exec(value);
    if (!match || !isCalendarDate(match[1])) return { kind: "invalid_format" };
    unique.add(Date.parse(value));
  }
  return { kind: "ok", slots: [...unique].sort((a, b) => a - b) };
}

export type SlotRange = {
  startDate: string; // YYYY-MM-DD (한국 날짜)
  endDate: string;
  dailyStartMinute: number; // 0~1410
  dailyEndMinute: number; // 30~1440 (24:00 = 1440)
};

// 서울 자정부터의 분
function seoulMinuteOfDay(ms: number): number {
  const minutes = Math.floor((ms + SEOUL_OFFSET_MS) / MINUTE_MS);
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

// 슬롯이 설정 범위 안인지 (ERD 5.1): 한국 날짜가 범위 안이고 시작 ≥ 하루 시작, 시작 + 30분 ≤ 하루 종료.
// 24:00 종료면 23:30 슬롯은 그날의 마지막 칸이다. 시각(과거·미래)은 보지 않는다
export function isSlotInRange(ms: number, range: SlotRange): boolean {
  const day = seoulDateOf(new Date(ms));
  const minute = seoulMinuteOfDay(ms);
  return (
    day >= range.startDate &&
    day <= range.endDate &&
    minute >= range.dailyStartMinute &&
    minute + SLOT_MINUTES <= range.dailyEndMinute
  );
}

// 지난 슬롯(시작 ≤ now)은 무시하고 세지 않는다 (TIME-08-01, ERD 5.2).
// 미래 슬롯은 범위 안일 때만 남긴다. slots는 오름차순, 중복 없음
export function filterSlots(
  slots: number[],
  range: SlotRange,
  now: Date,
): { kept: number[]; droppedSlotCount: number } {
  const kept: number[] = [];
  let droppedSlotCount = 0;
  for (const ms of slots) {
    if (ms <= now.getTime()) continue;
    if (isSlotInRange(ms, range)) kept.push(ms);
    else droppedSlotCount += 1;
  }
  return { kept, droppedSlotCount };
}
