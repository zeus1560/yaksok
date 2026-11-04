import { addCalendarMonths, isCalendarDate, seoulDateOf, seoulMidnight } from "@/lib/time/seoul";

// STATE-API-02 설정 검증. 형식 오류(400)는 parse, 규칙 위반(422)은 validate가 맡는다
// validate는 잠금 후 판정 시각과 active 인원을 받아야 하므로 DB 없이 순수 함수로 둔다

export const PARTICIPANT_LIMIT_MIN = 2;
export const PARTICIPANT_LIMIT_MAX = 30;
export const DATE_RANGE_MONTHS = 3; // R-07: 한국 시간 오늘부터 3개월 이내, 달력 월 단위
export const SLOT_MINUTES = 30;
export const DAY_END_MINUTE = 1440; // 24:00

export type StartSettingsInput = {
  participantLimit: number;
  startDate: string;
  endDate: string;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  votingDeadlineAt: Date;
};

export type StartSettingsField =
  "participantLimit" | "dateRange" | "dailyTimeRange" | "durationMinutes" | "votingDeadlineAt";

export type SettingsViolation = { field: StartSettingsField; message: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/;
// 오프셋(Z 또는 ±HH:mm)이 반드시 있는 ISO 8601. 오프셋 없는 값은 서버 시간대에 따라 해석이 달라져 받지 않는다
const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMinute(time: unknown): number | null {
  if (typeof time !== "string") return null;
  const match = TIME.exec(time);
  if (!match) return null;
  const [hh, mm] = match[1] !== undefined ? [match[1], match[2]] : [match[3], match[4]];
  return Number(hh) * 60 + Number(mm);
}

function toDate(value: unknown): string | null {
  return typeof value === "string" && DATE.test(value) && isCalendarDate(value) ? value : null;
}

function toDeadline(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = DATE_TIME.exec(value);
  if (!match || !isCalendarDate(match[1])) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

export function minuteToTime(minute: number): string {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// 400 INVALID_REQUEST 대상: JSON 구조·타입·필수값, 존재하지 않는 날짜·시각, 오프셋 없는 마감
export function parseStartSettings(body: unknown): StartSettingsInput | null {
  if (!isObject(body)) return null;
  const { participantLimit, dateRange, dailyTimeRange, durationMinutes, votingDeadlineAt } = body;
  if (typeof participantLimit !== "number" || !Number.isFinite(participantLimit)) return null;
  if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes)) return null;
  if (!isObject(dateRange) || !isObject(dailyTimeRange)) return null;

  const startDate = toDate(dateRange.startDate);
  const endDate = toDate(dateRange.endDate);
  const startMinute = toMinute(dailyTimeRange.startTime);
  const endMinute = toMinute(dailyTimeRange.endTime);
  const deadline = toDeadline(votingDeadlineAt);
  if (!startDate || !endDate || startMinute === null || endMinute === null || !deadline) {
    return null;
  }

  return {
    participantLimit,
    startDate,
    endDate,
    startMinute,
    endMinute,
    durationMinutes,
    votingDeadlineAt: deadline,
  };
}

// 422 VALIDATION_FAILED 대상. now는 잠금 후 clock_timestamp(), activeCount는 잠금 후 active 참여자 수
// 첫 위반만 돌려준다. 하나라도 위반이면 호출자는 아무것도 저장하지 않는다
export function validateStartSettings(
  input: StartSettingsInput,
  ctx: { now: Date; activeCount: number },
): SettingsViolation | null {
  const limit = input.participantLimit;
  if (!Number.isInteger(limit) || limit < PARTICIPANT_LIMIT_MIN || limit > PARTICIPANT_LIMIT_MAX) {
    return {
      field: "participantLimit",
      message: "정원은 방장 포함 2명 이상 30명 이하여야 합니다.",
    };
  }
  if (limit < ctx.activeCount) {
    return { field: "participantLimit", message: "정원은 현재 참여 인원보다 적을 수 없습니다." };
  }

  // 오늘은 허용한다. 지난 날짜는 TIME-API-01이 무시하는 칸이 되므로 받지 않는다 (DECISION_CONFLICTS 참고)
  const today = seoulDateOf(ctx.now);
  if (input.startDate < today) {
    return { field: "dateRange", message: "시작 날짜는 오늘 이후여야 합니다." };
  }
  if (input.startDate > input.endDate) {
    return { field: "dateRange", message: "종료 날짜는 시작 날짜보다 빠를 수 없습니다." };
  }
  if (input.endDate > addCalendarMonths(today, DATE_RANGE_MONTHS)) {
    return { field: "dateRange", message: "종료 날짜는 오늘부터 3개월 이내여야 합니다." };
  }

  const { startMinute, endMinute } = input;
  if (
    startMinute % SLOT_MINUTES !== 0 ||
    endMinute % SLOT_MINUTES !== 0 ||
    startMinute > DAY_END_MINUTE - SLOT_MINUTES ||
    endMinute < SLOT_MINUTES ||
    startMinute >= endMinute
  ) {
    return {
      field: "dailyTimeRange",
      message: "하루 시간 범위는 30분 단위이며 시작이 종료보다 빨라야 합니다.",
    };
  }

  const duration = input.durationMinutes;
  if (
    !Number.isInteger(duration) ||
    duration < SLOT_MINUTES ||
    duration % SLOT_MINUTES !== 0 ||
    duration > endMinute - startMinute
  ) {
    return {
      field: "durationMinutes",
      message: "소요 시간은 30분 단위이며 하루 시간 범위 이하여야 합니다.",
    };
  }

  const deadline = input.votingDeadlineAt.getTime();
  if (deadline <= ctx.now.getTime()) {
    return { field: "votingDeadlineAt", message: "응답 마감은 현재보다 이후여야 합니다." };
  }
  if (deadline >= seoulMidnight(input.endDate).getTime()) {
    return {
      field: "votingDeadlineAt",
      message: "응답 마감은 마지막 날짜 00:00보다 앞서야 합니다.",
    };
  }

  return null;
}
