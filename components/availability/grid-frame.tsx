import { Fragment, type ReactNode } from "react";
import type { Grid, GridDay } from "@/lib/availability/grid";

// 그리드 틀: 열 = 한국 날짜, 행 = 30분 칸. 이 영역 안에서만 가로 스크롤하고 시각 열은 고정한다
// 터치 동작(touch-action)은 기본값 그대로 두어 페이지·그리드 스크롤을 막지 않는다

export function GridFrame({
  grid,
  label,
  renderHeader,
  renderCell,
}: {
  grid: Grid;
  label: string;
  renderHeader: (day: GridDay, index: number) => ReactNode;
  renderCell: (day: number, row: number) => ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="w-full overflow-x-auto overscroll-x-contain rounded-lg border border-line select-none [-webkit-tap-highlight-color:transparent]"
    >
      <div
        className="grid min-w-max"
        style={{ gridTemplateColumns: `3rem repeat(${grid.days.length}, minmax(3.25rem, 1fr))` }}
      >
        <div className="sticky left-0 z-20 border-b border-r border-line bg-paper" />
        {grid.days.map((day, index) => (
          <div key={day.date} className="border-b border-line bg-faint">
            {renderHeader(day, index)}
          </div>
        ))}
        {grid.rows.map((row, r) => (
          <Fragment key={row.minute}>
            <div
              className={`sticky left-0 z-10 flex h-8 items-start justify-end border-r border-line bg-paper pr-1.5 text-[11px] leading-none text-sub ${
                row.isHour && r > 0 ? "border-t border-t-line" : ""
              }`}
            >
              {row.isHour && (
                <span className={r === 0 ? "mt-0.5" : "-mt-[5px] bg-paper"}>{row.label}</span>
              )}
            </div>
            {grid.days.map((day, d) => (
              <div
                key={day.date}
                className={`h-8 border-r border-line/60 ${row.isHour && r > 0 ? "border-t border-t-line" : "border-t border-t-line/40"} ${r === 0 ? "border-t-0" : ""}`}
              >
                {renderCell(d, r)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function DayHeaderText({ day }: { day: GridDay }) {
  return (
    <span className="flex flex-col items-center py-1.5 leading-tight">
      <span className="text-sm font-medium text-text">{day.label}</span>
      <span
        className={`text-xs ${day.weekday === "일" ? "text-danger" : day.weekday === "토" ? "text-blue" : "text-sub"}`}
      >
        {day.weekday}
      </span>
    </span>
  );
}
