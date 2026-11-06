import { isCalendarDate, seoulMidnight } from "@/lib/time/seoul";
import { SLOT_MINUTES } from "@/lib/time/slots";

// 공식 시간 후보 계산 (STATE-API-00 「후보 계산 계약」, ERD 7.1, RESULT-01-01·01-02·03-01·04-01·04-02·06-01·06-02)
// DB를 읽지 않는 순수 함수다. 후보 조회(STATE-API-10)와 확정 직전 재검증(STATE-API-05)이 같은 함수를 쓰고,
// 확정 일정의 참석 가능 인원(STATE-API-01)도 같은 집계 기준(countAvailableParticipants)으로 센다
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

// 후보가 아닌 이유 (STATE-API-05 422 INVALID_CONFIRMATION_CANDIDATE의 내부 구분. 응답에는 넣지 않는다)
export type CandidateRejection =
  | "not_future"
  | "not_slot_boundary"
  | "out_of_date_range"
  | "out_of_daily_range"
  | "too_few_participants";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SLOT_MS = SLOT_MINUTES * MINUTE_MS;
const SEOUL_OFFSET_MS = 9 * 60 * MINUTE_MS; // Asia/Seoul은 일광절약시간이 없다 (TIME-01-01)

// 1. active이고 제출 시각이 있는 참여자만 센다. 탈퇴자(cancelled)의 보존 슬롯과 미제출자의 저장 슬롯은 빠진다
// 2. 후보 시작은 날짜 범위 전체에서 한국 시간 30분 경계이고 시작 > now (지난 슬롯 판정 시작 ≤ now와 같은 경계, TIME-08-01)
// 3. 시작 ~ 시작 + 소요 시간 전체가 같은 날짜의 하루 선택 범위 안이어야 한다 (24:00 종료 포함)
// 4. 구간의 모든 30분 슬롯에 공통으로 가능한 같은 참여자 수(슬롯별 참여자 집합의 교집합 크기)
// 5. 2명 이상만 후보. 방장도 한 명으로 세지만 방장 참석은 조건이 아니다
// 6. 인원 내림차순 → 시작 시각 오름차순
// 2~5의 판정은 evaluateStart 하나에만 있고, 확정 재검증(validateCandidateStart)도 같은 함수를 부른다.
// 여기서는 날짜 범위·하루 범위 안의 30분 시작점을 차례로 넘길 뿐 걸러 내는 조건을 따로 두지 않는다
// 1·4는 countAvailableParticipants와 같은 색인(buildSlotIndex)·교집합(countCommon)을 쓴다
export function computeCandidates(input: {
  settings: CandidateSettings;
  participants: readonly CandidateParticipant[];
  now: Date;
}): Candidate[] {
  const context = candidateContext(input);
  if (context.index.size < MIN_CANDIDATE_PARTICIPANTS) return [];

  const { settings } = context;
  const candidates: Candidate[] = [];

  // 서울은 일광절약시간이 없어 날짜마다 24시간씩 더하면 다음 날 00:00이다
  for (let day = context.firstDay; day <= context.lastDay; day += DAY_MS) {
    for (
      let minute = settings.dailyStartMinute;
      minute + settings.durationMinutes <= settings.dailyEndMinute;
      minute += SLOT_MINUTES
    ) {
      const verdict = evaluateStart(context, day + minute * MINUTE_MS);
      if (verdict.ok) candidates.push(verdict.candidate);
    }
  }

  return candidates.sort(
    (a, b) =>
      b.availableParticipantCount - a.availableParticipantCount ||
      a.startAt.getTime() - b.startAt.getTime(),
  );
}

export type CandidateVerdict =
  | { ok: true; candidate: Candidate }
  | { ok: false; reason: CandidateRejection };

// 확정 직전 재검증 (STATE-API-05 처리 순서 4·5·6). 시작 시각 하나가 computeCandidates 결과에 들어갈 후보인지 판정한다
// computeCandidates와 같은 evaluateStart를 쓰므로 "후보 목록에 있다 ⇔ 통과"다. 순위(상위 5개)는 보지 않는다
// now는 호출자가 잠금 후 읽은 clock_timestamp()
export function validateCandidateStart(input: {
  settings: CandidateSettings;
  participants: readonly CandidateParticipant[];
  now: Date;
  startAt: Date;
}): CandidateVerdict {
  return evaluateStart(candidateContext(input), input.startAt.getTime());
}

