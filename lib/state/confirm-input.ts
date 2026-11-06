import { isCalendarDate } from "@/lib/time/seoul";

// STATE-API-05 본문 { startAt } 파싱. 브라우저에서도 import할 수 있는 순수 함수다
// startAt은 오프셋 포함 ISO 8601이고 절대 시각으로 다룬다 — +09:00·Z·다른 오프셋이라도 같은 시각이면 같은 후보다
// 받는 표기: YYYY-MM-DDTHH:MM[:SS[.f{1,3}]] + (Z | ±HH:MM). 대문자 T·Z, 실제 달력 날짜, 오프셋 ±14:00 이내
// 30분 경계·미래·범위는 여기서 보지 않는다(후보 판정 422 INVALID_CONFIRMATION_CANDIDATE 몫)
const START_AT_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/;

export type ConfirmationInput =
  | { kind: "invalid_request" } // 400: JSON 객체가 아님·startAt 없음·문자열 아님
  | { kind: "invalid_start_at" } // 422 VALIDATION_FAILED(field startAt): 날짜·시간 형식 오류
  | { kind: "ok"; startAt: Date };

export function parseConfirmationBody(body: unknown): ConfirmationInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid_request" };
  }
  const value = (body as Record<string, unknown>).startAt;
  if (typeof value !== "string") return { kind: "invalid_request" };
  const startAt = parseOffsetDateTime(value);
  return startAt ? { kind: "ok", startAt } : { kind: "invalid_start_at" };
}

export function parseOffsetDateTime(value: string): Date | null {
  const match = START_AT_PATTERN.exec(value);
  if (!match || !isCalendarDate(match[1])) return null;
  const [, , , , , , zone, offsetHour, offsetMinute] = match;
  if (zone !== "Z" && (Number(offsetHour) > 14 || Number(offsetMinute) > 59)) return null;
  if (zone !== "Z" && Number(offsetHour) === 14 && Number(offsetMinute) !== 0) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}
