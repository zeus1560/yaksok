import { toDeadlinePayload } from "@/lib/create-promise/deadline";
import { timeToMinute } from "@/lib/create-promise/format";
import { hasAddedSelectableSlots } from "@/lib/state/range-change";
import {
  applySettingsPatch,
  parseSettingsPatch,
  validateCollectingChange,
  type CurrentSettings,
} from "@/lib/state/settings-patch";
import {
  minuteToTime,
  validateStartSettings,
  type StartSettingsField,
} from "@/lib/state/start-settings";
import { seoulMidnight, toSeoulIsoString } from "@/lib/time/seoul";
import type { SlotRange } from "@/lib/time/slots";

// 방장 설정 변경(STATE-API-03)·재조율(STATE-API-06) 폼 (027). 브라우저에서도 import하는 순수 함수다
// - 현재 값은 상태 조회(STATE-API-01)의 settings. 바꾼 필드만 보낸다
// - 날짜 범위는 시작·종료 중 하나라도 바뀌었을 때만 dateRange를 보낸다. 같은 과거 범위를 다시 보내면
//   시작 날짜 하한 검사로 422가 되기 때문이다(R-26)
// - 화면 검증은 서버와 같은 함수(parseSettingsPatch → applySettingsPatch → validateStartSettings ·
//   validateCollectingChange)로 해서 화면과 서버 판정이 어긋나지 않게 한다

// STATE-API-01 settings. collecting·closed·confirmed는 모든 값이 채워져 있다
export type PromiseSettings = {
  participantLimit: number;
  dateRange: { startDate: string; endDate: string };
  dailyTimeRange: { startTime: string; endTime: string };
  durationMinutes: number;
  votingDeadlineAt: string; // +09:00
};

// 화면 입력값. deadline은 한국 시간 벽시계 "YYYY-MM-DDTHH:mm"(datetime-local 형식)
export type SettingsForm = {
  participantLimit: number;
  startDate: string | null;
  endDate: string | null;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  deadline: string | null;
};

export type FormMode = "settings" | "reopen";

export type FormProblem = { field: StartSettingsField | null; message: string };

export const NO_CHANGE_MESSAGE = "바꾼 내용이 없어요.";
export const INCOMPLETE_RANGE_MESSAGE = "시작일과 종료일을 모두 골라 주세요.";
export const DEADLINE_REQUIRED_MESSAGE = "새 응답 마감을 입력해 주세요.";
export const SHRINK_BLOCKED_MESSAGE =
  "마감이 새 마지막 날보다 늦어서 줄일 수 없어요. 재조율로 다시 열어 주세요.";

// "2026-11-11T23:59:00+09:00" → "2026-11-11T23:59". 서버 표기는 항상 +09:00이다
export function toLocalDeadline(iso: string): string {
  return iso.slice(0, 16);
}

// 지금의 한국 시간 벽시계 "YYYY-MM-DDTHH:mm". 재조율 마감 입력의 하한(min)으로 쓴다. 기기 시간대와 무관하다
export function seoulLocalNow(now: Date): string {
  return toLocalDeadline(toSeoulIsoString(now));
}

// 설정 변경은 현재 마감을, 재조율은 빈 마감(새로 고르기)을 채운다
export function formFromSettings(settings: PromiseSettings, mode: FormMode): SettingsForm {
  return {
    participantLimit: settings.participantLimit,
    startDate: settings.dateRange.startDate,
    endDate: settings.dateRange.endDate,
    startMinute: timeToMinute(settings.dailyTimeRange.startTime),
    endMinute: timeToMinute(settings.dailyTimeRange.endTime),
    durationMinutes: settings.durationMinutes,
    deadline: mode === "settings" ? toLocalDeadline(settings.votingDeadlineAt) : null,
  };
}

function currentOf(settings: PromiseSettings): CurrentSettings {
  return {
    participantLimit: settings.participantLimit,
    startDate: settings.dateRange.startDate,
    endDate: settings.dateRange.endDate,
    startMinute: timeToMinute(settings.dailyTimeRange.startTime),
    endMinute: timeToMinute(settings.dailyTimeRange.endTime),
    durationMinutes: settings.durationMinutes,
  };
}

// 마감을 뺀 설정 필드 중 바뀐 것만. 날짜 범위가 덜 골라졌으면(종료 미선택) 보내지 않는다 — 검증이 따로 막는다
function changedFields(current: PromiseSettings, form: SettingsForm): Record<string, unknown> {
  const before = currentOf(current);
  const body: Record<string, unknown> = {};
  if (form.participantLimit !== before.participantLimit) {
    body.participantLimit = form.participantLimit;
  }
  if (
    form.startDate !== null &&
    form.endDate !== null &&
    (form.startDate !== before.startDate || form.endDate !== before.endDate)
  ) {
    body.dateRange = { startDate: form.startDate, endDate: form.endDate };
  }
  if (form.startMinute !== before.startMinute || form.endMinute !== before.endMinute) {
    body.dailyTimeRange = {
      startTime: minuteToTime(form.startMinute),
      endTime: minuteToTime(form.endMinute),
    };
  }
  if (form.durationMinutes !== before.durationMinutes) {
    body.durationMinutes = form.durationMinutes;
  }
  return body;
}

// STATE-API-03 요청 본문. 마감도 바뀐 경우에만(분 단위로 비교 — 화면 입력은 분까지다)
export function buildSettingsBody(
  current: PromiseSettings,
  form: SettingsForm,
): Record<string, unknown> {
  const body = changedFields(current, form);
  if (form.deadline !== null && form.deadline !== toLocalDeadline(current.votingDeadlineAt)) {
    const payload = toDeadlinePayload(form.deadline);
    if (payload) body.votingDeadlineAt = payload;
  }
  return body;
}

