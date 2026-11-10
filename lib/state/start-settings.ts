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

// code: VALIDATION_FAILED가 아닌 전용 코드를 쓰는 API가 구분하는 값
// - CAPACITY_BELOW_ACTIVE_COUNT: 정원 < active 인원 (STATE-API-06·03. STATE-API-02는 draft라 active가 방장 1명뿐이어서 나오지 않는다)
// - CAPACITY_DECREASE_NOT_ALLOWED·DEADLINE_SHORTEN_NOT_ALLOWED: 모집 중 설정 변경(STATE-API-03)만. settings-patch.ts가 낸다
export type SettingsViolation = {
  field: StartSettingsField;
  message: string;
  code?:
    | "CAPACITY_BELOW_ACTIVE_COUNT"
    | "CAPACITY_DECREASE_NOT_ALLOWED"
    | "DEADLINE_SHORTEN_NOT_ALLOWED";
};

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

// 필드별 형식 파서. 형식이 틀리면 null. 재조율·설정 변경의 부분 요청(settings-patch.ts)도 같은 파서를 쓴다
export function parseNumberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseDateRangeField(value: unknown): { startDate: string; endDate: string } | null {
  if (!isObject(value)) return null;
  const startDate = toDate(value.startDate);
  const endDate = toDate(value.endDate);
  return startDate && endDate ? { startDate, endDate } : null;
}

export function parseDailyTimeRangeField(
  value: unknown,
): { startMinute: number; endMinute: number } | null {
  if (!isObject(value)) return null;
  const startMinute = toMinute(value.startTime);
  const endMinute = toMinute(value.endTime);
  return startMinute !== null && endMinute !== null ? { startMinute, endMinute } : null;
}

export const parseDeadlineField = toDeadline;

// 400 INVALID_REQUEST 대상: JSON 구조·타입·필수값, 존재하지 않는 날짜·시각, 오프셋 없는 마감
export function parseStartSettings(body: unknown): StartSettingsInput | null {
  if (!isObject(body)) return null;
  const participantLimit = parseNumberField(body.participantLimit);
  const durationMinutes = parseNumberField(body.durationMinutes);
  const dateRange = parseDateRangeField(body.dateRange);
  const dailyTimeRange = parseDailyTimeRangeField(body.dailyTimeRange);
  const deadline = parseDeadlineField(body.votingDeadlineAt);
  if (participantLimit === null || durationMinutes === null) return null;
  if (!dateRange || !dailyTimeRange || !deadline) return null;

  return {
    participantLimit,
    ...dateRange,
    ...dailyTimeRange,
    durationMinutes,
    votingDeadlineAt: deadline,
  };
}

// 422 VALIDATION_FAILED 대상. now는 잠금 후 clock_timestamp(), activeCount는 잠금 후 active 참여자 수
// 첫 위반만 돌려준다. 하나라도 위반이면 호출자는 아무것도 저장하지 않는다
// checkStartDateFloor: 시작 날짜 하한(오늘 이후, R-12) 검사 여부. 재조율에서 dateRange를 생략해 기존 범위를
// 유지하면 이미 지난 시작일일 수 있으므로 false로 넘긴다(R-26). 기본 true
export function validateStartSettings(
  input: StartSettingsInput,
  ctx: { now: Date; activeCount: number; checkStartDateFloor?: boolean },
): SettingsViolation | null {
  const limit = input.participantLimit;
  if (!Number.isInteger(limit) || limit < PARTICIPANT_LIMIT_MIN || limit > PARTICIPANT_LIMIT_MAX) {
    return {
      field: "participantLimit",
      message: "정원은 방장 포함 2명 이상 30명 이하여야 합니다.",
    };
  }
  if (limit < ctx.activeCount) {
    return {
      field: "participantLimit",
      message: "정원은 현재 참여 인원보다 적을 수 없습니다.",
      code: "CAPACITY_BELOW_ACTIVE_COUNT",
    };
  }

  // 오늘은 허용한다. 지난 날짜는 TIME-API-01이 무시하는 칸이 되므로 받지 않는다 (DECISION_CONFLICTS 참고)
  const today = seoulDateOf(ctx.now);
  if ((ctx.checkStartDateFloor ?? true) && input.startDate < today) {
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
