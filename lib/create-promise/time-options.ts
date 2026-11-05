import {
  DAY_END_MINUTE,
  PARTICIPANT_LIMIT_MAX,
  PARTICIPANT_LIMIT_MIN,
  SLOT_MINUTES,
} from "@/lib/state/start-settings";

// 하루 시간 범위·소요 시간·정원 입력 (TIME-05-02, TIME-06-01, TIME-06-02, C-02)
// 시각은 자정부터의 분. 24:00 = 1440

export const DEFAULT_START_MINUTE = 9 * 60; // TIME-05-02 기본 09:00
export const DEFAULT_END_MINUTE = DAY_END_MINUTE; // 24:00
export const DEFAULT_DURATION_MINUTES = 120; // TIME-06-02 기본 2시간
export const DEFAULT_PARTICIPANT_LIMIT = 4;
export const DURATION_SHRUNK_NOTICE = "하루 시간 범위에 맞춰 소요 시간을 줄였어요";

// 시작 00:00~23:30
export function startTimeOptions(): number[] {
  const options: number[] = [];
  for (let m = 0; m <= DAY_END_MINUTE - SLOT_MINUTES; m += SLOT_MINUTES) options.push(m);
  return options;
}

// 종료: 시작보다 늦은 시각 ~ 24:00
export function endTimeOptions(startMinute: number): number[] {
  const options: number[] = [];
  for (let m = startMinute + SLOT_MINUTES; m <= DAY_END_MINUTE; m += SLOT_MINUTES) {
    options.push(m);
  }
  return options;
}

// 시작을 바꿔 종료가 시작 이하가 되면 종료를 24:00으로 둔다
export function endAfterStartChange(startMinute: number, endMinute: number): number {
  return endMinute > startMinute ? endMinute : DAY_END_MINUTE;
}

export type DurationResult = { duration: number; shrunk: boolean };

// 하루 범위가 줄어 소요 시간이 범위보다 길어지면 범위 길이로 줄인다
export function fitDuration(
  duration: number,
  startMinute: number,
  endMinute: number,
): DurationResult {
  const max = endMinute - startMinute;
  if (duration > max) return { duration: max, shrunk: true };
  return { duration: Math.max(duration, SLOT_MINUTES), shrunk: false };
}

// −/+ 버튼. 30분 ~ 하루 범위 길이
export function stepDuration(
  duration: number,
  delta: number,
  startMinute: number,
  endMinute: number,
): number {
  const max = endMinute - startMinute;
  return Math.min(max, Math.max(SLOT_MINUTES, duration + delta));
}

export function clampParticipantLimit(value: number): number {
  if (!Number.isFinite(value)) return PARTICIPANT_LIMIT_MIN;
  return Math.min(PARTICIPANT_LIMIT_MAX, Math.max(PARTICIPANT_LIMIT_MIN, Math.trunc(value)));
}
