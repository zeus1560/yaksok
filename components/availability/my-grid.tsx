"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { cellAtPoint, createDragTracker, dragInput, type Drag } from "@/lib/availability/drag";
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
// 터치 기기는 「드래그로 선택」을 켜면 손가락으로도 마우스와 같은 규칙으로 끌어서 고른다(033, R-38).
// 켰을 때만 칸 영역의 스크롤을 막고, 날짜 머리글·시각 열·그리드 밖에서는 스크롤된다
// 날짜 머리글: 그날 전체 선택/해제. 지난 칸은 회색이며 바꿀 수 없다

// 터치가 주 입력인 기기(손가락으로 쓰는 화면). 서버 렌더와 첫 하이드레이션은 false(버튼 없음)
const COARSE_POINTER = "(pointer: coarse)";

function subscribeCoarsePointer(onChange: () => void) {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarsePointer,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  );
}

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
  // 드래그 상태는 이벤트마다 즉시 바뀌는 tracker가 기준이고, drag는 화면 표시용이다 (fix 002)
  const [tracker] = useState(() => createDragTracker(setDrag));
  const detachFinish = useRef<(() => void) | null>(null);
  const lastPointerType = useRef<string | null>(null);
  // 터치 드래그가 처리한 탭 뒤에 오는 click을 한 번 건너뛴다. 누를 때마다 새로 정한다
  const skipClick = useRef(false);
  const touchDevice = useCoarsePointer();
  // 선택 모드는 기기에 저장하지 않는다(R-38) — 다음 방문은 늘 스크롤이 되는 꺼진 상태로 시작
  const [selectMode, setSelectMode] = useState(false);
  // 안내는 이 화면에서 처음 켤 때 한 번만 보여 주고, 끄면 다시 보여 주지 않는다
  const [hint, setHint] = useState<"before" | "showing" | "done">("before");
  const selecting = touchDevice && selectMode && !readOnly;

  const shown = useMemo(
    () =>
      drag ? applyRect(selection, grid, drag.anchor, drag.current, drag.mode, nowMs) : selection,
    [drag, selection, grid, nowMs],
  );

  // 드래그 중에 화면이 사라지면 놓기 리스너만 뗀다
  useEffect(() => () => detachFinish.current?.(), []);

  function onPointerDown(pos: CellPos, event: PointerEvent<HTMLButtonElement>) {
    lastPointerType.current = event.pointerType;
    skipClick.current = false;
    const input = readOnly ? null : dragInput(event, selecting);
    if (!input) return;
    // 두 번째 손가락은 무시한다(첫 손가락의 드래그를 이어 간다)
    if (input === "touch" && detachFinish.current) return;
    const ms = cellMs(grid, pos);
    if (isPastSlot(ms, nowMs)) return;
    event.preventDefault(); // 텍스트 선택 방지
    detachFinish.current?.();
    onDragActive(true);
    tracker.start(pos, !selection.has(ms));
    // 드래그 끝: 그리드 밖에서 버튼을 놓거나 창을 벗어나도 끝낸다. 누른 그 자리에서 바로 달아
    // 렌더를 기다리지 않는다. 드래그 중에는 폴링 반영을 보류하므로 선택은 누른 시점 값을 기준으로 한다
    const base = selection;
    const pointerId = event.pointerId;
    // 터치는 누른 칸이 포인터를 붙잡아 다른 칸의 pointerenter가 오지 않는다. 손가락 좌표로 칸을 찾는다
    // 칸 크기는 칸을 감싼 틀(테두리 포함, 모든 칸이 같음) 기준. 끄는 동안 칸 영역은 스크롤되지 않는다
    const rect = (event.currentTarget.parentElement ?? event.currentTarget).getBoundingClientRect();
    const box = { pos, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const size = { days: grid.days.length, rows: grid.rows.length };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointerId) tracker.move(cellAtPoint(box, size, e.clientX, e.clientY));
    };
    const finish = (e: Event) => {
      if (input === "touch" && e instanceof globalThis.PointerEvent && e.pointerId !== pointerId)
        return;
      detach();
      const last = tracker.end();
      if (!last) return;
      onDragActive(false);
      onCommit(applyRect(base, grid, last.anchor, last.current, last.mode, nowMs));
    };
    const detach = () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      window.removeEventListener("pointermove", move);
      detachFinish.current = null;
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    if (input === "touch") {
      skipClick.current = true; // 놓기에서 이미 한 칸(또는 사각형)을 확정했다
      window.addEventListener("pointermove", move);
    }
    detachFinish.current = detach;
  }

  function onPointerEnter(pos: CellPos) {
    tracker.move(pos);
  }

  function onClick(pos: CellPos, event: MouseEvent<HTMLButtonElement>) {
    // 마우스 클릭과 선택 모드의 손가락 탭은 드래그가 처리했다. detail 0은 키보드(Enter·Space)
    if (readOnly) return;
    if (event.detail !== 0 && (lastPointerType.current === "mouse" || skipClick.current)) {
      skipClick.current = false;
      return;
    }
    const ms = cellMs(grid, pos);
    if (isPastSlot(ms, nowMs)) return;
    onCommit(toggleSlot(selection, ms));
  }

  function toggleSelectMode() {
    const next = !selectMode;
    setSelectMode(next);
    if (next && hint === "before") setHint("showing");
    if (!next && hint === "showing") setHint("done");
  }

  return (
    <>
      {touchDevice && !readOnly && (
        <div className="mb-3">
          <button
            type="button"
            aria-pressed={selectMode}
            onClick={toggleSelectMode}
            className={`flex h-icon w-full items-center justify-center gap-2 rounded-field border text-sm ${
              selectMode
                ? "border-blue bg-blue-soft font-bold text-ink"
                : "border-line bg-paper text-sub"
            }`}
          >
            드래그로 선택
            <span aria-hidden="true" className="text-xs font-normal">
              {selectMode ? "켜짐" : "꺼짐"}
            </span>
          </button>
          {selecting && hint === "showing" && (
            <p role="status" className="mt-2 text-xs text-ink">
              그리드 위에서는 끌어서 고르고, 스크롤은 날짜·시각 줄이나 그리드 밖에서 해 주세요.
            </p>
          )}
        </div>
      )}
      <GridFrame
        grid={grid}
        selecting={selecting}
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
    </>
  );
}
