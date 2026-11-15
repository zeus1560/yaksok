// 모두의 가능 시간 집계 (TIME-12-02). 브라우저에서도 import하는 순수 함수다
// 서버는 제출한 참여자만 availableSlots를 채우고 미제출·빈 제출은 []로 준다. 화면은 이 값만 센다

import { cellMs, isPastSlot, type Grid } from "./grid";
import { groupRangeLabel, type RowGroup } from "./view";

export type HeatParticipant = {
  participantId: string;
  nickname: string;
  isHost: boolean;
  slots: number[]; // epoch ms
};

export type SlotPeople = Map<number, HeatParticipant[]>;

// 칸(시작 시각) → 가능한 사람(서버 등록순 유지). 한 사람의 같은 칸은 한 번만 센다
export function peopleBySlot(participants: readonly HeatParticipant[]): SlotPeople {
  const map: SlotPeople = new Map();
  for (const person of participants) {
    for (const ms of new Set(person.slots)) {
      const list = map.get(ms);
      if (list) list.push(person);
      else map.set(ms, [person]);
    }
  }
  return map;
}

// 한 칸에 가장 많이 겹친 인원 (029 17-6 "현재 최대 n명 가능"). 아무도 없으면 0
export function maxAvailable(people: SlotPeople): number {
  let max = 0;
  for (const list of people.values()) max = Math.max(max, list.length);
  return max;
}

// ── 묶은 칸(1시간·2시간)의 사람 (034 모두의 시간, R-40)
// 지난 30분 칸은 셈에서 뺀다. 내내 가능 = 묶음 안의 지나지 않은 칸 모두에 가능, 일부만 가능 = 그중 일부에만.
// 일부만 가능한 사람은 이어진 칸을 구간(행 범위)으로 묶어 준다. 순서는 서버 등록순. 전부 지났으면 past
export type PartialPerson = { person: HeatParticipant; ranges: RowGroup[] };
export type GroupPeople = {
  kind: "open" | "past";
  total: number; // 지나지 않은 30분 칸 수
  full: HeatParticipant[];
  partial: PartialPerson[];
};

// participants = 서버 등록순 참여자, people = peopleBySlot(participants)
export function groupPeople(
  participants: readonly HeatParticipant[],
  people: SlotPeople,
  grid: Grid,
  day: number,
  group: RowGroup,
  serverNowMs: number,
): GroupPeople {
  const rows: { row: number; ids: Set<string> }[] = [];
  for (let row = group.start; row <= group.end; row += 1) {
    const ms = cellMs(grid, { day, row });
    if (isPastSlot(ms, serverNowMs)) continue;
    rows.push({ row, ids: new Set((people.get(ms) ?? []).map((p) => p.participantId)) });
  }
  if (rows.length === 0) return { kind: "past", total: 0, full: [], partial: [] };
  const full: HeatParticipant[] = [];
  const partial: PartialPerson[] = [];
  for (const person of participants) {
    const mine = rows.filter((r) => r.ids.has(person.participantId)).map((r) => r.row);
    if (mine.length === 0) continue;
    if (mine.length === rows.length) full.push(person);
    else partial.push({ person, ranges: runs(mine) });
  }
  return { kind: "open", total: rows.length, full, partial };
}

// 일부만 가능한 사람의 가능한 시간 「10:00–11:00, 11:30–12:00」
export function rangesText(grid: Grid, ranges: readonly RowGroup[]): string {
  return ranges.map((r) => groupRangeLabel(grid, r)).join(", ");
}

// 오름차순 행 → 이어진 행 구간
function runs(rows: number[]): RowGroup[] {
  const out: RowGroup[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.end + 1 === row) last.end = row;
    else out.push({ start: row, end: row });
  }
  return out;
}

export const HEAT_LEVELS = 5; // 0(아무도 없음) ~ 4(전원)

// 분모는 전체 참여자 수 (TIME-12-02). 1명 이상이면 최소 1단계, 전원이면 마지막 단계
export function heatLevel(count: number, total: number): number {
  if (count <= 0 || total <= 0) return 0;
  if (count >= total) return HEAT_LEVELS - 1;
  const steps = HEAT_LEVELS - 2; // 전원 미만에 쓰는 단계 수(1~3)
  return 1 + Math.min(steps - 1, Math.floor((count / total) * steps));
}
