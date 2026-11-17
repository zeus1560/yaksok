// 인증 없는 API의 IP 기준 레이트 리밋 (035, DECISION_CONFLICTS R-41). 요청 기록 → 허용 여부와 남은 시간. 순수 함수
// 밀어 가는 1분 창: 지난 1분 동안 허용된 요청이 기준 수에 닿았으면 거절한다. 거절된 요청은 기록하지 않는다
// (기다리지 않고 다시 눌러도 Retry-After가 늘어나지 않게)

export type RateLimitBucket = "links" | "host" | "participants" | "login";
export type RateLimitRule = { limit: number; windowMs: number };

const MINUTE = 60 * 1000;

// 운영 기준. 같은 와이파이·통신사 망(CGNAT)에서 여러 사람이 한 공인 IP를 쓰는 경우를 고려해 넉넉히 둔다(R-41).
// 무차별 대입 방어는 PIN 시도 제한(login-lock.ts)이 맡는다
// 테스트를 위해 바꾸는 길은 두지 않는다(통합 테스트는 요청마다 다른 IP 헤더를 보내고, 미리보기 smoke는 429면 기다렸다 다시 보낸다)
export const RATE_LIMITS: Record<RateLimitBucket, RateLimitRule> = {
  links: { limit: 10, windowMs: MINUTE }, // MEMBER-API-09 링크 발급
  host: { limit: 30, windowMs: MINUTE }, // MEMBER-API-02 방장 등록
  participants: { limit: 30, windowMs: MINUTE }, // MEMBER-API-03 참여자 등록
  login: { limit: 30, windowMs: MINUTE }, // MEMBER-API-04 로그인
};

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function resolveRateLimit(
  hits: readonly Date[],
  now: Date,
  rule: RateLimitRule,
): RateLimitDecision {
  const from = now.getTime() - rule.windowMs;
  const inWindow = hits
    .map((h) => h.getTime())
    .filter((t) => t > from && t <= now.getTime())
    .sort((a, b) => a - b);
  if (inWindow.length < rule.limit) return { allowed: true };
  // 창 안 요청이 기준보다 하나 적어지는 순간 = 오래된 쪽에서 (넘친 수 + 1)번째 기록이 창을 벗어날 때
  const freeAt = inWindow[inWindow.length - rule.limit] + rule.windowMs;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((freeAt - now.getTime()) / 1000)),
  };
}
