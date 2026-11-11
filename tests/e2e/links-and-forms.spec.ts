// 그동안 확인하지 못한 화면 항목 (031 추가)
// - 7일 지난 링크의 410 화면(DB에서 시각 조작)
// - 서버 422가 입력란에 표시되는지(요청 본문을 바꿔 화면 검증을 우회)
// - 설정 시간 1분 이하 강조색
// - 세션 쿠키 속성(브라우저가 받은 값): HttpOnly·SameSite·Path(+ 로컬 https라 Secure도)
import { test, expect } from "./support/fixtures";
import { nick, seoulDate } from "./support/api";
import { ageLinkPastExpiry, agePromisePastLinkExpiry } from "./support/db";
import {
  DANGER_RGB,
  JOIN_TITLE,
  REGISTER_HOST_TITLE,
  expectInputScreen,
  expectNoHScroll,
  fillAuth,
  pickCalendarDay,
  text,
} from "./support/ui";
import type { Page, Route } from "@playwright/test";

const LINK_PROBLEM = "만료되거나 잘못된 링크";

test.describe("링크 410·404 화면", () => {
  test("7일 지난 링크(약속 없음) → 410 사용 기간 안내", async ({ seed, app }) => {
    const token = await seed.link();
    await ageLinkPastExpiry(token);
    const { page } = await app.blank("방문자");
    const res = page.waitForResponse((r) => r.url().endsWith(`/api/v1/links/${token}`));
    await page.goto(`/p/${token}`);
    expect((await res).status()).toBe(410);
    await expect(text(page, LINK_PROBLEM)).toBeVisible();
    await expect(
      text(page, "사용 기간이 지난 링크예요. 방장에게 새 링크를 요청해 주세요."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "처음으로" })).toHaveAttribute("href", "/");
    await expectNoHScroll(page);
  });

  test("마감 + 7일이 지난 약속 링크 → 참여자도 410 화면", async ({ seed, app }) => {
    const P = await seed.collecting({ members: 1 });
    await agePromisePastLinkExpiry(P.promiseId);
    const { page } = await app.open(P, P.members[0].token, "참여자");
    await expect(text(page, LINK_PROBLEM)).toBeVisible();
    await expect(text(page, "사용 기간이 지난 링크예요.")).toBeVisible();
  });

  test("없는 링크 → 404 잘못된 링크 안내(410과 설명으로 구분)", async ({ app }) => {
    const { page } = await app.blank("방문자");
    await page.goto("/p/not-a-real-token");
    await expect(text(page, LINK_PROBLEM)).toBeVisible();
    await expect(
      text(page, "링크 주소를 다시 확인하거나 방장에게 새 링크를 요청해 주세요."),
    ).toBeVisible();
  });
});

// 요청 본문 일부를 바꿔 보낸다(화면 검증은 통과한 값 → 서버만 거절하는 값)
async function rewriteBody(page: Page, url: string, patch: Record<string, unknown>) {
  let serverMessage: string | null = null;
  await page.route(url, async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = { ...JSON.parse(route.request().postData() ?? "{}"), ...patch };
    const response = await route.fetch({ postData: JSON.stringify(body) });
    const json = await response.json();
    expect([response.status(), json.code], JSON.stringify(json)).toEqual([
      422,
      "VALIDATION_FAILED",
    ]);
    serverMessage = json.message;
    await route.fulfill({ response, json });
  });
  return () => serverMessage;
}

