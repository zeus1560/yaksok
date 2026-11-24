// PIN 시도 제한·레이트 리밋(035, R-41) — 운영 모드 서버에 실제로 보내 본다
// 로컬 서버는 x-forwarded-for를 접속 IP로 본다. 같은 IP는 ip를 고정해 보낸다(배포 주소에서는 Vercel이 덮어써 맞지 않으므로 @smoke 아님)
import { test, expect } from "../support/fixtures";
import { HOST_PIN, MEMBER_PIN, call } from "../support/api";
import { testIp } from "../support/e2e-env";

const loginAs = (promiseId: string, nickname: string, pin: string, ip: string) =>
  call("POST", `/api/v1/promises/${promiseId}/auth/session`, { ip, body: { nickname, pin } });

test("링크 발급: 같은 IP 1분 11번째는 429 RATE_LIMITED·Retry-After, 다른 IP는 201", async ({
  seed,
}) => {
  const ip = testIp();
  const statuses: number[] = [];
  let last = null as Awaited<ReturnType<typeof call>> | null;
  for (let i = 0; i < 11; i += 1) {
    last = await call("POST", "/api/v1/links", { ip });
    if (last.status === 201) seed.track(last.json.inviteToken);
    statuses.push(last.status);
  }
  expect(statuses).toEqual([...Array(10).fill(201), 429]);
  expect(last!.json).toMatchObject({ code: "RATE_LIMITED" });
  const retry = Number(last!.headers["retry-after"]);
  expect(retry).toBeGreaterThanOrEqual(1);
  expect(retry).toBeLessThanOrEqual(60);
  expect(last!.json.details).toEqual({ retryAfterSeconds: retry });
  expect(last!.cacheControl).toBe("no-store");

  const other = await call("POST", "/api/v1/links", { ip: testIp() });
  expect(other.status).toBe(201);
  seed.track(other.json.inviteToken);
});

test("PIN 5번 연속 실패: 같은 IP는 PIN이 맞아도 429 TOO_MANY_ATTEMPTS, 다른 IP는 200", async ({
  seed,
}) => {
  const P = await seed.collecting({ members: 1 });
  const [m] = P.members;
  const A = testIp();
  for (let i = 0; i < 5; i += 1) {
    expect((await loginAs(P.promiseId, m.nickname, "0000", A)).status).toBe(401);
  }
  const locked = await loginAs(P.promiseId, m.nickname, MEMBER_PIN, A);
  expect(locked.status).toBe(429);
  expect(locked.json.code).toBe("TOO_MANY_ATTEMPTS");
  const retry = Number(locked.headers["retry-after"]);
  expect(retry).toBeGreaterThan(890);
  expect(retry).toBeLessThanOrEqual(900);
  expect(locked.json.details).toEqual({ retryAfterSeconds: retry });
  expect(locked.setCookies).toEqual([]);

  // 다른 IP의 본인 로그인과 다른 참여자(방장)는 막히지 않는다
  expect((await loginAs(P.promiseId, m.nickname, MEMBER_PIN, testIp())).status).toBe(200);
  expect((await loginAs(P.promiseId, P.hostNick, HOST_PIN, A)).status).toBe(200);
});

test("로그인 성공은 그 IP의 연속 실패를 초기화한다", async ({ seed }) => {
  const P = await seed.collecting({ members: 1 });
  const [m] = P.members;
  const ip = testIp();
  for (let i = 0; i < 4; i += 1) await loginAs(P.promiseId, m.nickname, "0000", ip);
  expect((await loginAs(P.promiseId, m.nickname, MEMBER_PIN, ip)).status).toBe(200);
  for (let i = 0; i < 4; i += 1) {
    expect((await loginAs(P.promiseId, m.nickname, "0000", ip)).status).toBe(401);
  }
  expect((await loginAs(P.promiseId, m.nickname, MEMBER_PIN, ip)).status).toBe(200);
});
