// 시간 입력 아래 바의 선택 요약 (029 07-5, Figma VoteFooter "3일 · 총 5시간 30분 선택"). 브라우저에서도 import한다
// 날짜는 한국 날짜로 센다. 칸은 30분이다

import { formatDuration } from "@/lib/create-promise/format";
import { SLOT_MINUTES } from "@/lib/state/start-settings";
import { seoulDateOf } from "@/lib/time/seoul";

export function selectionSummary(slots: Iterable<number>): {
  days: number;
  minutes: number;
  slots: number;
} {
  const unique = new Set(slots);
  const days = new Set([...unique].map((ms) => seoulDateOf(new Date(ms))));
  return { days: days.size, minutes: unique.size * SLOT_MINUTES, slots: unique.size };
}

export function formatSelectionSummary(slots: Iterable<number>): string {
  const { days, minutes } = selectionSummary(slots);
  if (minutes === 0) return "아직 선택한 시간이 없어요";
  return `${days}일 · 총 ${formatDuration(minutes)} 선택`;
}
