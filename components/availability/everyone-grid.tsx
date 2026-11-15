"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cellMs, slotRangeLabel, type Grid } from "@/lib/availability/grid";
import { groupRangeLabel, groupRows, type DayPage, type Unit } from "@/lib/availability/view";
import {
  groupPeople,
  HEAT_LEVELS,
  heatLevel,
  maxAvailable,
  peopleBySlot,
  rangesText,
  type GroupPeople,
  type HeatParticipant,
} from "@/lib/availability/heat";
import { DayHeaderText, GridFrame } from "./grid-frame";
import { GROUP_ROW_CLASS, groupFrameRows } from "./unit-picker";

// 모두의 가능 시간 (TIME-API-02, 읽기 전용). 제출값만 센다 — 내 미제출 입력은 들어가지 않는다 (TIME-10-02)
// 색 농도 = 칸별 가능 인원 / 전체 참여자 (TIME-12-02). 칸을 누르면 가능한 사람 이름을 보여 준다(이름·방장 표시만, R-29)
// 034 휴대폰: 「내 시간」과 같은 4일 구간(page)·같은 표시 단위(unit)로 그린다(R-40).
//   1시간·2시간 칸의 숫자·색 = 그 시간 내내(묶은 지나지 않은 30분 칸 모두) 가능한 사람 수, 전부 지났으면 「—」.
//   칸을 누르면 휴대폰은 화면 아래에서 올라오는 창(sheet), 넓은 화면은 그리드 아래 상세 칸에 같은 내용 —
//   묶은 칸은 「내내 가능」과 「일부만 가능(가능한 시간)」을 나눠 보여 준다.
//   30분 칸은 지금과 같다(지난 칸도 인원 표시). 「현재 최대 N명 가능」은 단위·구간과 관계없이 30분 칸 전체 기준

// 029 17-1: Figma TimeSlot Heat1~4(#eef2f8·#e6edff·#4063d8·#294baf). 0명은 칩 없음. 3·4단계는 흰 글자
const HEAT_CLASS = ["bg-paper", "bg-muted", "bg-blue-soft", "bg-blue", "bg-ink"];

type Picked = { day: number; row: number; unit: Unit };

export function EveryoneGrid({
  grid,
  participants,
  total,
  today,
  page,
  unit = 1,
  nowMs = 0,
  sheet = false,
}: {
  grid: Grid;
  page?: DayPage;
  today: string | null;
  participants: HeatParticipant[];
  total: number;
  unit?: Unit;
  nowMs?: number; // 지난 칸 판정(묶은 칸)
  sheet?: boolean; // 사람 목록을 화면 아래 창으로(휴대폰에서 이 탭이 보일 때)
}) {
  const people = useMemo(() => peopleBySlot(participants), [participants]);
  const groups = useMemo(() => groupRows(grid.rows.length, unit), [grid.rows.length, unit]);
  const frameRows = useMemo(() => groupFrameRows(grid, groups, unit), [grid, groups, unit]);
  const [picked, setPicked] = useState<Picked | null>(null);

  // 범위·단위가 바뀌어 고른 칸이 사라졌으면 고르지 않은 것으로 본다
  const pickedValid =
    picked && picked.unit === unit && picked.day < grid.days.length && picked.row < groups.length
      ? picked
      : null;
  const max = maxAvailable(people);

  let detail: Detail | null = null;
  if (pickedValid) {
    const day = grid.days[pickedValid.day];
    const group = groups[pickedValid.row];
    const date = `${day.label}(${day.weekday})`;
    detail =
      unit === 1
        ? {
            kind: "slot",
            title: `${date} ${slotRangeLabel(grid.rows[group.start].minute)}`,
            list: people.get(cellMs(grid, { day: pickedValid.day, row: group.start })) ?? [],
          }
        : {
            kind: "group",
            title: `${date} ${groupRangeLabel(grid, group)}`,
            result: groupPeople(participants, people, grid, pickedValid.day, group, nowMs),
          };
  }

  return (
    <div>
      <GridFrame
        grid={grid}
        label="모두의 가능 시간"
        today={today}
        page={page}
        rows={frameRows}
        rowClass={GROUP_ROW_CLASS[unit]}
        renderHeader={(day) => <DayHeaderText day={day} />}
        renderCell={(d, r) => {
          const group = groups[r];
          const ms = cellMs(grid, { day: d, row: group.start });
          const day = grid.days[d];
          const selected = pickedValid?.day === d && pickedValid.row === r;
          const toggle = () => setPicked(selected ? null : { day: d, row: r, unit });
          if (unit === 1) {
            const count = people.get(ms)?.length ?? 0;
            return (
              <HeatCell
                ms={ms}
                grouped={false}
                count={count}
                level={heatLevel(count, total)}
                selected={selected}
                label={`${day.label}(${day.weekday}) ${slotRangeLabel(grid.rows[r].minute)} 가능 ${count}명`}
                onClick={toggle}
              />
            );
          }
          const result = groupPeople(participants, people, grid, d, group, nowMs);
          const range = `${day.label}(${day.weekday}) ${groupRangeLabel(grid, group)}`;
          if (result.kind === "past") {
            return (
              <button
                type="button"
                data-group={ms}
                aria-disabled="true"
                aria-label={`${range}, 지난 시간`}
                className="flex h-full w-full cursor-default items-center justify-center bg-muted text-xs text-sub"
              >
                <span aria-hidden="true">—</span>
              </button>
            );
          }
          const count = result.full.length;
          const partial = result.partial.length;
          return (
            <HeatCell
              ms={ms}
              grouped
              count={count}
              level={heatLevel(count, total)}
              selected={selected}
              label={`${range} 내내 가능 ${count}명${partial > 0 ? `, 일부만 가능 ${partial}명` : ""}`}
              onClick={toggle}
            />
          );
        }}
      />

      <div className="mt-3 flex items-center gap-2 text-xs text-sub">
        <span>0명</span>
        <span className="flex overflow-hidden rounded-xs border border-line">
          {Array.from({ length: HEAT_LEVELS }, (_, i) => (
            <span key={i} className={`h-3 w-5 ${HEAT_CLASS[i]}`} />
          ))}
        </span>
        <span>{total}명 전원</span>
        <span className="ml-auto font-medium text-text">
          {max > 0 ? `현재 최대 ${max}명 가능` : "아직 겹치는 시간이 없어요"}
        </span>
      </div>
      {unit !== 1 && (
        <p className="mt-2 text-xs text-sub">
          숫자는 그 시간 내내 가능한 사람 수예요. 칸을 누르면 일부만 가능한 사람도 볼 수 있어요.
        </p>
      )}

      {sheet ? (
        <>
          <p className="mt-3 text-sm text-sub">칸을 누르면 그 시간에 가능한 사람을 볼 수 있어요.</p>
          {detail && (
            <PeopleSheet onClose={() => setPicked(null)}>
              {(titleId) => (
                <PeopleDetail detail={detail} total={total} grid={grid} titleId={titleId} />
              )}
            </PeopleSheet>
          )}
        </>
      ) : (
        <div aria-live="polite" className="mt-3 rounded-field bg-muted px-4 py-3 text-sm">
          {detail ? (
            <PeopleDetail detail={detail} total={total} grid={grid} />
          ) : (
            <p className="text-sub">칸을 누르면 그 시간에 가능한 사람을 볼 수 있어요.</p>
          )}
        </div>
      )}
    </div>
  );
}

