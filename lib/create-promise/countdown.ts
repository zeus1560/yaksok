// 설정 시간 카운트다운과 새로고침 복원 (STATE-02-02, DECISION_CONFLICTS R-15)
// 서버 시각과 기기 시각을 직접 비교하지 않는다: 방장 등록 응답을 받은 순간의 기기 시각 + 10분을
// "로컬 만료 시각"으로 저장하고 기기 시각의 경과만 본다. 저장값은 화면 복원용이며 권한 판단에 쓰지 않는다

export const SETUP_WINDOW_MS = 10 * 60 * 1000;
export const URGENT_MS = 60 * 1000;

export type SetupRecord = { promiseId: string; localExpiresAt: number };

export function setupStorageKey(inviteToken: string): string {
  return `yaksok:setup:${inviteToken}`;
}

export function createSetupRecord(promiseId: string, nowMs: number): SetupRecord {
  return { promiseId, localExpiresAt: nowMs + SETUP_WINDOW_MS };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 저장값이 형식에 맞고 시한이 남았을 때만 돌려준다
export function parseSetupRecord(raw: string | null, nowMs: number): SetupRecord | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { promiseId, localExpiresAt } = value as Record<string, unknown>;
  if (typeof promiseId !== "string" || !UUID.test(promiseId)) return null;
  if (typeof localExpiresAt !== "number" || !Number.isFinite(localExpiresAt)) return null;
  // 기기 시계를 앞으로 돌려 둔 저장값처럼 10분보다 많이 남은 값은 믿지 않는다
  if (localExpiresAt - nowMs > SETUP_WINDOW_MS) return null;
  if (localExpiresAt <= nowMs) return null;
  return { promiseId, localExpiresAt };
}

export function remainingMs(localExpiresAt: number, nowMs: number): number {
  return Math.max(0, localExpiresAt - nowMs);
}

// 9:41 형식. 남은 초는 올림해 0초가 되기 전에는 0:00을 보이지 않는다
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function isUrgent(ms: number): boolean {
  return ms <= URGENT_MS;
}