// STATE-API-06 요청 본문. 새 마감은 필수이고, 나머지는 "설정도 바꾸기"를 펼쳤을 때만 바뀐 필드를 보낸다
export function buildReopenBody(
  current: PromiseSettings,
  form: SettingsForm,
  changeSettings: boolean,
): Record<string, unknown> {
  const body = changeSettings ? changedFields(current, form) : {};
  const payload = form.deadline === null ? null : toDeadlinePayload(form.deadline);
  if (payload) body.votingDeadlineAt = payload;
  return body;
}

// 설정 변경에서 기존 마감 ≥ 새 마지막 날 00:00이면 마감을 앞당길 수 없으므로(모집 중 마감은 연장만) 축소할 수 없다
export function isShrinkBlockedByDeadline(current: PromiseSettings, newEndDate: string): boolean {
  return Date.parse(current.votingDeadlineAt) >= seoulMidnight(newEndDate).getTime();
}

// 저장 전 화면 검증. 첫 문제만 돌려준다. activeCount는 명단 조회의 현재 인원(모르면 0 — 서버가 422로 판정)
export function validateSettingsForm(args: {
  mode: FormMode;
  current: PromiseSettings;
  form: SettingsForm;
  changeSettings: boolean; // 재조율에서 "설정도 바꾸기"를 펼쳤는가. 설정 변경은 항상 true로 본다
  now: Date;
  activeCount: number;
}): FormProblem | null {
  const { mode, current, form, now, activeCount } = args;
  const changeSettings = mode === "settings" || args.changeSettings;

  if (changeSettings && (form.startDate === null || form.endDate === null)) {
    return { field: "dateRange", message: INCOMPLETE_RANGE_MESSAGE };
  }
  if (mode === "reopen" && (form.deadline === null || !toDeadlinePayload(form.deadline))) {
    return { field: "votingDeadlineAt", message: DEADLINE_REQUIRED_MESSAGE };
  }

  const body =
    mode === "settings"
      ? buildSettingsBody(current, form)
      : buildReopenBody(current, form, changeSettings);
  if (mode === "settings" && Object.keys(body).length === 0) {
    return { field: null, message: NO_CHANGE_MESSAGE };
  }
  if (mode === "settings" && form.endDate !== null && body.dateRange !== undefined) {
    if (isShrinkBlockedByDeadline(current, form.endDate)) {
      return { field: "dateRange", message: SHRINK_BLOCKED_MESSAGE };
    }
  }

  // 서버가 받는 본문을 서버와 같은 파서로 읽어 같은 검증을 돌린다
  const patch = parseSettingsPatch(body);
  if (!patch) return { field: null, message: "입력값을 다시 확인해 주세요." };
  const currentDeadline = new Date(Date.parse(current.votingDeadlineAt));
  const merged = applySettingsPatch(currentOf(current), {
    ...patch,
    votingDeadlineAt: patch.votingDeadlineAt ?? currentDeadline,
  });
  const violation =
    validateStartSettings(merged, {
      now,
      activeCount,
      checkStartDateFloor: patch.dateRange !== undefined,
    }) ??
    (mode === "settings"
      ? validateCollectingChange(
          { participantLimit: current.participantLimit, votingDeadlineAt: currentDeadline },
          patch,
        )
      : null);
  return violation ? { field: violation.field, message: violation.message } : null;
}

export type RangePreview = {
  removesSlots: boolean; // 범위 밖이 되는 칸이 있다 → 그 칸의 입력이 지워진다
  requiresResubmit: boolean; // 새로 고를 수 있는 칸이 생긴다 → 모든 참여자의 제출이 해제된다
};

function rangeOf(start: string, end: string, startMinute: number, endMinute: number): SlotRange {
  return {
    startDate: start,
    endDate: end,
    dailyStartMinute: startMinute,
    dailyEndMinute: endMinute,
  };
}

// 범위 변경 미리 보기. 서버(range-change.ts)와 같은 함수로 판단한다. 범위가 그대로거나 덜 골라졌으면 null
// - 확대·이동: hasAddedSelectableSlots(전, 후, 지금) — 시작이 지금 이후인 새 칸이 있다
// - 지워지는 칸: hasAddedSelectableSlots(후, 전, 0) — 옛 범위에만 있는 칸(지난 칸 포함)이 있다
export function previewRangeChange(
  current: PromiseSettings,
  form: SettingsForm,
  now: Date,
): RangePreview | null {
  if (form.startDate === null || form.endDate === null) return null;
  const c = currentOf(current);
  const before = rangeOf(c.startDate, c.endDate, c.startMinute, c.endMinute);
  const after = rangeOf(form.startDate, form.endDate, form.startMinute, form.endMinute);
  if (
    before.startDate === after.startDate &&
    before.endDate === after.endDate &&
    before.dailyStartMinute === after.dailyStartMinute &&
    before.dailyEndMinute === after.dailyEndMinute
  ) {
    return null;
  }
  return {
    removesSlots: hasAddedSelectableSlots(after, before, new Date(0)),
    requiresResubmit: hasAddedSelectableSlots(before, after, now),
  };
}

export const RANGE_REMOVES_NOTICE = "범위 밖 입력이 삭제돼요.";
export const RANGE_RESUBMIT_NOTICE = "모든 참여자가 다시 제출해야 해요.";
