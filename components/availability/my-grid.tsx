"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cellAtPoint, createDragTracker, dragInput, type Drag } from "@/lib/availability/drag";
import {
  applyRect,
  cellMs,
  editableDaySlots,
  isPastSlot,
  slotRangeLabel,
  toggleDay,
  type CellPos,
  type Grid,
} from "@/lib/availability/grid";
import {
  autoScrollSpeed,
  groupMode,
  groupRangeLabel,
  groupRows,
  groupState,
  groupStateText,
  pressGroup,
  toSlotRect,
  UNITS,
  type DayPage,
  type GroupState,
  type Unit,
} from "@/lib/availability/view";
import { seoulDateOf } from "@/lib/time/seoul";
import { DayHeaderText, GridFrame, type FrameRow } from "./grid-frame";
import { useCoarsePointer } from "./media";

// 내 가능 시간 그리드 (TIME-10-04, TIME-09-01, TIME-08-01)
// 마우스: 드래그한 사각형을 첫 칸의 반대 상태로 통일. 터치·펜·키보드: 칸을 눌러 하나씩 토글
// 터치 기기는 「드래그로 선택」을 켜면 손가락으로도 마우스와 같은 규칙으로 끌어서 고른다(033, R-38).
// 켰을 때만 칸 영역의 스크롤을 막고, 날짜 머리글·시각 열·그리드 밖에서는 스크롤된다
// 날짜 머리글: 그날 전체 선택/해제. 지난 칸은 회색이며 바꿀 수 없다
// 034 휴대폰(R-39): 4일 구간(page)만 그리고, 30분 칸 1·2·4개를 묶은 칸(unit)으로 보여 줄 수 있다.
//   드래그·누름은 화면 위치(구간 안 날짜 · 묶음 순서)로 받아 toSlotRect로 30분 칸 사각형으로 바꾼 뒤 applyRect에 넘긴다.
//   드래그 중 손가락·마우스가 보이는 영역 위·아래 끝(48px)에 가면 페이지를 자동 스크롤한다(휴대폰·데스크톱 모두)

// 자동 스크롤은 누른 자리에서 이만큼 움직인 뒤부터 — 화면 아래쪽 칸을 톡 누를 때 화면이 밀리지 않게
const AUTO_SCROLL_ARM_PX = 10;
const GROUP_ROW_CLASS: Record<Unit, string> = { 1: "h-slot", 2: "h-10", 4: "h-12" };

// 보이는 영역의 아래 끝: 아래에 붙은 제출 바(data-drag-dock)가 있으면 그 위
function visibleBottom(): number {
  const height = window.innerHeight;
  const dock = document.querySelector("[data-drag-dock]");
  if (!dock) return height;
  const top = dock.getBoundingClientRect().top;
  return top > 0 && top < height ? top : height;
}

