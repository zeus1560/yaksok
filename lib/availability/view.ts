import {
  applyRect,
  cellMs,
  editableDaySlots,
  isPastSlot,
  slotRangeLabel,
  type CellPos,
  type Grid,
} from "./grid";

// 휴대폰 그리드 보기 (034, R-39). 브라우저에서 import하는 순수 함수다
// - 날짜는 약속 범위의 첫날부터 4일씩 끊은 구간으로 넘긴다
// - 「내 시간」은 30분 칸 1·2·4개를 한 칸으로 묶어 보여 줄 수 있다. 저장 데이터는 30분 칸 그대로이고,
//   묶은 칸을 누르거나 끌면 "묶은 칸 → 30분 칸 범위"로 바꿔 데스크톱과 같은 applyRect 규칙에 넘긴다

export const PAGE_DAYS = 4;

export type DayPage = { start: number; count: number };

export function pageCount(dayCount: number, size = PAGE_DAYS): number {
  return Math.max(1, Math.ceil(dayCount / size));
}

// page번째 구간의 날짜 위치. 범위 밖 page는 첫·마지막 구간으로 고정한다(설정 변경으로 날짜가 줄어든 경우)
export function dayPage(dayCount: number, page: number, size = PAGE_DAYS): DayPage {
  const last = pageCount(dayCount, size) - 1;
  const index = Math.min(Math.max(page, 0), last);
  const start = index * size;
  return { start, count: Math.max(0, Math.min(size, dayCount - start)) };
}

// 처음 보여 줄 구간: 지나지 않은 칸이 있는 첫 날(오늘 또는 그 뒤)이 들어 있는 구간.
// 모든 날이 지났으면(마감·확정 뒤) 마지막 구간
export function initialPage(grid: Grid, serverNowMs: number, size = PAGE_DAYS): number {
  const first = grid.days.findIndex((_, d) => editableDaySlots(grid, d, serverNowMs).length > 0);
  const day = first === -1 ? grid.days.length - 1 : first;
  return Math.max(0, Math.floor(day / size));
}

// 묶는 30분 칸 수: 30분 = 1, 1시간 = 2, 2시간 = 4
export type Unit = 1 | 2 | 4;
export const UNITS: readonly { unit: Unit; label: string }[] = [
  { unit: 1, label: "30분" },
  { unit: 2, label: "1시간" },
  { unit: 4, label: "2시간" },
];

export function parseUnit(raw: string | null): Unit {
  return raw === "2" ? 2 : raw === "4" ? 4 : 1;
}

// 묶은 칸 = 30분 칸 행 범위(양 끝 포함). 하루 시작 시각부터 끊고, 끝에 남는 칸은 짧은 묶음
export type RowGroup = { start: number; end: number };

export function groupRows(rowCount: number, unit: Unit): RowGroup[] {
  const groups: RowGroup[] = [];
  for (let start = 0; start < rowCount; start += unit) {
    groups.push({ start, end: Math.min(start + unit, rowCount) - 1 });
  }
  return groups;
}

// 묶은 칸 상태. 지난 칸은 셈에서 뺀다 — total(m) = 지나지 않은 칸 수, selected(n) = 그중 선택된 칸 수
export type GroupState = {
  kind: "all" | "some" | "none" | "past";
  selected: number;
  total: number;
};

export function groupState(
  selection: ReadonlySet<number>,
  grid: Grid,
  day: number,
  group: RowGroup,
  serverNowMs: number,
): GroupState {
  let total = 0;
  let selected = 0;
  for (let row = group.start; row <= group.end; row += 1) {
    const ms = cellMs(grid, { day, row });
    if (isPastSlot(ms, serverNowMs)) continue;
    total += 1;
    if (selection.has(ms)) selected += 1;
  }
  const kind = total === 0 ? "past" : selected === total ? "all" : selected === 0 ? "none" : "some";
  return { kind, selected, total };
}

// 묶은 칸의 시각 범위 "10:00–12:00"(마지막 묶음은 하루 끝까지, 24:00 포함)
export function groupRangeLabel(grid: Grid, group: RowGroup): string {
  const end = slotRangeLabel(grid.rows[group.end].minute).split("–")[1];
  return `${grid.rows[group.start].label}–${end}`;
}

// 화면 낭독기용 상태 문구: "4칸 중 2칸 선택", "4칸 모두 선택", "4칸, 선택 없음", "지난 시간"
export function groupStateText(state: GroupState): string {
  if (state.kind === "past") return "지난 시간";
  if (state.kind === "all") return `${state.total}칸 모두 선택`;
  if (state.kind === "none") return `${state.total}칸, 선택 없음`;
  return `${state.total}칸 중 ${state.selected}칸 선택`;
}

// 묶은 칸을 누르거나 끌기 시작할 때 정할 상태(첫 칸의 반대 상태): 전부 선택이면 해제, 아니면 선택
export function groupMode(state: GroupState): boolean {
  return state.kind !== "all";
}

// 묶은 칸 누름: 전부 선택이면 안의 칸을 전부 해제, 아니면 지나지 않은 칸을 전부 선택(지난 칸은 그대로)
export function pressGroup(
  selection: ReadonlySet<number>,
  grid: Grid,
  day: number,
  group: RowGroup,
  serverNowMs: number,
): Set<number> {
  const mode = groupMode(groupState(selection, grid, day, group, serverNowMs));
  return applyRect(
    selection,
    grid,
    { day, row: group.start },
    { day, row: group.end },
    mode,
    serverNowMs,
  );
}

// 화면 위치(구간 안 날짜 · 묶음 순서)의 드래그 사각형 → 30분 칸 사각형. applyRect에 그대로 넘긴다
export function toSlotRect(
  groups: readonly RowGroup[],
  dayOffset: number,
  anchor: CellPos,
  current: CellPos,
): { anchor: CellPos; current: CellPos } {
  const [g0, g1] = [Math.min(anchor.row, current.row), Math.max(anchor.row, current.row)];
  return {
    anchor: { day: anchor.day + dayOffset, row: groups[g0].start },
    current: { day: current.day + dayOffset, row: groups[g1].end },
  };
}

// 드래그 중 자동 스크롤 속도(px/프레임). 보이는 영역 위·아래 끝에서 edge 안쪽이면 끝에 가까울수록 빠르다.
// 위로는 음수, 아래로는 양수, 그 밖은 0. top·bottom은 실제로 보이는 영역(아래 고정 제출 바 위)
export const AUTO_SCROLL_EDGE = 48;
export const AUTO_SCROLL_MAX = 18;
const AUTO_SCROLL_MIN = 2;

export function autoScrollSpeed(
  y: number,
  top: number,
  bottom: number,
  edge = AUTO_SCROLL_EDGE,
  max = AUTO_SCROLL_MAX,
): number {
  const speed = (depth: number) =>
    Math.round(Math.max(AUTO_SCROLL_MIN, (Math.min(depth, edge) / edge) * max));
  if (y < top + edge) return -speed(top + edge - y);
  if (y > bottom - edge) return speed(y - (bottom - edge));
  return 0;
}

// 날짜 머리글 하루 토글 되돌리기: 그날의 지나지 않은 칸을 토글 직전(before) 상태로. 다른 날은 지금 그대로
export function restoreDay(
  current: ReadonlySet<number>,
  grid: Grid,
  day: number,
  before: ReadonlySet<number>,
  serverNowMs: number,
): Set<number> {
  const next = new Set(current);
  for (const ms of editableDaySlots(grid, day, serverNowMs)) {
    if (before.has(ms)) next.add(ms);
    else next.delete(ms);
  }
  return next;
}
