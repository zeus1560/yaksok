import {
  parseDailyTimeRangeField,
  parseDateRangeField,
  parseDeadlineField,
  parseNumberField,
  type StartSettingsInput,
} from "./start-settings";

// STATE-API-06 재조율(이후 STATE-API-03 설정 변경)의 부분 설정 요청. 생략한 필드는 기존 값을 유지한다
// 필드 형식은 STATE-API-02와 같은 파서로 본다. 범위 규칙(422)은 합친 뒤 validateStartSettings가 본다
export type SettingsPatch = {
  participantLimit?: number;
  dateRange?: { startDate: string; endDate: string };
  dailyTimeRange?: { startMinute: number; endMinute: number };
  durationMinutes?: number;
  votingDeadlineAt?: Date;
};

// 재조율은 새 마감이 필수다 (STATE-09-02)
export type ReopenInput = SettingsPatch & { votingDeadlineAt: Date };

// 바꾸기 전 설정. 재조율 대상(closed·confirmed)은 모집 시작 때 모든 값이 채워져 있다
export type CurrentSettings = Omit<StartSettingsInput, "votingDeadlineAt">;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 400 INVALID_REQUEST면 null. 보낸 필드는 형식이 맞아야 한다 — null·빈 객체·시작/종료 중 하나만 보낸 경우도 400
// 알 수 없는 필드는 무시한다(STATE-API-02와 같음)
export function parseSettingsPatch(body: unknown): SettingsPatch | null {
  if (!isObject(body)) return null;
  const patch: SettingsPatch = {};
  const has = (key: string) => Object.hasOwn(body, key);

  if (has("participantLimit")) {
    const value = parseNumberField(body.participantLimit);
    if (value === null) return null;
    patch.participantLimit = value;
  }
  if (has("dateRange")) {
    const value = parseDateRangeField(body.dateRange);
    if (!value) return null;
    patch.dateRange = value;
  }
  if (has("dailyTimeRange")) {
    const value = parseDailyTimeRangeField(body.dailyTimeRange);
    if (!value) return null;
    patch.dailyTimeRange = value;
  }
  if (has("durationMinutes")) {
    const value = parseNumberField(body.durationMinutes);
    if (value === null) return null;
    patch.durationMinutes = value;
  }
  if (has("votingDeadlineAt")) {
    const value = parseDeadlineField(body.votingDeadlineAt);
    if (!value) return null;
    patch.votingDeadlineAt = value;
  }
  return patch;
}

export function parseReopenSettings(body: unknown): ReopenInput | null {
  const patch = parseSettingsPatch(body);
  if (!patch?.votingDeadlineAt) return null;
  return { ...patch, votingDeadlineAt: patch.votingDeadlineAt };
}

// 보낸 값만 덮어쓴 전체 설정. 검증은 이 결과로 한다
export function applySettingsPatch(
  current: CurrentSettings,
  patch: ReopenInput,
): StartSettingsInput {
  return {
    participantLimit: patch.participantLimit ?? current.participantLimit,
    startDate: patch.dateRange?.startDate ?? current.startDate,
    endDate: patch.dateRange?.endDate ?? current.endDate,
    startMinute: patch.dailyTimeRange?.startMinute ?? current.startMinute,
    endMinute: patch.dailyTimeRange?.endMinute ?? current.endMinute,
    durationMinutes: patch.durationMinutes ?? current.durationMinutes,
    votingDeadlineAt: patch.votingDeadlineAt,
  };
}
