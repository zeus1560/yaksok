import { createHash, randomBytes } from "node:crypto";

// 세션 (API_CONVENTIONS 5절). 토큰 원문은 쿠키로만 내려주고 DB에는 SHA-256 해시만 저장한다
// draft에서 발급한 세션만 발급 시각 + 24시간이다 (5.2, R-10). 그 외 세션은 모두 링크 만료와 같은
// accessExpiresAt(link-status.ts)을 쓴다. draft를 따로 두는 이유: draft에는 voting_deadline_at이 없어
// 링크 만료 기준이 링크 발급 시각으로 떨어지는데, 10분 안에 설정하거나 삭제되는 상태라 그 값에 의미가 없다.
// 모집 시작(STATE-API-02)이 이 세션들을 refreshActiveSessions(session-expiry.ts)로 마감 + 7일로 바꾼다
export const DRAFT_SESSION_TTL_SECONDS = 24 * 60 * 60;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// 쿠키 Max-Age는 DB expires_at까지 남은 초. 내림해서 쿠키가 DB 세션보다 오래 남지 않게 한다 (MEMBER-API-04)
export function sessionMaxAgeSeconds(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

// 쿠키는 약속별로 분리하고 Path를 그 약속의 API로 한정한다 (5.1)
export function sessionCookie(promiseId: string, token: string, maxAgeSeconds: number): string {
  return [
    `ys_session_${promiseId}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Path=/api/v1/promises/${promiseId}`,
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}
