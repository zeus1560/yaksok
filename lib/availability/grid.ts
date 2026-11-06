import { seoulMidnight } from "@/lib/time/seoul";
import { SLOT_MINUTES } from "@/lib/time/slots";

// 가능 시간 그리드 계산 (TIME-06-01·05-02·08-01·09-01). 브라우저에서도 import하는 순수 함수다
// 날짜·시각은 모두 한국 시간 기준이며 기기 시간대를 쓰는 Date 메서드(getHours 등)는 쓰지 않는다

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export type GridDay = { date: string; label: string; weekday: string };
export type GridRow = { minute: number; label: string; isHour: boolean };
export type Grid = { days: GridDay[]; rows: GridRow[] };
export type CellPos = { day: number; row: number };

// "HH:mm" → 자정부터의 분. "24:00"은 1440
export function timeToMinute(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

// 한국 날짜 목록. 날짜 문자열은 달력 날짜로만 다루므로 UTC 자정으로 계산해도 시간대 영향이 없다
export function datesBetween(start: string, end: string): string[] {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) return [];
  const dates: string[] = [];
  for (let t = from; t <= to; t += DAY_MS) dates.push(new Date(t).toISOString().slice(0, 10));
  return dates;
}

export function dayLabel(date: string): { label: string; weekday: string } {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return { label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, weekday };
}

// 하루의 30분 칸: 시작 ≥ 하루 시작, 시작 + 30분 ≤ 하루 종료 (24:00 = 1440)
export function dailyRows(startMinute: number, endMinute: number): GridRow[] {
  const rows: GridRow[] = [];
  for (let m = startMinute; m + SLOT_MINUTES <= endMinute; m += SLOT_MINUTES) {
    rows.push({ minute: m, label: minuteLabel(m), isHour: m % 60 === 0 });
  }
  return rows;
}

export function buildGrid(settings: {
  dateRangeStart: string;
  dateRangeEnd: string;
  dailyStartTime: string;
  dailyEndTime: string;
}): Grid {
  const start = timeToMinute(settings.dailyStartTime);
  const end = timeToMinute(settings.dailyEndTime);
  const rows = Number.isNaN(start) || Number.isNaN(end) ? [] : dailyRows(start, end);
  const days = datesBetween(settings.dateRangeStart, settings.dateRangeEnd).map((date) => ({
    date,
    ...dayLabel(date),
  }));
  return { days, rows };
}

// 칸의 시작 시각(epoch ms) = 그 한국 날짜 00:00(+09:00) + 분
export function slotStartMs(date: string, minute: number): number {
  return seoulMidnight(date).getTime() + minute * MINUTE_MS;
}

export function cellMs(grid: Grid, pos: CellPos): number {
  return slotStartMs(grid.days[pos.day].date, grid.rows[pos.row].minute);
}

// 지난 칸: 시작 ≤ 서버 기준 현재 (TIME-08-01, 서버 filterSlots와 같은 경계)
export function isPastSlot(slotMs: number, serverNowMs: number): boolean {
  return slotMs <= serverNowMs;
}

// "14:00–14:30", 마지막 칸은 "23:30–24:00"
export function slotRangeLabel(minute: number): string {
  return `${minuteLabel(minute)}–${minuteLabel(minute + SLOT_MINUTES)}`;
}

// 드래그 사각형(anchor~current)의 칸을 mode로 통일한다. 지난 칸은 그대로 둔다
export function applyRect(
  base: ReadonlySet<number>,
  grid: Grid,
  anchor: CellPos,
  current: CellPos,
  mode: boolean,
  serverNowMs: number,
): Set<number> {
  const next = new Set(base);
  const [d0, d1] = [Math.min(anchor.day, current.day), Math.max(anchor.day, current.day)];
  const [r0, r1] = [Math.min(anchor.row, current.row), Math.max(anchor.row, current.row)];
  for (let d = d0; d <= d1; d += 1) {
    for (let r = r0; r <= r1; r += 1) {
      const ms = cellMs(grid, { day: d, row: r });
      if (isPastSlot(ms, serverNowMs)) continue;
      if (mode) next.add(ms);
      else next.delete(ms);
    }
  }
  return next;
}

// 바꿀 수 있는(지나지 않은) 그날의 칸
export function editableDaySlots(grid: Grid, day: number, serverNowMs: number): number[] {
  return grid.rows
    .map((row) => slotStartMs(grid.days[day].date, row.minute))
    .filter((ms) => !isPastSlot(ms, serverNowMs));
}

// TIME-09-01: 일부만 선택된 날짜 → 전체 선택, 전체 선택된 날짜 → 전체 해제 (지난 칸 제외)
export function toggleDay(
  base: ReadonlySet<number>,
  grid: Grid,
  day: number,
  serverNowMs: number,
): Set<number> {
  const slots = editableDaySlots(grid, day, serverNowMs);
  const next = new Set(base);
  const allOn = slots.length > 0 && slots.every((ms) => base.has(ms));
  for (const ms of slots) {
    if (allOn) next.delete(ms);
    else next.add(ms);
  }
  return next;
}

export function toggleSlot(base: ReadonlySet<number>, ms: number): Set<number> {
  const next = new Set(base);
  if (next.has(ms)) next.delete(ms);
  else next.add(ms);
  return next;
}