type CandidateContext = {
  settings: CandidateSettings;
  index: SlotIndex;
  firstDay: number; // 날짜 범위 첫날 서울 00:00 (epoch 밀리초)
  lastDay: number; // 날짜 범위 마지막 날 서울 00:00
  nowMs: number;
};

function candidateContext(input: {
  settings: CandidateSettings;
  participants: readonly CandidateParticipant[];
  now: Date;
}): CandidateContext {
  const { settings } = input;
  assertSettings(settings);
  return {
    settings,
    index: buildSlotIndex(input.participants),
    firstDay: seoulMidnight(settings.dateRangeStart).getTime(),
    lastDay: seoulMidnight(settings.dateRangeEnd).getTime(),
    nowMs: input.now.getTime(),
  };
}

// 후보 시작점 하나의 판정 (위 2~5). 후보 조회와 확정이 함께 쓰는 유일한 판정 코드다
// 서울 오프셋(+9시간)이 30분의 배수라 epoch 밀리초가 30분으로 나누어떨어지면 한국 시간 00·30분 경계다
function evaluateStart(context: CandidateContext, start: number): CandidateVerdict {
  const { settings, index } = context;
  if (start <= context.nowMs) return { ok: false, reason: "not_future" };
  if (!Number.isSafeInteger(start) || start % SLOT_MS !== 0) {
    return { ok: false, reason: "not_slot_boundary" };
  }

  const day = Math.floor((start + SEOUL_OFFSET_MS) / DAY_MS) * DAY_MS - SEOUL_OFFSET_MS;
  if (day < context.firstDay || day > context.lastDay) {
    return { ok: false, reason: "out_of_date_range" };
  }
  const minute = (start - day) / MINUTE_MS;
  if (minute < settings.dailyStartMinute || minute + settings.durationMinutes > settings.dailyEndMinute) {
    return { ok: false, reason: "out_of_daily_range" };
  }

  const count = countCommon(index, start, settings.durationMinutes / SLOT_MINUTES);
  if (count < MIN_CANDIDATE_PARTICIPANTS) return { ok: false, reason: "too_few_participants" };
  return {
    ok: true,
    candidate: {
      startAt: new Date(start),
      endAt: new Date(start + settings.durationMinutes * MINUTE_MS),
      availableParticipantCount: count,
    },
  };
}

// 주어진 구간 하나(startAt ~ startAt + durationMinutes)의 공통 가능 인원 (STATE-API-01 currentConfirmation)
// 집계 대상·교집합 기준은 computeCandidates와 같다. 다만 미래 시작·날짜 범위·하루 범위·2명 이상 조건은 보지 않는다
// 확정 일정은 이미 지났을 수 있고, 확정 뒤 설정이 바뀌어 현재 범위 밖이어도 인원은 세야 하기 때문이다
// startAt이 30분 경계가 아니면 맞는 슬롯이 없어 0이다
export function countAvailableParticipants(input: {
  participants: readonly CandidateParticipant[];
  startAt: Date;
  durationMinutes: number;
}): number {
  const { durationMinutes } = input;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < SLOT_MINUTES ||
    durationMinutes % SLOT_MINUTES !== 0
  ) {
    throw new Error("소요 시간 값이 올바르지 않음");
  }
  const index = buildSlotIndex(input.participants);
  if (index.size === 0) return 0;
  return countCommon(index, input.startAt.getTime(), durationMinutes / SLOT_MINUTES);
}

// 집계 대상 참여자의 슬롯 색인. 슬롯 시작 시각 → 그 슬롯에 가능한 참여자 비트 집합
// 참여자 i는 words[i >>> 5]의 (i & 31)번째 비트다. size는 집계 대상 인원
type SlotIndex = { size: number; masks: Map<number, Uint32Array>; common: Uint32Array };

function buildSlotIndex(participants: readonly CandidateParticipant[]): SlotIndex {
  const eligible = participants.filter(
    (person) => person.status === "active" && person.submittedAt !== null,
  );
  const words = Math.max(1, Math.ceil(eligible.length / 32));
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
  return { size: eligible.length, masks, common: new Uint32Array(words) };
}

// start부터 slotCount개 연속 슬롯의 비트 집합을 모두 AND한 뒤 남은 비트 수. 중간에 비면 0
function countCommon(index: SlotIndex, start: number, slotCount: number): number {
  const { masks, common } = index;
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
