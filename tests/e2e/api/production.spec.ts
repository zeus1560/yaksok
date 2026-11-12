// 운영 모드(next start·배포 주소) 확인 — GET API no-store, Next.js 캐시가 끼지 않음, 세션 쿠키 속성 (031). 배포 확인 묶음 @smoke(032)
import { test, expect } from "../support/fixtures";
import {
  as,
  call,
  cookieName,
  join,
  seoulDate,
  setCookieOf,
  slotAt,
  type ApiResponse,
} from "../support/api";
import { ageLinkPastExpiry } from "../support/db";

const expectNoStore = (label: string, res: ApiResponse, status: number) => {
  expect(res.status, `${label}: ${res.text.slice(0, 200)}`).toBe(status);
  expect(res.cacheControl, `${label}: Cache-Control`).toBe("no-store");
};

test("GET API는 성공·실패 응답 모두 Cache-Control: no-store @smoke", async ({ seed }) => {
  const P = await seed.collecting({ members: 1 });
  const host = as(P.promiseId, P.hostToken);
  await host.submit([slotAt(2, "10:00"), slotAt(2, "10:30")]);
  await as(P.promiseId, P.members[0].token).submit([slotAt(2, "10:00"), slotAt(2, "10:30")]);

  expectNoStore("링크 조회 200", await call("GET", `/api/v1/links/${P.inviteToken}`), 200);
  expectNoStore("링크 조회 404(형식)", await call("GET", "/api/v1/links/not-a-token"), 404);
  const old = await seed.link();
  await ageLinkPastExpiry(old);
  expectNoStore("링크 조회 410(7일 지남)", await call("GET", `/api/v1/links/${old}`), 410);

  for (const sub of ["", "/me", "/participants", "/availability"]) {
    expectNoStore(`GET ${sub || "상태"} 200`, await host.get(sub), 200);
    expectNoStore(
      `GET ${sub || "상태"} 401(쿠키 없음)`,
      await call("GET", `/api/v1/promises/${P.promiseId}${sub}`, { origin: null }),
      401,
    );
  }
  expectNoStore("후보 409(모집 중)", await host.get("/candidates"), 409);
  await host.send("POST", "/close");
  expectNoStore("후보 200(마감 뒤)", await host.get("/candidates?limit=5&offset=0"), 200);
});

test("상태가 바뀐 직후의 GET이 새 값을 돌려준다(운영 모드 캐시 없음) @smoke", async ({ seed }) => {
  const P = await seed.collecting({ members: 0 });
  const host = as(P.promiseId, P.hostToken);

  // 링크 조회: 같은 주소를 반복 조회해도 상태 변화가 바로 보인다
  const fresh = await seed.link();
  expect((await call("GET", `/api/v1/links/${fresh}`)).json.nextAction).toBe("register_host");
  await call("POST", `/api/v1/links/${fresh}/host`, {
    body: { nickname: "캐시방장", pin: "1357" },
  });
  expect((await call("GET", `/api/v1/links/${fresh}`)).json.nextAction).toBe("wait_setup");

  // 상태 조회: collecting → closed → confirmed → collecting(재조율) → cancelled
  expect((await host.get()).json.promiseStatus).toBe("collecting");
  // 명단: 참여 직후 인원이 바로 늘어난다
  expect((await host.get("/participants")).json.participants).toHaveLength(1);
  const m = await join(P.promiseId);
  expect((await host.get("/participants")).json.participants).toHaveLength(2);
  // 가능 시간: 제출 직후 버전·칸이 바로 바뀐다
  const slots = [slotAt(2, "10:00"), slotAt(2, "10:30")];
  await as(P.promiseId, m.token).submit(slots);
  await host.submit(slots);
  const avail = (await host.get("/availability")).json;
  expect(avail.me.slots).toHaveLength(2);
  expect(avail.me.version).toBe(1);

  await host.send("POST", "/close");
  expect((await host.get()).json.promiseStatus).toBe("closed");
  const cands = (await host.get("/candidates?limit=5&offset=0")).json.candidates;
  await host.send("POST", "/confirmation", { startAt: cands[0].startAt });
  expect((await host.get()).json.promiseStatus).toBe("confirmed");
  await host.send("POST", "/reopen", { votingDeadlineAt: `${seoulDate(1)}T12:00:00+09:00` });
  expect((await host.get()).json.promiseStatus).toBe("collecting");
  await host.send("POST", "/cancel");
  expect((await as(P.promiseId, m.token).get()).json.code).toBe("PROMISE_CANCELLED");
});

test("세션 쿠키 속성: HttpOnly·Secure·SameSite=Lax·Path=약속 API·Max-Age @smoke", async ({
  seed,
}) => {
  const P = await seed.collecting({ members: 0 });
  for (const [label, res] of [
    [
      "참여자 등록",
      await call("POST", `/api/v1/promises/${P.promiseId}/participants`, {
        body: { nickname: "쿠키참여", pin: "2468" },
      }),
    ],
    [
      "로그인",
      await call("POST", `/api/v1/promises/${P.promiseId}/auth/session`, {
        body: { nickname: "쿠키참여", pin: "2468" },
      }),
    ],
  ] as const) {
    const line = setCookieOf(res, P.promiseId);
    const parts = line.split(";").map((s) => s.trim());
    expect(parts[0].startsWith(`${cookieName(P.promiseId)}=`), label).toBe(true);
    expect(parts, label).toEqual(
      expect.arrayContaining([
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        `Path=/api/v1/promises/${P.promiseId}`,
      ]),
    );
    expect(Number(/Max-Age=(\d+)/.exec(line)?.[1]), `${label} Max-Age`).toBeGreaterThan(0);
    expect(
      parts.some((p) => /^Domain=/i.test(p)),
      `${label}: Domain 없음(호스트 전용)`,
    ).toBe(false);
  }
});
