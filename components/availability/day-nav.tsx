"use client";

import type { Grid, GridDay } from "@/lib/availability/grid";
import { dayPage, pageCount, PAGE_DAYS } from "@/lib/availability/view";

// 휴대폰 날짜 넘기기 줄 「◀ 11/16 (월) – 11/19 (목) ▶」 (034, R-39)
// 「내 시간」·「모두의 시간」이 같은 구간을 쓴다(보드가 구간 번호를 가진다). 첫·마지막 구간에서는 해당 버튼을 흐리게(누를 수 없음)

export const dayText = (day: GridDay) => `${day.label} (${day.weekday})`;

export function DayNav({
  grid,
  page,
  onChange,
}: {
  grid: Grid;
  page: number;
  onChange: (page: number) => void;
}) {
  const last = pageCount(grid.days.length) - 1;
  const index = Math.min(Math.max(page, 0), last);
  const range = dayPage(grid.days.length, index);
  const first = grid.days[range.start];
  const end = grid.days[range.start + range.count - 1];
  if (!first || !end) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <NavButton
        label={`이전 ${PAGE_DAYS}일`}
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
      >
        ◀
      </NavButton>
      <p aria-live="polite" data-day-range className="text-sm font-medium text-text">
        {first === end ? dayText(first) : `${dayText(first)} – ${dayText(end)}`}
      </p>
      <NavButton
        label={`다음 ${PAGE_DAYS}일`}
        disabled={index === last}
        onClick={() => onChange(index + 1)}
      >
        ▶
      </NavButton>
    </div>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-icon w-icon shrink-0 items-center justify-center rounded-field border border-line bg-paper text-sm text-ink disabled:cursor-default disabled:opacity-35"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
