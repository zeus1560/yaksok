import { isSlotInRange, SLOT_MINUTES, type SlotRange } from "@/lib/time/slots";
import { seoulMidnight } from "@/lib/time/seoul";

// 날짜·하루 시간 범위를 바꿀 때 기존 입력을 어떻게 정리할지 계산한다 (STATE-09-03·09-04, ERD 6.3 4~7)
// 재조율(STATE-API-06)과 모집 중 설정 변경(STATE-API-03)이 같이 쓴다. DB를 읽지 않는 순수 함수다
//
// - A = 바꾸기 전 범위의 칸, B = 바꾼 뒤 범위의 칸
// - B 밖의 기존 슬롯만 지운다. B 안의 슬롯은 그대로 두고, 새 칸을 자동으로 고르지 않는다
// - B−A 중 선택 가능한 칸(시작 > now, TIME-API-01이 받는 칸)이 하나라도 있으면 확대·이동:
//   모든 참여자의 제출을 해제하고 버전을 올린다(미제출자도)
// - 아니면 축소만(또는 범위 그대로): 제출은 유지하고 슬롯이 실제로 지워진 참여자만 버전을 올린다
// participants는 정리 대상(호출자가 active 참여자만 넘긴다)

const MINUTE_MS = 60_000;

export type RangeChangeParticipant = {
  id: string;
  slots: { id: string; startAt: Date }[];
};

export type RangeChangePlan = {
  hasAddedSelectableSlots: boolean;
  submissionsReset: boolean; // 제출 해제 대상 = versionChangedParticipantIds 전체
  removedSlotIds: string[];
  versionChangedParticipantIds: string[];
};

function nextDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// B−A에 시작이 now보다 뒤인 칸이 있는가. B를 하루씩 훑는다(3개월 × 48칸 이하)
export function hasAddedSelectableSlots(before: SlotRange, after: SlotRange, now: Date): boolean {
  for (let day = after.startDate; day <= after.endDate; day = nextDate(day)) {
    const midnight = seoulMidnight(day).getTime();
    for (
      let minute = after.dailyStartMinute;
      minute + SLOT_MINUTES <= after.dailyEndMinute;
      minute += SLOT_MINUTES
    ) {
      const ms = midnight + minute * MINUTE_MS;
      if (ms > now.getTime() && !isSlotInRange(ms, before)) return true;
    }
  }
  return false;
}

export function planRangeChange({
  before,
  after,
  now,
  participants,
}: {
  before: SlotRange;
  after: SlotRange;
  now: Date;
  participants: RangeChangeParticipant[];
}): RangeChangePlan {
  const removedSlotIds: string[] = [];
  const touched: string[] = [];
  for (const person of participants) {
    const removed = person.slots.filter((slot) => !isSlotInRange(slot.startAt.getTime(), after));
    if (removed.length > 0) {
      touched.push(person.id);
      removedSlotIds.push(...removed.map((slot) => slot.id));
    }
  }

  const added = hasAddedSelectableSlots(before, after, now);
  return {
    hasAddedSelectableSlots: added,
    submissionsReset: added,
    removedSlotIds,
    versionChangedParticipantIds: added ? participants.map((person) => person.id) : touched,
  };
}
