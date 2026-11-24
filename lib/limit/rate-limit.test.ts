import { describe, expect, it } from "vitest";
import { RATE_LIMITS, resolveRateLimit } from "./rate-limit";

const T0 = new Date("2026-11-17T12:00:00.000+09:00").getTime();
const at = (ms: number) => new Date(T0 + ms);
const seconds = (n: number) => Array.from({ length: n }, (_, i) => at(i * 1000));
const LINKS = RATE_LIMITS.links;

describe("resolveRateLimit (R-41)", () => {
  it("운영 기준: 링크 발급 1분 10회, 방장 등록·참여자 등록·로그인 1분 30회", () => {
    expect(RATE_LIMITS).toEqual({
      links: { limit: 10, windowMs: 60_000 },
      host: { limit: 30, windowMs: 60_000 },
      participants: { limit: 30, windowMs: 60_000 },
      login: { limit: 30, windowMs: 60_000 },
    });
  });

  it("링크: 1분 안 9번이면 10번째를 허용하고, 10번이면 11번째를 거절한다", () => {
    expect(resolveRateLimit(seconds(9), at(10_000), LINKS)).toEqual({ allowed: true });
    expect(resolveRateLimit(seconds(10), at(10_000), LINKS)).toEqual({
      allowed: false,
      // 가장 오래된 요청(0초)이 창을 벗어나는 60초까지 50초
      retryAfterSeconds: 50,
    });
  });

  it("로그인: 29번이면 허용, 30번이면 거절", () => {
    expect(resolveRateLimit(seconds(29), at(30_000), RATE_LIMITS.login)).toEqual({
      allowed: true,
    });
    expect(resolveRateLimit(seconds(30), at(30_000), RATE_LIMITS.login)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it("창 경계: 정확히 1분 전 기록은 세지 않는다", () => {
    const hits = seconds(10);
    expect(resolveRateLimit(hits, at(60_000), LINKS)).toEqual({ allowed: true });
    expect(resolveRateLimit(hits, at(59_999), LINKS)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("기준보다 많이 쌓였으면 넘친 만큼 더 오래된 기록이 빠질 때까지", () => {
    expect(resolveRateLimit(seconds(12), at(15_000), LINKS)).toEqual({
      allowed: false,
      retryAfterSeconds: 47, // 2초 기록이 빠지는 62초
    });
  });

  it("미래 시각 기록(시계 차이)은 세지 않는다", () => {
    expect(resolveRateLimit([...seconds(9), at(30_000)], at(10_000), LINKS)).toEqual({
      allowed: true,
    });
  });
});
