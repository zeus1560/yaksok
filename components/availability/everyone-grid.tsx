"use client";

import { useMemo, useState } from "react";
import { cellMs, slotRangeLabel, type Grid } from "@/lib/availability/grid";
import type { DayPage } from "@/lib/availability/view";
import {
  HEAT_LEVELS,
  heatLevel,
  maxAvailable,
  peopleBySlot,
  type HeatParticipant,
} from "@/lib/availability/heat";
import { DayHeaderText, GridFrame } from "./grid-frame";

// 모두의 가능 시간 (TIME-API-02, 읽기 전용). 제출값만 센다 — 내 미제출 입력은 들어가지 않는다 (TIME-10-02)
// 색 농도 = 칸별 가능 인원 / 전체 참여자 (TIME-12-02). 칸을 누르면 가능한 사람 이름을 보여 준다
// 034 휴대폰: 「내 시간」과 같은 4일 구간(page)만 그린다. 30분 단위 그대로(묶은 인원 수는 오해를 부름, R-39).
//   「현재 최대 N명 가능」은 구간과 관계없이 전체 날짜 기준

// 029 17-1: Figma TimeSlot Heat1~4(#eef2f8·#e6edff·#4063d8·#294baf). 0명은 칩 없음. 3·4단계는 흰 글자
const HEAT_CLASS = ["bg-paper", "bg-muted", "bg-blue-soft", "bg-blue", "bg-ink"];

export function EveryoneGrid({
  grid,
  participants,
  total,
  today,
  page,
}: {
  grid: Grid;
  page?: DayPage;
  today: string | null;
  participants: HeatParticipant[];
  total: number;
}) {
  const people = useMemo(() => peopleBySlot(participants), [participants]);
  const [picked, setPicked] = useState<{ day: number; row: number } | null>(null);

  // 범위가 바뀌어 고른 칸이 사라졌으면 고르지 않은 것으로 본다
  const pickedValid =
    picked && picked.day < grid.days.length && picked.row < grid.rows.length ? picked : null;
  const pickedMs = pickedValid ? cellMs(grid, pickedValid) : null;
  const pickedPeople = pickedMs !== null ? (people.get(pickedMs) ?? []) : [];
  const max = maxAvailable(people);

  return (
    <div>
      <GridFrame
        grid={grid}
        label="모두의 가능 시간"
        today={today}
        page={page}
        renderHeader={(day) => <DayHeaderText day={day} />}
        renderCell={(d, r) => {
          const ms = cellMs(grid, { day: d, row: r });
          const count = people.get(ms)?.length ?? 0;
          const level = heatLevel(count, total);
          const selected = pickedMs === ms;
          const day = grid.days[d];
          return (
            <button
              type="button"
              data-slot={ms}
              aria-pressed={selected}
              aria-label={`${day.label}(${day.weekday}) ${slotRangeLabel(grid.rows[r].minute)} 가능 ${count}명`}
              onClick={() => setPicked(selected ? null : { day: d, row: r })}
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

      <div aria-live="polite" className="mt-3 rounded-field bg-muted px-4 py-3 text-sm">
        {pickedValid ? (
          <>
            <p className="font-medium">
              {grid.days[pickedValid.day].label}({grid.days[pickedValid.day].weekday}){" "}
              {slotRangeLabel(grid.rows[pickedValid.row].minute)} · 가능 {pickedPeople.length}/
              {total}명
            </p>
            {pickedPeople.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {pickedPeople.map((p) => (
                  <li
                    key={p.participantId}
                    className="rounded-field border border-line bg-paper px-2.5 py-0.5 text-sm"
                  >
                    {p.nickname}
                    {p.isHost && <span className="ml-1 text-xs text-blue">방장</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sub">이 시간에 가능한 사람이 없어요.</p>
            )}
          </>
        ) : (
          <p className="text-sub">칸을 누르면 그 시간에 가능한 사람을 볼 수 있어요.</p>
        )}
      </div>
    </div>
  );
}
