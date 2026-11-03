import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken, sessionCookie } from "./session";

describe("세션 토큰", () => {
  it("32바이트 난수를 base64url 43자로 만든다", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSessionToken()).not.toBe(token);
  });

  it("해시는 SHA-256 hex 64자이고 같은 토큰이면 같은 값이다", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).not.toContain(token);
  });
});

describe("sessionCookie (API_CONVENTIONS 5절)", () => {
  it("약속별 이름·Path와 보안 속성을 붙인다", () => {
    expect(sessionCookie("p-1", "tok", 86400)).toBe(
      "ys_session_p-1=tok; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/promises/p-1; Max-Age=86400",
    );
  });
});
