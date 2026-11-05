import { minuteToTime } from "@/lib/state/start-settings";

// 화면 요약 표기. 약속 이름 대신 "10.01–10.31 · 방장 포함 4명"을 제목으로 쓴다 (R-15)

function monthDay(ymd: string): string {
  return `${ymd.slice(5, 7)}.${ymd.slice(8, 10)}`;
}

export function formatDateRange(start: string, end: string): string {
  return start === end ? monthDay(start) : `${monthDay(start)}–${monthDay(end)}`;
}

export function formatSummaryTitle(start: string, end: string, participantLimit: number): string {
  return `${formatDateRange(start, end)} · 방장 포함 ${participantLimit}명`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export function formatDailyRange(startMinute: number, endMinute: number): string {
  return `${minuteToTime(startMinute)}–${minuteToTime(endMinute)}`;
}

// "2026-10-31T23:59" 또는 "2026-10-31T23:59:00+09:00" → "10.31 23:59"
export function formatDeadline(value: string): string {
  return `${monthDay(value.slice(0, 10))} ${value.slice(11, 16)}`;
}

export function timeToMinute(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
