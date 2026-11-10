"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import {
  applyRect,
  cellMs,
  editableDaySlots,
  isPastSlot,
  slotRangeLabel,
  toggleDay,
  toggleSlot,
  type CellPos,
  type Grid,
} from "@/lib/availability/grid";
import { seoulDateOf } from "@/lib/time/seoul";
import { DayHeaderText, GridFrame } from "./grid-frame";

// 내 가능 시간 그리드 (TIME-10-04, TIME-09-01, TIME-08-01)
// 마우스: 드래그한 사각형을 첫 칸의 반대 상태로 통일. 터치·펜·키보드: 칸을 눌러 하나씩 토글
// 날짜 머리글: 그날 전체 선택/해제. 지난 칸은 회색이며 바꿀 수 없다

type Drag = { anchor: CellPos; current: CellPos; mode: boolean };

export function MyGrid({
  grid,
  selection,
  nowMs,
  readOnly,
  onCommit,
  onDragActive,
}: {
  grid: Grid;
  selection: ReadonlySet<number>;
  nowMs: number;
  readOnly: boolean;
  onCommit: (next: Set<number>) => void;
  onDragActive: (active: boolean) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const lastPointerType = useRef<string | null>(null);

  const shown = useMemo(
    () =>
      drag ? applyRect(selection, grid, drag.anchor, drag.current, drag.mode, nowMs) : selection,
    [drag, selection, grid, nowMs],
  );

  // 드래그 끝: 그리드 밖에서 버튼을 놓거나 창을 벗어나도 끝낸다
  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      setDrag(null);
      onDragActive(false);
      onCommit(applyRect(selection, grid, drag.anchor, drag.current, drag.mode, nowMs));
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  }, [drag, selection, grid, nowMs, onCommit, onDragActive]);

  function onPointerDown(pos: CellPos, event: PointerEvent<HTMLButtonElement>) {
    lastPointerType.current = event.pointerType;
    if (readOnly || event.pointerType !== "mouse" || event.button !== 0) return;
    const ms = cellMs(grid, pos);
    if (isPastSlot(ms, nowMs)) return;
    event.preventDefault(); // 텍스트 선택 방지
    onDragActive(true);
    setDrag({ anchor: pos, current: pos, mode: !selection.has(ms) });
  }

  function onPointerEnter(pos: CellPos) {
    if (!drag || (drag.current.day === pos.day && drag.current.row === pos.row)) return;
    setDrag({ ...drag, current: pos });
  }

  function onClick(pos: CellPos, event: MouseEvent<HTMLButtonElement>) {
    // 마우스 클릭은 드래그가 처리했다. detail 0은 키보드(Enter·Space)
    if (readOnly || (event.detail !== 0 && lastPointerType.current === "mouse")) return;
    const ms = cellMs(grid, pos);
    if (isPastSlot(ms, nowMs)) return;
    onCommit(toggleSlot(selection, ms));
  }

  return (
    <GridFrame
      grid={grid}
      label="내 가능 시간"
      today={nowMs > 0 ? seoulDateOf(new Date(nowMs)) : null}
      renderHeader={(day, index) => {
        const editable = !readOnly && editableDaySlots(grid, index, nowMs).length > 0;
        if (!editable) return <DayHeaderText day={day} />;
        return (
          <button
            type="button"
            className="h-full w-full hover:bg-faint"
            aria-label={`${day.label}(${day.weekday}) 하루 전체 선택 또는 해제`}
            onClick={() => onCommit(toggleDay(selection, grid, index, nowMs))}
          >
            <DayHeaderText day={day} />
          </button>
        );
      }}
      renderCell={(d, r) => {
        const pos = { day: d, row: r };
        const ms = cellMs(grid, pos);
        const past = isPastSlot(ms, nowMs);
        const on = shown.has(ms);
        const color = past
          ? on
            ? "bg-sub/35"
            : "bg-muted"
          : on
            ? "bg-blue"
            : readOnly
              ? "bg-paper"
              : "bg-paper hover:bg-faint";
        const day = grid.days[d];
        return (
          <button
            type="button"
            data-slot={ms}
            aria-pressed={on}
            aria-disabled={past || readOnly}
            aria-label={`${day.label}(${day.weekday}) ${slotRangeLabel(grid.rows[r].minute)} ${on ? "가능" : "불가능"}${past ? ", 지난 시간" : ""}`}
            className={`block h-full w-full ${color} ${past || readOnly ? "cursor-default" : "cursor-pointer"}`}
            onPointerDown={(e) => onPointerDown(pos, e)}
            onPointerEnter={() => onPointerEnter(pos)}
            onClick={(e) => onClick(pos, e)}
          />
        );
      }}
    />
  );
}
