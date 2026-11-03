import { createHash, randomBytes } from "node:crypto";

// 세션 (API_CONVENTIONS 5절). 토큰 원문은 쿠키로만 내려주고 DB에는 SHA-256 해시만 저장한다
export const DRAFT_SESSION_TTL_SECONDS = 24 * 60 * 60; // draft에서 발급한 세션 (5.2)

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
