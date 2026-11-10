// 모두의 가능 시간 집계 (TIME-12-02). 브라우저에서도 import하는 순수 함수다
// 서버는 제출한 참여자만 availableSlots를 채우고 미제출·빈 제출은 []로 준다. 화면은 이 값만 센다

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

export const HEAT_LEVELS = 5; // 0(아무도 없음) ~ 4(전원)

// 분모는 전체 참여자 수 (TIME-12-02). 1명 이상이면 최소 1단계, 전원이면 마지막 단계
export function heatLevel(count: number, total: number): number {
  if (count <= 0 || total <= 0) return 0;
  if (count >= total) return HEAT_LEVELS - 1;
  const steps = HEAT_LEVELS - 2; // 전원 미만에 쓰는 단계 수(1~3)
  return 1 + Math.min(steps - 1, Math.floor((count / total) * steps));
}
