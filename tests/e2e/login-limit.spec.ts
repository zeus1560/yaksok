// 429 화면 안내(035, R-41): 로그인 잠금 안내(남은 분만, 남은 횟수 없음), 요청 수 초과 안내
import { test, expect } from "./support/fixtures";
import { MEMBER_PIN, call } from "./support/api";
import { testIp } from "./support/e2e-env";
import type { Page } from "@playwright/test";
import { fillAuth, text } from "./support/ui";

// 폼 아래 안내(role=alert). Next.js 경로 안내 요소도 role=alert라 문구로 거른다
const alertWith = (page: Page, message: string) =>
  page.getByRole("alert").filter({ hasText: message });

test("로그인 화면: PIN을 5번 틀리면 맞는 PIN에도 잠금 안내, 남은 시도 횟수는 보이지 않는다", async ({
  seed,
  app,
}) => {
  const P = await seed.collecting({ members: 1 });
  const [m] = P.members;
  const ip = testIp();
  // 같은 IP로 4번은 API, 5번째는 화면에서 틀린다
  for (let i = 0; i < 4; i += 1) {
    await call("POST", `/api/v1/promises/${P.promiseId}/auth/session`, {
      ip,
      body: { nickname: m.nickname, pin: "0000" },
    });
  }
  const { page } = await app.blank("참여자", { ip });
  await page.goto(`/p/${P.inviteToken}`);
  await page.getByRole("button", { name: "이미 참여했어요 · 다시 로그인" }).click();
  await fillAuth(page, m.nickname, "0000", "로그인");
  await expect(alertWith(page, "닉네임 또는 PIN이 맞지 않아요.")).toBeVisible();

  await page.locator("#pin").fill(MEMBER_PIN);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    alertWith(page, "PIN을 여러 번 틀려 잠시 막혔어요. 15분 뒤에 다시 시도해 주세요."),
  ).toBeVisible();
  await expect(text(page, "다시 로그인하기")).toBeVisible();
  await expect(page.getByText(/남은|회 남았/)).toHaveCount(0);
});

test("홈: 링크 발급 요청이 너무 많으면 안내한다", async ({ seed, app }) => {
  const ip = testIp();
  // 1분 10회를 API로 먼저 채운다
  for (let i = 0; i < 10; i += 1) {
    const res = await call("POST", "/api/v1/links", { ip });
    if (res.status === 201) seed.track(res.json.inviteToken);
  }
  const { page } = await app.blank("방장", { ip });
  await page.goto("/");
  await page.getByRole("button", { name: "새 약속 만들기" }).click();
  await expect(alertWith(page, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
