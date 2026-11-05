import { seoulMidnight } from "@/lib/time/seoul";
import { addDays, type DateRange } from "@/lib/create-promise/date-range";

// 투표 마감 기본값 (TIME-13-02, DECISION_CONFLICTS R-16)
// 입력값은 한국 시간 벽시계 "YYYY-MM-DDTHH:mm"(datetime-local 형식)로 다루고 보낼 때 +09:00을 붙인다

const DAY_END = "T23:59";

// 그 날짜 23:59(한국 시간) 시점
function seoulAt2359(ymd: string): Date {
  return new Date(seoulMidnight(ymd).getTime() + (23 * 60 + 59) * 60 * 1000);
}

// 시작일 전날 23:59. 이미 지났으면 종료일 전날 23:59. 둘 다 지났으면 null
export function defaultDeadline(range: DateRange, now: Date): string | null {
  if (range.start === null || range.end === null) return null;
  for (const base of [range.start, range.end]) {
    const day = addDays(base, -1);
    if (seoulAt2359(day).getTime() > now.getTime()) return `${day}${DAY_END}`;
  }
  return null;
}

// 방장이 직접 수정했으면 그 값을 유지하고, 아니면 날짜 범위에 맞춰 다시 계산한다
export function resolveDeadline(args: {
  range: DateRange;
  now: Date;
  current: string | null;
  touched: boolean;
}): string | null {
  if (args.touched) return args.current;
  return defaultDeadline(args.range, args.now);
}

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// API 전송 형식. 예: 2026-10-31T23:59 → 2026-10-31T23:59:00+09:00
export function toDeadlinePayload(local: string): string | null {
  return LOCAL.test(local) ? `${local}:00+09:00` : null;
}
