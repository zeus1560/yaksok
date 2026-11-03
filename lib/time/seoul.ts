// Asia/Seoul은 일광절약시간이 없어 항상 +09:00이다 (TIME-01-01)
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

// API 응답 시각 표기. 예: 2026-10-20T19:00:00+09:00 (초 단위, 밀리초는 버린다)
export function toSeoulIsoString(date: Date): string {
  return `${new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}
