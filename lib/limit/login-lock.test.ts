import { describe, expect, it } from "vitest";
import { resolveLoginLock, type LoginFailureRecord } from "./login-lock";

const MIN = 60 * 1000;
const T0 = new Date("2026-11-17T12:00:00.000+09:00").getTime();
const at = (ms: number) => new Date(T0 + ms);
const fails = (ipKey: string, times: number[]): LoginFailureRecord[] =>
  times.map((ms) => ({ ipKey, failedAt: at(ms) }));

describe("resolveLoginLock (MEMBER-06-04 잠정, R-41)", () => {
  it("같은 참여자·같은 IP로 5번 연속 실패하면 15분 동안 잠기고 다른 IP는 잠기지 않는다", () => {
    const failures = fails("203.0.113.7", [0, 1000, 2000, 3000, 4000]);
    const now = at(4000);
    expect(resolveLoginLock(failures, "203.0.113.7", now)).toEqual({
      locked: true,
      scope: "pair",
      retryAfterSeconds: 15 * 60,
    });
    expect(resolveLoginLock(failures, "198.51.100.9", now)).toEqual({ locked: false });
    // 15분이 지나면 풀린다
    expect(resolveLoginLock(failures, "203.0.113.7", at(4000 + 15 * MIN))).toEqual({
      locked: false,
    });
  });
});

describe("resolveLoginLock 경계", () => {
  const IP = "203.0.113.7";

  it("4번 실패는 잠그지 않는다", () => {
    expect(resolveLoginLock(fails(IP, [0, 1, 2, 3]), IP, at(4))).toEqual({ locked: false });
  });

  it("남은 시간은 올림한 초, 잠금 끝 1ms 전은 1초이고 정확히 끝나면 풀린다", () => {
    const failures = fails(
      IP,
      [0, 1, 2, 3, 4].map((i) => i * MIN),
    );
    const end = 4 * MIN + 15 * MIN;
    expect(resolveLoginLock(failures, IP, at(end - 1))).toEqual({
      locked: true,
      scope: "pair",
      retryAfterSeconds: 1,
    });
    expect(resolveLoginLock(failures, IP, at(end))).toEqual({ locked: false });
  });

  it("1시간 창: 59분 안의 5번은 잠그고, 첫 실패가 정확히 1시간 전이면 세지 않는다", () => {
    expect(
      resolveLoginLock(
        fails(
          IP,
          [0, 10, 20, 30, 59].map((m) => m * MIN),
        ),
        IP,
        at(59 * MIN),
      ),
    ).toMatchObject({ locked: true, scope: "pair" });
    expect(
      resolveLoginLock(
        fails(
          IP,
          [0, 10, 20, 30, 60].map((m) => m * MIN),
        ),
        IP,
        at(60 * MIN),
      ),
    ).toEqual({ locked: false });
  });

  it("풀린 뒤 1시간 창 안에서 또 틀리면 그 실패부터 다시 15분", () => {
    const failures = fails(IP, [0, 1, 2, 3, 4, 20 * MIN]);
    expect(resolveLoginLock(failures, IP, at(20 * MIN))).toEqual({
      locked: true,
      scope: "pair",
      retryAfterSeconds: 15 * 60,
    });
  });

  it("참여자 전체: 서로 다른 IP 20번은 잠그지 않고 21번째에 모든 IP를 15분 잠근다", () => {
    const spread = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ipKey: `198.51.100.${i}`, failedAt: at(i * MIN) }));
    expect(resolveLoginLock(spread(20), "192.0.2.1", at(20 * MIN))).toEqual({ locked: false });
    expect(resolveLoginLock(spread(21), "192.0.2.1", at(20 * MIN))).toEqual({
      locked: true,
      scope: "participant",
      retryAfterSeconds: 15 * 60,
    });
  });

  it("두 기준이 모두 걸리면 더 늦게 풀리는 쪽의 남은 시간", () => {
    const others = Array.from({ length: 16 }, (_, i) => ({
      ipKey: `198.51.100.${i}`,
      failedAt: at(i * 1000),
    }));
    // 이 IP 5번(0~4분) + 다른 IP 16번(0~15초) = 21번째는 4분에 생긴다 → 둘 다 4분 + 15분
    const mine = fails(
      IP,
      [0, 1, 2, 3, 4].map((i) => i * MIN),
    );
    expect(resolveLoginLock([...others, ...mine], IP, at(5 * MIN))).toEqual({
      locked: true,
      scope: "pair",
      retryAfterSeconds: 14 * 60,
    });
    // 다른 IP에서 보면 참여자 전체 잠금만 걸린다
    expect(resolveLoginLock([...others, ...mine], "192.0.2.1", at(5 * MIN))).toMatchObject({
      locked: true,
      scope: "participant",
    });
  });

  it("기록 순서가 섞여 있어도 같은 결과", () => {
    const failures = fails(IP, [4000, 0, 3000, 1000, 2000]);
    expect(resolveLoginLock(failures, IP, at(4000))).toMatchObject({ locked: true, scope: "pair" });
  });
});

describe("하루 상한 (R-41 추가)", () => {
  // 28분 간격·서로 다른 IP라 1시간 20회·IP 5회 기준에는 걸리지 않는다
  const daily = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ipKey: `198.51.100.${i}`,
      failedAt: at(i * 28 * MIN),
    }));

  it("참여자 전체로 24시간에 50번 실패하면 50번째 실패부터 24시간 잠그고, 49번은 잠그지 않는다", () => {
    const last = 49 * 28 * MIN;
    expect(resolveLoginLock(daily(49), "192.0.2.1", at(48 * 28 * MIN))).toEqual({
      locked: false,
    });
    expect(resolveLoginLock(daily(50), "192.0.2.1", at(last))).toEqual({
      locked: true,
      scope: "daily",
      retryAfterSeconds: 24 * 60 * 60,
    });
  });

  it("24시간 창 경계: 첫 실패가 정확히 24시간 전이면 세지 않는다", () => {
    // 50번을 24시간에 딱 맞춰 둔다(첫 번째와 마지막 사이 정확히 24시간)
    const step = (24 * 60 * MIN) / 49;
    const failures = Array.from({ length: 50 }, (_, i) => ({
      ipKey: `198.51.100.${i}`,
      failedAt: at(Math.round(i * step)),
    }));
    expect(resolveLoginLock(failures, "192.0.2.1", at(24 * 60 * MIN))).toEqual({ locked: false });
  });

  it("24시간 잠금은 정확히 24시간 뒤 풀리고, 그 사이에는 1시간 기준보다 길게 남는다", () => {
    const last = 49 * 28 * MIN;
    expect(resolveLoginLock(daily(50), "192.0.2.1", at(last + 24 * 60 * MIN - 1))).toMatchObject({
      locked: true,
      scope: "daily",
      retryAfterSeconds: 1,
    });
    expect(resolveLoginLock(daily(50), "192.0.2.1", at(last + 24 * 60 * MIN))).toEqual({
      locked: false,
    });
  });
});