test.describe("서버 422가 입력란에 표시", () => {
  test("방장 등록: 닉네임 422 → 닉네임 입력란", async ({ seed, app }) => {
    const token = await seed.link();
    const { page } = await app.blank("방장");
    await page.goto(`/p/${token}`);
    await expect(text(page, REGISTER_HOST_TITLE)).toBeVisible();
    const message = await rewriteBody(page, `**/api/v1/links/${token}/host`, { nickname: "가" });
    await fillAuth(page, nick("방"), "1357", "방장으로 시작하기");
    await expect.poll(message).not.toBeNull();
    await expect(page.locator("#nickname-error")).toHaveText(message()!);
    await expect(page.locator("#nickname")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#nickname")).toHaveAttribute("aria-describedby", "nickname-error");
    await expect(text(page, REGISTER_HOST_TITLE), "화면 유지").toBeVisible();
  });

  test("참여자 등록: PIN 422 → PIN 입력란", async ({ seed, app }) => {
    const P = await seed.collecting({ members: 0 });
    const { page } = await app.blank("참여자");
    await page.goto(`/p/${P.inviteToken}`);
    await expect(text(page, JOIN_TITLE)).toBeVisible();
    const message = await rewriteBody(page, `**/api/v1/promises/${P.promiseId}/participants`, {
      pin: "12",
    });
    await fillAuth(page, nick("참"), "2468", "참여하고 시간 선택하기");
    await expect.poll(message).not.toBeNull();
    await expect(page.locator("#pin-error")).toHaveText(message()!);
    await expect(page.locator("#pin")).toHaveAttribute("aria-invalid", "true");
    await expect(text(page, JOIN_TITLE)).toBeVisible();
  });

  test("설정 완료: 소요 시간 422 → 소요 시간 입력란, 고치면 저장", async ({ seed, app }) => {
    const D = await seed.draft();
    const { page } = await app.open(D, D.hostToken, "방장");
    await expect(text(page, "새 약속 만들기")).toBeVisible({ timeout: 20_000 });
    await pickCalendarDay(page, seoulDate(2));
    await pickCalendarDay(page, seoulDate(4));
    const message = await rewriteBody(page, `**/api/v1/promises/${D.promiseId}/start`, {
      durationMinutes: 45,
    });
    await page.getByRole("button", { name: "설정 완료 · 초대 링크 만들기" }).click();
    await expect.poll(message).not.toBeNull();
    await expect(page.locator("#durationMinutes-error")).toHaveText(message()!);
    await expect(text(page, "새 약속 만들기"), "설정 화면 유지").toBeVisible();
    await page.unroute(`**/api/v1/promises/${D.promiseId}/start`);
    await page.getByRole("button", { name: "설정 완료 · 초대 링크 만들기" }).click();
    await expect(text(page, "약속이 만들어졌어요")).toBeVisible();
  });
});

test("설정 시간 카운트다운: 1분 이하에서 강조색", async ({ seed, app }) => {
  const token = await seed.link();
  const { page } = await app.blank("방장");
  await page.goto(`/p/${token}`);
  const hostRes = page.waitForResponse((r) => r.url().endsWith("/host"));
  await fillAuth(page, nick("방"), "1357", "방장으로 시작하기");
  const promiseId = (await (await hostRes).json()).promiseId;
  const badge = page.getByRole("timer").locator("span").first();
  await expect(badge).toHaveText(/설정 시간 (10:00|9:5\d) 남음/);
  const colorOf = () => badge.evaluate((el) => getComputedStyle(el).color);
  expect(await colorOf(), "10분 남음: 강조색 아님").not.toBe(DANGER_RGB);
  // 기기 시각 기준 기준값을 1분 3초 남은 값으로 바꾸고 다시 연다(저장값은 카운트다운 기준값일 뿐, R-15·R-17)
  await page.evaluate(
    ([t, p]) =>
      localStorage.setItem(
        `yaksok:setup:${t}`,
        JSON.stringify({ promiseId: p, localExpiresAt: Date.now() + 63_000 }),
      ),
    [token, promiseId],
  );
  await page.reload();
  await expect(badge).toHaveText(/설정 시간 1:0\d 남음/);
  expect(await colorOf(), "1분 넘게 남음: 강조색 아님").not.toBe(DANGER_RGB);
  await expect(badge).toHaveText(/설정 시간 (1:00|0:\d\d) 남음/, { timeout: 8000 });
  await expect.poll(colorOf, { message: "1분 이하: 강조색" }).toBe(DANGER_RGB);
});

test("브라우저가 받은 세션 쿠키 속성과 HttpOnly(스크립트에서 안 보임)", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 0 });
  const { page, context } = await app.blank("참여자");
  await page.goto(`/p/${P.inviteToken}`);
  const name = nick("쿠");
  const registered = page.waitForResponse(
    (r) => r.url().endsWith("/participants") && r.request().method() === "POST",
  );
  await fillAuth(page, name, "2468", "참여하고 시간 선택하기");
  // 브라우저가 받은 Set-Cookie 원문(WebKit도 같은 값을 받는지)
  const setCookie = (await (await registered).headerValue("set-cookie")) ?? "";
  expect(setCookie).toContain(`ys_session_${P.promiseId}=`);
  for (const attr of [
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Path=/api/v1/promises/${P.promiseId}`,
  ]) {
    expect(setCookie, attr).toContain(attr);
  }
  await expectInputScreen(page, name);
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith("ys_session_"));
  expect(cookies).toHaveLength(1);
  const [c] = cookies;
  expect(c.name).toBe(`ys_session_${P.promiseId}`);
  expect(c.httpOnly, "HttpOnly").toBe(true);
  // Windows용 Playwright WebKit은 저장한 쿠키의 SameSite를 항상 None으로 보고한다(도구 한계). 그래서 저장값의
  // SameSite는 chromium에서만 보고, WebKit은 위의 Set-Cookie 원문으로 확인한다
  if (test.info().project.name.startsWith("chromium")) expect(c.sameSite, "SameSite").toBe("Lax");
  expect(c.path, "Path").toBe(`/api/v1/promises/${P.promiseId}`);
  expect(c.domain, "호스트 전용").toBe("localhost");
  expect(c.secure, "Secure(로컬 https 프록시라 확인 가능)").toBe(true);
  expect(c.expires * 1000, "만료 시각 = 마감 + 7일 근처").toBeGreaterThan(Date.now() + 6 * 86400e3);
  expect(await page.evaluate(() => document.cookie)).not.toContain("ys_session_");
});
