// Asia/Seoul은 일광절약시간이 없어 항상 +09:00이다 (TIME-01-01)
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

// API 응답 시각 표기. 예: 2026-10-20T19:00:00+09:00 (초 단위, 밀리초는 버린다)
export function toSeoulIsoString(date: Date): string {
  return `${new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}

// 날짜 문자열(YYYY-MM-DD)은 사전순 비교가 날짜 순서와 같다

// 그 시점의 서울 날짜
export function seoulDateOf(date: Date): string {
  return new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

// 서울 날짜의 00:00(+09:00) 시점
export function seoulMidnight(ymd: string): Date {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - SEOUL_OFFSET_MS);
}

// 달력에 실제로 있는 YYYY-MM-DD인지 (2026-02-30 같은 값은 거절)
export function isCalendarDate(ymd: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// 달력의 월 단위 더하기. 그 달에 같은 날이 없으면 말일로 맞춘다 (예: 11-30 + 3개월 = 02-28) (R-07)
export function addCalendarMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}
