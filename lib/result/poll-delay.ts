// 상태 조회 폴링 간격 (018). SWR은 응답이 끝난 뒤부터 간격을 세므로 그대로 두면 요청 주기가 "간격 + 응답 시간"이 된다
// 직전 요청 소요 시간만큼 줄여 요청 시작 간격을 period(5초)에 맞춘다. 응답이 아주 느려도 최소 간격은 둔다

export const MIN_POLL_DELAY_MS = 1000;

export function pollDelay(lastDurationMs: number, periodMs: number): number {
  if (!Number.isFinite(lastDurationMs) || lastDurationMs < 0) return periodMs;
  return Math.max(MIN_POLL_DELAY_MS, Math.round(periodMs - lastDurationMs));
}
