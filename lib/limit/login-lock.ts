// PIN 시도 제한 (MEMBER-06-04 잠정, DECISION_CONFLICTS R-41). 실패 기록 → 잠금 여부와 남은 시간. 순수 함수
// "참여자" = (약속, 정규화 닉네임). 없는 닉네임도 똑같이 잠가 닉네임 존재가 드러나지 않게 한다
//
// 세 기준은 같은 규칙(밀어 가는 창: 창 안 실패 수가 문턱에 닿은 실패부터 잠금)을 값만 달리 쓴다
// - 참여자 + IP: 1시간 안에 이 IP의 실패가 5번 쌓이면(성공하면 이 IP 기록은 지워진다 = 연속 실패) 그 실패부터 15분
// - 참여자 전체: IP와 관계없이 1시간 안에 실패가 20번을 넘으면(21번째) 그 실패부터 15분
// - 하루 상한: IP와 관계없이 24시간 안에 실패가 50번이면 그 실패부터 24시간
// 잠긴 동안의 요청은 PIN을 비교하지 않고 기록도 남기지 않는다. 풀린 뒤 창 안에서 또 틀리면 다시 잠긴다
// 잠금은 새 로그인만 막는다. 이미 받은 세션(다른 기기 포함)은 그대로 쓸 수 있다

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export type LoginLockScope = "pair" | "participant" | "daily";
type LockRule = { threshold: number; windowMs: number; lockMs: number };

export const LOGIN_LOCK_RULES: Record<LoginLockScope, LockRule> = {
  pair: { threshold: 5, windowMs: HOUR, lockMs: 15 * MIN },
  participant: { threshold: 21, windowMs: HOUR, lockMs: 15 * MIN },
  daily: { threshold: 50, windowMs: 24 * HOUR, lockMs: 24 * HOUR },
};

// 판정에 필요한 기록의 범위: 지금 걸려 있을 수 있는 잠금을 만든 실패(잠금 시간 안)와 그 실패의 창. 가장 긴 것 = 48시간
export const LOGIN_FAILURE_LOOKBACK_MS = Math.max(
  ...Object.values(LOGIN_LOCK_RULES).map((r) => r.windowMs + r.lockMs),
);

export type LoginFailureRecord = { ipKey: string; failedAt: Date };

export type LoginLock =
  { locked: false } | { locked: true; scope: LoginLockScope; retryAfterSeconds: number };

// 실패 시각들(오름차순)에서 "창 안 실패 수가 문턱에 닿은 실패 + 잠금 시간" 중 가장 늦은 끝 시각. 없으면 0
function lockedUntil(times: readonly number[], rule: LockRule): number {
  let until = 0;
  let start = 0;
  for (let i = 0; i < times.length; i += 1) {
    while (times[start] <= times[i] - rule.windowMs) start += 1;
    if (i - start + 1 >= rule.threshold) until = Math.max(until, times[i] + rule.lockMs);
  }
  return until;
}

export function resolveLoginLock(
  failures: readonly LoginFailureRecord[],
  ipKey: string,
  now: Date,
): LoginLock {
  const sorted = [...failures].sort((a, b) => a.failedAt.getTime() - b.failedAt.getTime());
  const all = sorted.map((f) => f.failedAt.getTime());
  const pair = sorted.filter((f) => f.ipKey === ipKey).map((f) => f.failedAt.getTime());

  // 여럿이 걸리면 가장 늦게 풀리는 쪽(같으면 앞 순서: 참여자 + IP → 참여자 전체 → 하루)
  const candidates: [LoginLockScope, number][] = [
    ["pair", lockedUntil(pair, LOGIN_LOCK_RULES.pair)],
    ["participant", lockedUntil(all, LOGIN_LOCK_RULES.participant)],
    ["daily", lockedUntil(all, LOGIN_LOCK_RULES.daily)],
  ];
  const [scope, until] = candidates.reduce((best, c) => (c[1] > best[1] ? c : best));
  if (until <= now.getTime()) return { locked: false };
  return { locked: true, scope, retryAfterSeconds: Math.ceil((until - now.getTime()) / 1000) };
}
