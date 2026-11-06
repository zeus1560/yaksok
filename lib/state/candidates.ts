import { isCalendarDate, seoulMidnight } from "@/lib/time/seoul";
import { SLOT_MINUTES } from "@/lib/time/slots";

// 공식 시간 후보 계산 (STATE-API-00 「후보 계산 계약」, ERD 7.1, RESULT-01-01·01-02·03-01·04-01·04-02·06-01·06-02)
// DB를 읽지 않는 순수 함수다. 후보 조회(STATE-API-10)와 확정 직전 재검증(STATE-API-05)이 같은 함수를 쓴다
// 시각은 epoch 밀리초와 서울 고정 오프셋으로만 다뤄 실행 기기의 시간대와 무관하다

export type CandidateSettings = {
  dateRangeStart: string; // YYYY-MM-DD (한국 날짜)
  dateRangeEnd: string;
  dailyStartMinute: number; // 0~1410, 30분 단위
  dailyEndMinute: number; // 30~1440 (24:00 = 1440)
  durationMinutes: number; // 30 이상, 30의 배수
};

export type CandidateParticipant = {
  status: string; // participants.status
  submittedAt: Date | null; // participants.availability_submitted_at
  slots: readonly Date[]; // participant_available_slots.slot_start_at
};

export type Candidate = {
  startAt: Date;
  endAt: Date; // startAt + durationMinutes
  availableParticipantCount: number; // 구간 전체 공통 가능 인원, 2 이상
};

export const MIN_CANDIDATE_PARTICIPANTS = 2; // RESULT-04-01 (R-04)

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SLOT_MS = SLOT_MINUTES * MINUTE_MS;

// 1. active이고 제출 시각이 있는 참여자만 센다. 탈퇴자(cancelled)의 보존 슬롯과 미제출자의 저장 슬롯은 빠진다
// 2. 후보 시작은 날짜 범위 전체에서 한국 시간 30분 경계이고 시작 > now (지난 슬롯 판정 시작 ≤ now와 같은 경계, TIME-08-01)
// 3. 시작 ~ 시작 + 소요 시간 전체가 같은 날짜의 하루 선택 범위 안이어야 한다 (24:00 종료 포함)
// 4. 구간의 모든 30분 슬롯에 공통으로 가능한 같은 참여자 수(슬롯별 참여자 집합의 교집합 크기)
// 5. 2명 이상만 후보. 방장도 한 명으로 세지만 방장 참석은 조건이 아니다
// 6. 인원 내림차순 → 시작 시각 오름차순
export function computeCandidates(input: {
  settings: CandidateSettings;
  participants: readonly CandidateParticipant[];
  now: Date;
}): Candidate[] {
  const { settings, now } = input;
  assertSettings(settings);

  const eligible = input.participants.filter(
    (person) => person.status === "active" && person.submittedAt !== null,
  );
  if (eligible.length < MIN_CANDIDATE_PARTICIPANTS) return [];

  // 슬롯 시작 시각 → 그 슬롯에 가능한 참여자 비트 집합. 참여자 i는 words[i >>> 5]의 (i & 31)번째 비트다
  const words = Math.ceil(eligible.length / 32);
  const masks = new Map<number, Uint32Array>();
  eligible.forEach((person, index) => {
    for (const slot of person.slots) {
      const key = slot.getTime();
      let mask = masks.get(key);
      if (!mask) {
        mask = new Uint32Array(words);
        masks.set(key, mask);
      }
      mask[index >>> 5] |= 1 << (index & 31);
    }
  });

  const slotsPerCandidate = settings.durationMinutes / SLOT_MINUTES;
  const firstDay = seoulMidnight(settings.dateRangeStart).getTime();
  const lastDay = seoulMidnight(settings.dateRangeEnd).getTime();
  const nowMs = now.getTime();
  const common = new Uint32Array(words);
  const candidates: Candidate[] = [];

  // 서울은 일광절약시간이 없어 날짜마다 24시간씩 더하면 다음 날 00:00이다
  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    for (
      let minute = settings.dailyStartMinute;
      minute + settings.durationMinutes <= settings.dailyEndMinute;
      minute += SLOT_MINUTES
    ) {
      const start = day + minute * MINUTE_MS;
      if (start <= nowMs) continue;

      const count = countCommon(masks, common, start, slotsPerCandidate);
      if (count >= MIN_CANDIDATE_PARTICIPANTS) {
        candidates.push({
          startAt: new Date(start),
          endAt: new Date(start + settings.durationMinutes * MINUTE_MS),
          availableParticipantCount: count,
        });
      }
    }
  }

  return candidates.sort(
    (a, b) =>
      b.availableParticipantCount - a.availableParticipantCount ||
      a.startAt.getTime() - b.startAt.getTime(),
  );
}

// start부터 slotCount개 연속 슬롯의 비트 집합을 모두 AND한 뒤 남은 비트 수. 중간에 비면 0
function countCommon(
  masks: Map<number, Uint32Array>,
  common: Uint32Array,
  start: number,
  slotCount: number,
): number {
  const first = masks.get(start);
  if (!first) return 0;
  common.set(first);
  for (let k = 1; k < slotCount; k += 1) {
    const mask = masks.get(start + k * SLOT_MS);
    if (!mask) return 0;
    let any = 0;
    for (let w = 0; w < common.length; w += 1) {
      common[w] &= mask[w];
      any |= common[w];
    }
    if (any === 0) return 0;
  }
  let count = 0;
  for (let w = 0; w < common.length; w += 1) count += popcount(common[w]);
  return count;
}

function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

// DB CHECK 제약(ck_promise_*)이 보장하는 값이다. 어긋나면 데이터 오류이므로 예외(500)로 둔다
function assertSettings(settings: CandidateSettings): void {
  const { dateRangeStart, dateRangeEnd, dailyStartMinute, dailyEndMinute, durationMinutes } =
    settings;
  const onSlot = (minute: number) => Number.isInteger(minute) && minute % SLOT_MINUTES === 0;
  if (
    !isCalendarDate(dateRangeStart) ||
    !isCalendarDate(dateRangeEnd) ||
    dateRangeStart > dateRangeEnd ||
    !onSlot(dailyStartMinute) ||
    !onSlot(dailyEndMinute) ||
    dailyStartMinute < 0 ||
    dailyEndMinute > 24 * 60 ||
    dailyStartMinute >= dailyEndMinute ||
    !onSlot(durationMinutes) ||
    durationMinutes < SLOT_MINUTES
  ) {
    throw new Error("후보 계산 설정 값이 올바르지 않음");
  }
}