export function MyGrid({
  grid,
  selection,
  nowMs,
  readOnly,
  onCommit,
  onDragActive,
  page,
  unit = 1,
  onUnitChange,
  onToggleDay,
  nav,
}: {
  grid: Grid;
  selection: ReadonlySet<number>;
  nowMs: number;
  readOnly: boolean;
  onCommit: (next: Set<number>) => void;
  onDragActive: (active: boolean) => void;
  page?: DayPage; // 휴대폰 날짜 구간(034). 있으면 도구 줄(표시 단위 + 드래그로 선택)과 nav를 그린다
  unit?: Unit;
  onUnitChange?: (unit: Unit) => void;
  onToggleDay?: (day: number) => void; // 없으면 하루 토글을 바로 확정
  nav?: ReactNode; // 날짜 넘기기 줄
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

  // 화면 좌표계: 날짜 = 구간 안 위치(0부터), 행 = 묶음 순서. 30분 보기는 묶음 = 30분 칸
  const offset = page?.start ?? 0;
  const dayCount = page?.count ?? grid.days.length;
  const groups = useMemo(() => groupRows(grid.rows.length, unit), [grid.rows.length, unit]);
  const frameRows = useMemo<FrameRow[] | undefined>(
    () =>
      unit === 1
        ? undefined
        : groups.map((g) => ({
            key: grid.rows[g.start].minute,
            label: grid.rows[g.start].label,
            line: true,
          })),
    [unit, groups, grid.rows],
  );

  const shown = useMemo(() => {
    if (!drag) return selection;
    // drag.current는 React Compiler가 ref로 읽으므로 한 번에 꺼낸다
    const { anchor, current: to, mode } = drag;
    const rect = toSlotRect(groups, offset, anchor, to);
    return applyRect(selection, grid, rect.anchor, rect.current, mode, nowMs);
  }, [drag, selection, grid, groups, offset, nowMs]);

  // 드래그 중에 화면이 사라지면 놓기 리스너만 뗀다
  useEffect(() => () => detachFinish.current?.(), []);

  const stateOf = (set: ReadonlySet<number>, view: CellPos): GroupState =>
    groupState(set, grid, view.day + offset, groups[view.row], nowMs);

  function onPointerDown(view: CellPos, event: PointerEvent<HTMLButtonElement>) {
    lastPointerType.current = event.pointerType;
    skipClick.current = false;
    const input = readOnly ? null : dragInput(event, selecting);
    if (!input) return;
    // 두 번째 손가락은 무시한다(첫 손가락의 드래그를 이어 간다)
    if (input === "touch" && detachFinish.current) return;
    const state = stateOf(selection, view);
    if (state.kind === "past") return;
    event.preventDefault(); // 텍스트 선택 방지
    detachFinish.current?.();
    onDragActive(true);
    tracker.start(view, groupMode(state));
    // 드래그 끝: 그리드 밖에서 버튼을 놓거나 창을 벗어나도 끝낸다. 누른 그 자리에서 바로 달아
    // 렌더를 기다리지 않는다. 드래그 중에는 폴링 반영을 보류하므로 선택은 누른 시점 값을 기준으로 한다
    const base = selection;
    const pointerId = event.pointerId;
    const rectGroups = groups;
    const rectOffset = offset;
    // 터치는 누른 칸이 포인터를 붙잡아 다른 칸의 pointerenter가 오지 않는다. 손가락 좌표로 칸을 찾는다.
    // 칸 크기는 칸을 감싼 틀(테두리 포함, 모든 칸이 같음) 기준. 자동 스크롤로 칸이 움직이므로 위치는 매번 다시 잰다
    const cell = event.currentTarget.parentElement ?? event.currentTarget;
    const size = { days: dayCount, rows: groups.length };
    const startX = event.clientX;
    const startY = event.clientY;
    let x = startX;
    let y = startY;
    let armed = false;
    let frame = 0;
    const follow = () => {
      const r = cell.getBoundingClientRect();
      const box = { pos: view, left: r.left, top: r.top, width: r.width, height: r.height };
      tracker.move(cellAtPoint(box, size, x, y));
    };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      if (!armed && Math.hypot(x - startX, y - startY) >= AUTO_SCROLL_ARM_PX) armed = true;
      if (input === "touch") follow();
    };
    // 끝 가까이에 있는 동안 프레임마다 스크롤하고, 스크롤로 손가락 아래에 온 칸까지 선택에 넣는다
    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      if (!armed) return;
      const speed = autoScrollSpeed(y, 0, visibleBottom());
      if (speed === 0) return;
      const before = window.scrollY;
      window.scrollBy(0, speed);
      if (window.scrollY !== before) follow();
    };
    const finish = (e: Event) => {
      if (input === "touch" && e instanceof globalThis.PointerEvent && e.pointerId !== pointerId)
        return;
      detach();
      const last = tracker.end();
      if (!last) return;
      onDragActive(false);
      const rect = toSlotRect(rectGroups, rectOffset, last.anchor, last.current);
      onCommit(applyRect(base, grid, rect.anchor, rect.current, last.mode, nowMs));
    };
    const detach = () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      window.removeEventListener("pointermove", move);
      window.cancelAnimationFrame(frame);
      detachFinish.current = null;
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    window.addEventListener("pointermove", move);
    frame = window.requestAnimationFrame(tick);
    // 놓기에서 이미 한 칸(또는 사각형)을 확정했다
    if (input === "touch") skipClick.current = true;
    detachFinish.current = detach;
  }

  function onPointerEnter(view: CellPos) {
    tracker.move(view);
  }

  function onClick(view: CellPos, event: MouseEvent<HTMLButtonElement>) {
    // 마우스 클릭과 선택 모드의 손가락 탭은 드래그가 처리했다. detail 0은 키보드(Enter·Space)
    if (readOnly) return;
    if (event.detail !== 0 && (lastPointerType.current === "mouse" || skipClick.current)) {
      skipClick.current = false;
      return;
    }
    if (stateOf(selection, view).kind === "past") return;
    onCommit(pressGroup(selection, grid, view.day + offset, groups[view.row], nowMs));
  }

  function toggleSelectMode() {
    const next = !selectMode;
    setSelectMode(next);
    if (next && hint === "before") setHint("showing");
    if (!next && hint === "showing") setHint("done");
  }

  const dragButton = touchDevice && !readOnly && (
    <button
      type="button"
      aria-pressed={selectMode}
      onClick={toggleSelectMode}
      className={`flex h-icon items-center justify-center gap-1.5 rounded-field border text-sm ${
        page ? "shrink-0 px-3" : "w-full gap-2"
      } ${selectMode ? "border-blue bg-blue-soft font-bold text-ink" : "border-line bg-paper text-sub"}`}
    >
      드래그로 선택
      <span aria-hidden="true" className="text-xs font-normal">
        {selectMode ? "켜짐" : "꺼짐"}
      </span>
    </button>
  );
  const hintText = selecting && hint === "showing" && (
    <p role="status" className="mt-2 text-xs text-ink">
      그리드 위에서는 끌어서 고르고, 스크롤은 날짜·시각 줄이나 그리드 밖에서 해 주세요.
    </p>
  );

  return (
    <>
      {page ? (
        // 휴대폰 도구 줄: 표시 단위 + 드래그로 선택 (034)
        <div className="mb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="표시 단위"
              className="flex h-icon items-stretch rounded-field border border-line bg-paper p-1"
            >
              {UNITS.map((u) => (
                <button
                  key={u.unit}
                  type="button"
                  aria-pressed={unit === u.unit}
                  onClick={() => onUnitChange?.(u.unit)}
                  className={`rounded-control px-2.5 text-sm ${
                    unit === u.unit ? "bg-blue-soft font-bold text-ink" : "text-sub"
                  }`}
                >
                  {u.label}
                </button>
              ))}
            </div>
            {dragButton}
          </div>
          {hintText}
        </div>
      ) : (
        dragButton && (
          <div className="mb-3">
            {dragButton}
            {hintText}
          </div>
        )
      )}
      {nav}
      <GridFrame
        grid={grid}
        selecting={selecting}
        label="내 가능 시간"
        today={nowMs > 0 ? seoulDateOf(new Date(nowMs)) : null}
        page={page}
        rows={frameRows}
        rowClass={GROUP_ROW_CLASS[unit]}
        renderHeader={(day, index) => {
          const editable = !readOnly && editableDaySlots(grid, index, nowMs).length > 0;
          if (!editable) return <DayHeaderText day={day} />;
          return (
            <button
              type="button"
              className="h-full w-full hover:bg-faint"
              aria-label={`${day.label}(${day.weekday}) 하루 전체 선택 또는 해제`}
              onClick={() =>
                onToggleDay
                  ? onToggleDay(index)
                  : onCommit(toggleDay(selection, grid, index, nowMs))
              }
            >
              <DayHeaderText day={day} />
            </button>
          );
        }}
        renderCell={(d, r) => {
          const view = { day: d - offset, row: r };
          const group = groups[r];
          const day = grid.days[d];
          const handlers = {
            onPointerDown: (e: PointerEvent<HTMLButtonElement>) => onPointerDown(view, e),
            onPointerEnter: () => onPointerEnter(view),
            onClick: (e: MouseEvent<HTMLButtonElement>) => onClick(view, e),
          };
          if (unit === 1) {
            const ms = cellMs(grid, { day: d, row: group.start });
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
            return (
              <button
                type="button"
                data-slot={ms}
                aria-pressed={on}
                aria-disabled={past || readOnly}
                aria-label={`${day.label}(${day.weekday}) ${slotRangeLabel(grid.rows[r].minute)} ${on ? "가능" : "불가능"}${past ? ", 지난 시간" : ""}`}
                className={`flex h-full w-full items-center justify-center ${color} ${past || readOnly ? "cursor-default" : "cursor-pointer"}`}
                {...handlers}
              >
                {on && <Check className="h-3 w-3 text-white" />}
              </button>
            );
          }
          const state = stateOf(shown, view);
          const past = state.kind === "past";
          return (
            <button
              type="button"
              data-group={cellMs(grid, { day: d, row: group.start })}
              aria-pressed={state.kind === "all" ? true : state.kind === "some" ? "mixed" : false}
              aria-disabled={past || readOnly}
              aria-label={`${day.label}(${day.weekday}) ${groupRangeLabel(grid, group)}, ${groupStateText(state)}`}
              className={`flex h-full w-full items-center justify-center text-xs font-medium ${GROUP_CLASS[state.kind]} ${
                !past && !readOnly && state.kind === "none" ? "hover:bg-faint" : ""
              } ${past || readOnly ? "cursor-default" : "cursor-pointer"}`}
              {...handlers}
            >
              <GroupMark state={state} />
            </button>
          );
        }}
      />
    </>
  );
}

// 묶은 칸 모양 (034): 전부 = 파랑 + 체크, 일부 = 연한 파랑 + 파란 테두리 + n/m, 없음 = 빈칸, 전부 지남 = 회색 + —
const GROUP_CLASS: Record<GroupState["kind"], string> = {
  all: "bg-blue",
  some: "bg-blue-soft text-ink shadow-[inset_0_0_0_2px_var(--color-blue)]",
  none: "bg-paper",
  past: "bg-muted text-sub",
};

function GroupMark({ state }: { state: GroupState }) {
  if (state.kind === "all") return <Check className="h-3.5 w-3.5 text-white" />;
  if (state.kind === "some")
    return (
      <span aria-hidden="true">
        {state.selected}/{state.total}
      </span>
    );
  if (state.kind === "past") return <span aria-hidden="true">—</span>;
  return null;
}

// 선택 표시(색만으로 구분하지 않게, 034)
export function Check({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M2.5 6.2 5 8.5l4.5-5" />
    </svg>
  );
}
