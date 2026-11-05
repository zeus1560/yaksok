"use client";

import { useState } from "react";
import {
  isSelectableDate,
  maxSelectableDate,
  monthGrid,
  type DateRange,
} from "@/lib/create-promise/date-range";

// 월 달력 (Figma Calendar 7:74). 첫 클릭 시작일, 두 번째 클릭 종료일
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function monthOf(ymd: string): { year: number; month: number } {
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) };
}

function shift(ym: { year: number; month: number }, delta: number) {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function key(ym: { year: number; month: number }): number {
  return ym.year * 12 + ym.month;
}

export function Calendar(props: {
  today: string;
  range: DateRange;
  onSelect: (date: string) => void;
  invalid?: boolean;
}) {
  const { today, range } = props;
  const first = monthOf(today);
  const last = monthOf(maxSelectableDate(today));
  const [view, setView] = useState(() => (range.start ? monthOf(range.start) : first));
  const cells = monthGrid(view.year, view.month);

  function state(date: string) {
    const { start, end } = range;
    const isEdge = date === start || date === end;
    const inRange = start !== null && end !== null && date > start && date < end;
    return { isEdge, inRange };
  }

  return (
    <div
      className={`rounded-xl border bg-paper p-3 sm:p-4 ${props.invalid ? "border-danger" : "border-line"}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <NavButton
          label="이전 달"
          disabled={key(view) <= key(first)}
          onClick={() => setView(shift(view, -1))}
        >
          ‹
        </NavButton>
        <p className="text-lg font-bold" aria-live="polite">
          {view.year}년 {view.month}월
        </p>
        <NavButton
          label="다음 달"
          disabled={key(view) >= key(last)}
          onClick={() => setView(shift(view, 1))}
        >
          ›
        </NavButton>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1 text-xs text-sub">
            {d}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />;
          const selectable = isSelectableDate(date, today);
          const { isEdge, inRange } = state(date);
          const tone = isEdge
            ? "bg-blue text-white"
            : inRange
              ? "bg-blue-soft text-ink"
              : selectable
                ? "hover:bg-faint"
                : "text-line";
          return (
            <button
              key={date}
              type="button"
              disabled={!selectable}
              onClick={() => props.onSelect(date)}
              aria-pressed={isEdge || inRange}
              aria-label={`${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일${date === today ? " 오늘" : ""}`}
              className={`h-10 rounded-lg text-sm disabled:cursor-not-allowed ${tone} ${date === today && !isEdge ? "ring-1 ring-blue" : ""}`}
            >
              {Number(date.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-lg text-ink disabled:text-line"
    >
      {props.children}
    </button>
  );
}