function HeatCell({
  ms,
  grouped,
  count,
  level,
  selected,
  label,
  onClick,
}: {
  ms: number;
  grouped: boolean;
  count: number;
  level: number;
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-slot={grouped ? undefined : ms}
      data-group={grouped ? ms : undefined}
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={`block h-full w-full p-0.5 ${selected ? "outline-2 -outline-offset-2 outline-text" : ""}`}
    >
      {count > 0 && (
        <span
          className={`flex h-full w-full items-center justify-center rounded-control text-xs font-medium ${HEAT_CLASS[level]} ${
            level >= 3 ? "text-white" : "text-ink"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

type Detail =
  | { kind: "slot"; title: string; list: HeatParticipant[] }
  | { kind: "group"; title: string; result: GroupPeople };

const EMPTY = "이 시간에 가능한 사람이 없어요.";

// 칸 상세: 30분 = 그 30분에 가능한 사람, 묶은 칸 = 내내 가능 / 일부만 가능(가능한 시간). 이름·방장 표시만(R-29)
function PeopleDetail({
  detail,
  total,
  grid,
  titleId,
}: {
  detail: Detail;
  total: number;
  grid: Grid;
  titleId?: string;
}) {
  if (detail.kind === "slot") {
    return (
      <div data-people-detail>
        <p id={titleId} className="font-medium">
          {detail.title} · 가능 {detail.list.length}/{total}명
        </p>
        {detail.list.length > 0 ? (
          <Names people={detail.list.map((p) => ({ person: p }))} />
        ) : (
          <p className="mt-1 text-sub">{EMPTY}</p>
        )}
      </div>
    );
  }
  const { full, partial } = detail.result;
  return (
    <div data-people-detail>
      <p id={titleId} className="font-medium">
        {detail.title} · 내내 가능 {full.length}/{total}명
      </p>
      {full.length === 0 && partial.length === 0 ? (
        <p className="mt-1 text-sub">{EMPTY}</p>
      ) : (
        <>
          {full.length > 0 && (
            <section aria-label="내내 가능" className="mt-2">
              <h3 className="text-xs font-medium text-sub">내내 가능</h3>
              <Names people={full.map((p) => ({ person: p }))} />
            </section>
          )}
          {partial.length > 0 && (
            <section aria-label="일부만 가능" className="mt-2">
              <h3 className="text-xs font-medium text-sub">일부만 가능</h3>
              <Names
                people={partial.map((p) => ({
                  person: p.person,
                  note: rangesText(grid, p.ranges),
                }))}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Names({ people }: { people: { person: HeatParticipant; note?: string }[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {people.map(({ person, note }) => (
        <li
          key={person.participantId}
          className="rounded-field border border-line bg-paper px-2.5 py-0.5 text-sm"
        >
          {person.nickname}
          {person.isHost && <span className="ml-1 text-xs text-blue">방장</span>}
          {note && <span className="ml-1.5 text-xs text-sub">{note}</span>}
        </li>
      ))}
    </ul>
  );
}

// 휴대폰 사람 목록 창: 화면 아래에서 올라오는 작은 창(뒤 화면은 그대로 쓸 수 있음). 닫기·Esc로 닫는다
function PeopleSheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: (titleId: string) => ReactNode;
}) {
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      data-people-sheet
      className="fixed inset-x-0 bottom-0 z-40 max-h-[60vh] overflow-y-auto rounded-t-card border-t border-line bg-paper px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm shadow-[0_-8px_24px_rgb(32_43_60/0.12)]"
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{children(titleId)}</div>
        <button
          ref={close}
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="flex h-icon w-icon shrink-0 items-center justify-center rounded-field text-lg text-sub"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </div>
  );
}
