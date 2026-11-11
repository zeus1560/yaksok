// 공통 확인 모달 (029) — scripts/verify/029-modal-check.mjs에서 옮김
// 포커스 이동·복귀, Esc·바깥 클릭으로 닫기, 요청 중 닫기·버튼 막기, Tab 가두기, 헤더 닉네임, 가로 스크롤
import { test, expect } from "./support/fixtures";
import { seoulDate } from "./support/api";
import {
  CANDIDATES_TITLE,
  dialogOf,
  expectNoHScroll,
  identityOf,
  isMobile,
  text,
} from "./support/ui";
import type { Page } from "@playwright/test";

const focusedText = (page: Page) =>
  page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
const focusInDialog = (page: Page) =>
  page.evaluate(
    () =>
      !!document.activeElement?.closest('[role="alertdialog"]') ||
      document.activeElement?.getAttribute("role") === "alertdialog",
  );
// 포커스 복귀는 키보드로 연 경우를 본다. WebKit(사파리)은 마우스로 누른 버튼에 포커스를 주지 않아
// 마우스로 열면 복귀할 대상이 처음부터 없다(플랫폼 동작). 키보드 사용자가 복귀가 필요한 사람이다
async function openByKeyboard(page: Page, button: import("@playwright/test").Locator) {
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(dialogOf(page)).toBeVisible();
}
// 확인 창 바깥(화면 왼쪽 아래 구석)
async function clickOutside(page: Page) {
  const size = page.viewportSize()!;
  await page.mouse.click(5, size.height - 5);
}

const settings = {
  participantLimit: 4,
  dateRange: { startDate: seoulDate(1), endDate: seoulDate(3) },
  dailyTimeRange: { startTime: "14:00", endTime: "18:00" },
};

test("마감 확인 창: 포커스·Esc·바깥 클릭·요청 중 막기, 모든 기기 로그아웃 창", async ({
  seed,
  app,
}) => {
  const P = await seed.collecting({ members: 1, settings });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expect(identityOf(page)).toHaveText(`${P.hostNick} · 방장`, { timeout: 20_000 });
  const closeBtn = page.getByRole("button", { name: "응답 마감하기" });

  await openByKeyboard(page, closeBtn);
  await expect(dialogOf(page)).toBeVisible();
  await expect
    .poll(() => focusedText(page), { message: "열리면 포커스가 '돌아가기'로" })
    .toBe("돌아가기");
  await expect(dialogOf(page)).toHaveAttribute("aria-modal", "true");
  expect(await dialogOf(page).getAttribute("aria-labelledby")).not.toBeNull();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Tab");
  expect(await focusInDialog(page), "Tab 5번에도 창 안").toBe(true);
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+Tab");
  expect(await focusInDialog(page), "Shift+Tab 5번에도 창 안").toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialogOf(page)).toHaveCount(0);
  await expect.poll(() => focusedText(page), { message: "연 버튼으로 복귀" }).toBe("응답 마감하기");

  await openByKeyboard(page, closeBtn);
  await expect(dialogOf(page)).toBeVisible();
  await clickOutside(page);
  await expect(dialogOf(page)).toHaveCount(0);
  await expect.poll(() => focusedText(page)).toBe("응답 마감하기");

  await closeBtn.click();
  await page.getByText("마감하면 참여자 모두").click();
  await expect(dialogOf(page), "창 안 글자 클릭은 닫지 않음").toHaveCount(1);

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let closeCalls = 0;
  await page.route(`**/api/v1/promises/${P.promiseId}/close`, async (route) => {
    closeCalls += 1;
    await gate;
    await route.continue();
  });
  await dialogOf(page).getByRole("button", { name: "마감하기" }).click();
  await expect(page.getByRole("button", { name: "마감하는 중…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogOf(page), "요청 중 Esc로 닫히지 않음").toHaveCount(1);
  await clickOutside(page);
  await expect(dialogOf(page), "요청 중 바깥 클릭으로 닫히지 않음").toHaveCount(1);
  await expect(dialogOf(page).getByRole("button", { name: "닫기" })).toBeDisabled();
  await expect(dialogOf(page).getByRole("button", { name: "돌아가기" })).toBeDisabled();
  await expect(dialogOf(page).getByRole("button", { name: "마감하는 중…" })).toBeDisabled();
  await page.keyboard.press("Tab");
  expect(await focusInDialog(page), "요청 중 Tab에도 창 안").toBe(true);
  await dialogOf(page)
    .getByRole("button", { name: "마감하는 중…" })
    .click({ force: true })
    .catch(() => {});
  release();
  await expect(text(page, CANDIDATES_TITLE)).toBeVisible({ timeout: 15_000 });
  expect(closeCalls, "마감 요청 1회").toBe(1);
  await expect(dialogOf(page)).toHaveCount(0);
  await page.unroute(`**/api/v1/promises/${P.promiseId}/close`);

  await openByKeyboard(page, page.getByRole("button", { name: "모든 기기에서 로그아웃" }));
  await expect(dialogOf(page).getByRole("button", { name: "돌아가기" })).toHaveCount(1);
  await dialogOf(page).getByRole("button", { name: "돌아가기" }).click();
  await expect(dialogOf(page)).toHaveCount(0);
  await expect.poll(() => focusedText(page)).toBe("모든 기기에서 로그아웃");
  await expectNoHScroll(page);
});

test("참여자 화면 나가기 창(좁은 화면 여백)과 빈 제출 확인 창", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 1, settings });
  const m = P.members[0];
  const { page } = await app.open(P, m.token, "참여자");
  await expect(identityOf(page)).toHaveText(`${m.nickname} · 참여자`, { timeout: 20_000 });
  await expectNoHScroll(page);

  await page.getByRole("button", { name: "약속 나가기" }).click();
  await expect(dialogOf(page)).toBeVisible();
  if (isMobile(page)) {
    const box = (await dialogOf(page).boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x, "좌우 16px 여백").toBeGreaterThanOrEqual(15);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 15);
  }
  await expectNoHScroll(page);
  await page.keyboard.press("Escape");
  await expect(dialogOf(page)).toHaveCount(0);

  const submit = page.getByRole("button", { name: "가능 시간 제출" });
  await openByKeyboard(page, submit);
  await expect(dialogOf(page).getByRole("button", { name: "시간 선택으로" })).toHaveCount(1);
  await expect(dialogOf(page).getByRole("button", { name: "가능 시간 없음으로 제출" })).toHaveCount(
    1,
  );
  await page.keyboard.press("Escape");
  await expect.poll(() => focusedText(page)).toBe("가능 시간 제출");
  await submit.click();
  await dialogOf(page).getByRole("button", { name: "가능 시간 없음으로 제출" }).click();
  await expect(text(page, "제출했어요")).toBeVisible();
  await expect(dialogOf(page)).toHaveCount(0);
});
