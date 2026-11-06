import { buildGrid, type Grid } from "@/lib/availability/grid";
import type { HeatParticipant } from "@/lib/availability/heat";
import {
  parseSlotList,
  type AvailabilityStatusValue,
  type ServerMe,
} from "@/lib/availability/sync";

// TIME-API-02 응답 (실제 구현 app/api/v1/promises/[promiseId]/availability/route.ts)
export type AvailabilityResponse = {
  status: AvailabilityStatusValue;
  serverTime: string;
  settings: {
    dateRangeStart: string;
    dateRangeEnd: string;
    dailyStartTime: string;
    dailyEndTime: string;
    durationMinutes: number;
    votingDeadlineAt: string;
  };
  totalParticipants: number;
  participants: {
    participantId: string;
    nickname: string;
    isHost: boolean;
    availableSlots: string[];
  }[];
  me: { participantId: string; version: number; submitted: boolean; slots: string[] };
};

// TIME-API-01 200 응답
export type SubmitResponse = {
  version: number;
  submitted: true;
  submittedAt: string;
  slots: string[];
  droppedSlotCount: number;
};

// 화면이 쓰는 형태. 슬롯은 epoch ms, 서버 시각은 받은 시점의 단조 시계 값과 함께 둔다
export type Snapshot = {
  status: AvailabilityStatusValue;
  serverTimeMs: number;
  receivedAt: number; // performance.now()
  settings: AvailabilityResponse["settings"];
  deadlineMs: number;
  grid: Grid;
  total: number;
  participants: HeatParticipant[];
  me: ServerMe & { participantId: string };
};

export function toSnapshot(data: AvailabilityResponse, receivedAt: number): Snapshot {
  return {
    status: data.status,
    serverTimeMs: Date.parse(data.serverTime),
    receivedAt,
    settings: data.settings,
    deadlineMs: Date.parse(data.settings.votingDeadlineAt),
    grid: buildGrid(data.settings),
    total: data.totalParticipants,
    participants: data.participants.map((p) => ({
      participantId: p.participantId,
      nickname: p.nickname,
      isHost: p.isHost,
      slots: parseSlotList(p.availableSlots),
    })),
    me: {
      participantId: data.me.participantId,
      version: data.me.version,
      submitted: data.me.submitted,
      slots: parseSlotList(data.me.slots),
    },
  };
}

// 제출 결과(200·409 충돌)로 내 값을 바꾼다. 다른 사람에게 보이는 내 값은 제출 상태일 때만 (TIME-12-02)
export function withMe(snapshot: Snapshot, me: ServerMe): Snapshot {
  return {
    ...snapshot,
    me: { ...snapshot.me, ...me },
    participants: snapshot.participants.map((p) =>
      p.participantId === snapshot.me.participantId
        ? { ...p, slots: me.submitted ? me.slots : [] }
        : p,
    ),
  };
}
