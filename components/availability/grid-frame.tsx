import { Fragment, type ReactNode } from "react";
import type { Grid, GridDay } from "@/lib/availability/grid";

// 그리드 틀: 열 = 한국 날짜, 행 = 30분 칸. 이 영역 안에서만 가로 스크롤하고 시각 열은 고정한다
// 터치 동작(touch-action)은 기본값 그대로 두어 페이지·그리드 스크롤을 막지 않는다
// 029: 행 30px, 시각 열 60px, 날짜 머리 64px(오늘 연한 파랑). 열 폭은 한 그리드만 보이는 좁은 화면에서 120px(Figma 23),
// 두 그리드를 나란히 두는 넓은 화면(lg)에서는 52px — 넓은 화면 열 폭은 그리드 개편 때 정한다(07-2 보류)

export function GridFrame({
  grid,
  label,
  today,
  renderHeader,
  renderCell,
}: {
  grid: Grid;
  label: string;
  today: string | null; // 한국 날짜(서버 시각 기준). 그 열 머리를 강조한다
  renderHeader: (day: GridDay, index: number) => ReactNode;
  renderCell: (day: number, row: number) => ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="w-full overflow-x-auto overscroll-x-contain rounded-field border border-line select-none [-webkit-tap-highlight-color:transparent]"
    >
      <div
        className="grid min-w-max [--day-col:7.5rem] lg:[--day-col:3.25rem]"
        style={{
          gridTemplateColumns: `3.75rem repeat(${grid.days.length}, minmax(var(--day-col), 1fr))`,
        }}
      >
        <div className="sticky left-0 z-20 border-b border-r border-line bg-paper" />
        {grid.days.map((day, index) => (
          <div
            key={day.date}
            className={`flex h-16 items-stretch border-b border-line ${day.date === today ? "bg-blue-soft" : "bg-paper"}`}
          >
            {renderHeader(day, index)}
          </div>
        ))}
        {grid.rows.map((row, r) => (
          <Fragment key={row.minute}>
            <div
              className={`sticky left-0 z-10 flex h-slot items-start justify-end border-r border-line bg-paper pr-2 text-xs leading-none text-sub ${
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
                className={`h-slot border-r border-line/60 ${row.isHour && r > 0 ? "border-t border-t-line" : "border-t border-t-line/40"} ${r === 0 ? "border-t-0" : ""}`}
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

// 넓은 열(좁은 화면)은 "11/12 목" 한 줄, 좁은 열(넓은 화면)은 두 줄
export function DayHeaderText({ day }: { day: GridDay }) {
  return (
    <span className="flex h-full w-full flex-row items-center justify-center gap-1 leading-tight lg:flex-col lg:gap-0">
      <span className="text-sm font-medium text-text">{day.label}</span>
      <span className="text-sm text-sub lg:text-xs">{day.weekday}</span>
    </span>
  );
}
