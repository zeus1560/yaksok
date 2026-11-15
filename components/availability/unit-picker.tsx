"use client";

import type { Grid } from "@/lib/availability/grid";
import { UNITS, type RowGroup, type Unit } from "@/lib/availability/view";
import type { FrameRow } from "./grid-frame";

// 휴대폰 표시 단위 선택 30분·1시간·2시간 (034). 「내 시간」과 「모두의 시간」이 같은 단위를 쓴다(보드 상태, R-40)
export function UnitPicker({ unit, onChange }: { unit: Unit; onChange: (unit: Unit) => void }) {
  return (
    <div
      role="group"
      aria-label="표시 단위"
      className="flex h-icon shrink-0 items-stretch rounded-field border border-line bg-paper p-0.5"
    >
      {UNITS.map((u) => (
        <button
          key={u.unit}
          type="button"
          aria-pressed={unit === u.unit}
          onClick={() => onChange(u.unit)}
          className={`whitespace-nowrap rounded-control px-2 text-sm ${
            unit === u.unit ? "bg-blue-soft font-bold text-ink" : "text-sub"
          }`}
        >
          {u.label}
        </button>
      ))}
    </div>
  );
}

// 묶은 칸 행 높이(30분 30px, 1시간 40px, 2시간 48px)와 행 머리(묶음 시작 시각)
export const GROUP_ROW_CLASS: Record<Unit, string> = { 1: "h-slot", 2: "h-10", 4: "h-12" };

export function groupFrameRows(grid: Grid, groups: readonly RowGroup[], unit: Unit) {
  if (unit === 1) return undefined; // 30분은 GridFrame 기본(정시만 시각 표시)
  return groups.map<FrameRow>((g) => ({
    key: grid.rows[g.start].minute,
    label: grid.rows[g.start].label,
    line: true,
  }));
}
