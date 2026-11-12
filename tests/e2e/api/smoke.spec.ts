// 배포 주소 확인 묶음(@smoke, 032). 로컬에서도 돌고, E2E_TARGET=preview면 배포된 주소에 붙는다
// 같은 묶음: 이 파일 + 운영 응답(api/production.spec.ts) + 전체 흐름(full-flow.spec.ts)
import { test, expect } from "../support/fixtures";
import { BASE, call } from "../support/api";

const SMOKE = { tag: "@smoke" }; // 다른 파일은 제목 끝에 @smoke를 붙였다(같은 태그로 묶인다)

test("/api/health — 200 {ok:true}, Cache-Control: no-store", SMOKE, async () => {
  const res = await call("GET", "/api/health", { origin: null });
  expect(res.status, res.text.slice(0, 200)).toBe(200);
  expect(res.json).toEqual({ ok: true });
  expect(res.cacheControl).toBe("no-store");
});

test("초대 링크가 지금 연 배포 주소로 만들어진다", SMOKE, async ({ seed }) => {
  const res = await call("POST", "/api/v1/links", { origin: BASE });
  expect(res.status, res.text.slice(0, 200)).toBe(201);
  seed.track(res.json.inviteToken);
  expect(res.json.inviteUrl).toBe(`${BASE}/p/${res.json.inviteToken}`);
  expect(res.cacheControl).toBe("no-store");

  // 그 주소가 이 배포에서 열린다
  const page = await call("GET", new URL(res.json.inviteUrl).pathname, { origin: null });
  expect(page.status).toBe(200);
  expect(page.headers["content-type"]).toContain("text/html");
});

test("다른 Origin의 상태 변경 요청은 403 INVALID_ORIGIN", SMOKE, async ({ seed }) => {
  const host = new URL(BASE).host;
  const others: [string, string | null][] = [
    ["Origin 없음", null],
    ["다른 사이트", "https://evil.example"],
    ["다른 Vercel 배포", "https://yaksok-someone-else.vercel.app"],
    ["같은 호스트 http", `http://${host}`],
    ["하위 도메인", `https://x.${host}`],
  ];
  for (const [label, origin] of others) {
    const res = await call("POST", "/api/v1/links", { origin });
    expect(res.status, `${label}: ${res.text.slice(0, 200)}`).toBe(403);
    expect(res.json?.code, label).toBe("INVALID_ORIGIN");
    expect(res.cacheControl, label).toBe("no-store");
  }

  // 링크 이후 단계(방장 등록)도 같은 검사. 거부된 요청은 아무것도 만들지 않는다(끝의 DB 스냅샷 비교로도 확인)
  const inviteToken = await seed.link();
  const res = await call("POST", `/api/v1/links/${inviteToken}/host`, {
    origin: "https://evil.example",
    body: { nickname: "다른출처", pin: "1357" },
  });
  expect(res.status).toBe(403);
  expect(res.json?.code).toBe("INVALID_ORIGIN");
  const link = await call("GET", `/api/v1/links/${inviteToken}`, { origin: null });
  expect(link.json?.nextAction).toBe("register_host");
});
