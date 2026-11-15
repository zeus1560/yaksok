import { Fragment, type ReactNode } from "react";
import type { Grid, GridDay } from "@/lib/availability/grid";
import { PAGE_DAYS, type DayPage } from "@/lib/availability/view";

// 그리드 틀: 열 = 한국 날짜, 행 = 30분 칸. 이 영역 안에서만 가로 스크롤하고 시각 열은 고정한다
// 터치 동작(touch-action)은 기본값 그대로 두어 페이지·그리드 스크롤을 막지 않는다. 휴대폰 선택 모드(selecting, 033)일 때만
// 칸 영역을 touch-action: none으로 바꿔 손가락으로 끌어 고르게 한다 — 날짜 머리글·시각 열은 그대로 스크롤된다
// 029: 행 30px, 시각 열 60px, 날짜 머리 64px(오늘 연한 파랑). 열 폭은 두 그리드를 나란히 두는 넓은 화면(lg)에서 52px
// 034 휴대폰(page가 있을 때): 4일 구간만 그리고 4일이 그리드 폭에 딱 맞게(가로 스크롤 없음), 시각 열 48px, 날짜 머리 두 줄.
//   마지막 구간이 4일보다 짧으면 빈 열로 채워 칸 폭을 구간마다 같게 한다(약속이 4일 이하면 그 날 수로 채운다).
//   rows로 묶은 칸(1시간·2시간) 행을 받는다

// 행 하나: 왼쪽 시각 글자(null이면 없음), 위쪽 진한 선(정시·묶음 시작)
export type FrameRow = { key: number; label: string | null; line: boolean };

export function GridFrame({
  grid,
  label,
  today,
  selecting = false,
  page,
  rows,
  rowClass = "h-slot",
  renderHeader,
  renderCell,
}: {
  grid: Grid;
  label: string;
  selecting?: boolean;
  today: string | null; // 한국 날짜(서버 시각 기준). 그 열 머리를 강조한다
  page?: DayPage; // 휴대폰 날짜 구간(034). 없으면 모든 날짜
  rows?: FrameRow[]; // 없으면 30분 칸(정시만 시각 표시)
  rowClass?: string; // 행 높이
  renderHeader: (day: GridDay, index: number) => ReactNode; // index = 전체 날짜 위치
  renderCell: (day: number, row: number) => ReactNode; // day = 전체 날짜 위치, row = rows 위치
}) {
  const fit = page !== undefined;
  const start = page?.start ?? 0;
  const days = grid.days.slice(start, start + (page?.count ?? grid.days.length));
  const columns = fit ? (grid.days.length <= PAGE_DAYS ? days.length : PAGE_DAYS) : days.length;
  const fillers = Array.from({ length: columns - days.length }, (_, i) => i);
  const frameRows =
    rows ??
    grid.rows.map((row) => ({
      key: row.minute,
      label: row.isHour ? row.label : null,
      line: row.isHour,
    }));

  return (
    <div
      role="group"
      aria-label={label}
      data-selecting={selecting || undefined}
      data-fit={fit || undefined}
      className={`group w-full rounded-field border select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ${
        fit ? "overflow-hidden" : "overflow-x-auto overscroll-x-contain"
      } ${selecting ? "border-blue ring-2 ring-blue/30" : "border-line"}`}
    >
      <div
        className={`grid ${fit ? "w-full" : "min-w-max [--day-col:7.5rem] lg:[--day-col:3.25rem]"}`}
        style={{
          gridTemplateColumns: fit
            ? `3rem repeat(${columns}, minmax(0, 1fr))`
            : `3.75rem repeat(${columns}, minmax(var(--day-col), 1fr))`,
        }}
      >
        <div className="sticky left-0 z-20 border-b border-r border-line bg-paper" />
        {days.map((day, i) => (
          <div
            key={day.date}
            className={`flex ${fit ? "h-12" : "h-16"} items-stretch border-b border-line ${day.date === today ? "bg-blue-soft" : "bg-paper"}`}
          >
            {renderHeader(day, start + i)}
          </div>
        ))}
        {fillers.map((i) => (
          <div key={`filler-${i}`} aria-hidden="true" className="border-b border-line bg-faint" />
        ))}
        {frameRows.map((row, r) => (
          <Fragment key={row.key}>
            <div
              className={`sticky left-0 z-10 flex ${rowClass} items-start justify-end border-r border-line bg-paper pr-2 text-xs leading-none text-sub ${
                row.line && r > 0 ? "border-t border-t-line" : ""
              }`}
            >
              {row.label && (
                <span className={r === 0 ? "mt-0.5" : "-mt-[5px] bg-paper"}>{row.label}</span>
              )}
            </div>
            {days.map((day, i) => (
              <div
                key={day.date}
                className={`${rowClass} border-r border-line/60 ${row.line && r > 0 ? "border-t border-t-line" : "border-t border-t-line/40"} ${r === 0 ? "border-t-0" : ""} ${selecting ? "touch-none" : ""}`}
              >
                {renderCell(start + i, r)}
              </div>
            ))}
            {fillers.map((i) => (
              <div key={`filler-${i}`} aria-hidden="true" className={`${rowClass} bg-faint`} />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// 넓은 열(좁은 화면)은 "11/12 목" 한 줄, 좁은 열(넓은 화면·휴대폰 4일 구간)은 두 줄
export function DayHeaderText({ day }: { day: GridDay }) {
  return (
    <span className="flex h-full w-full flex-row items-center justify-center gap-1 leading-tight group-data-fit:flex-col group-data-fit:gap-0 lg:flex-col lg:gap-0">
      <span className="text-sm font-medium text-text">{day.label}</span>
      <span className="text-sm text-sub group-data-fit:text-xs lg:text-xs">{day.weekday}</span>
    </span>
  );
}
