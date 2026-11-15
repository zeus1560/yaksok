// 휴대폰 그리드 보기 개선 (034, R-39): 날짜 4일씩 넘기기(탭 간 공유), 「내 시간」 표시 단위(30분·1시간·2시간)와 n/m,
// 묶은 칸 누름, 하루 토글 되돌리기 알림, 드래그 중 화면 끝 자동 스크롤. 데스크톱(두 그리드 나란히)은 그대로
// 터치 흉내 방식은 mobile-drag.spec.ts와 같다(webkit 모바일 = 합성 PointerEvent, chromium = CDP 실제 터치)
import { devices, type Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { as, seoulDate, slotAt, slotMs, type Seed } from "./support/api";
import { db } from "./support/db";
import {
  dayRange,
  dayText,
  dayToggle,
  expectInputScreen,
  expectNoHScroll,
  myCell,
  myGroup,
  pressedCells,
  selectedCount,
} from "./support/ui";

// 날짜 범위 시작이 내일(seoulDate(1))이라 slotMs(2, …)는 두 번째 열
const WEEK = {
  dateRange: { startDate: seoulDate(1), endDate: seoulDate(7) },
  dailyTimeRange: { startTime: "09:00", endTime: "22:00" },
  durationMinutes: 90,
};
// 자동 스크롤용: 하루 06:00~24:00(36칸)이라 그리드가 화면보다 길다
const LONG_DAY = { ...WEEK, dailyTimeRange: { startTime: "06:00", endTime: "24:00" } };

const mobileOnly = () => test.skip(test.info().project.name !== "webkit-mobile", "휴대폰 화면");
const unitButton = (page: Page, label: string) =>
  page.getByRole("group", { name: "표시 단위" }).getByRole("button", { name: label, exact: true });
const visibleButton = (page: Page, name: string) =>
  page.getByRole("button", { name }).filter({ visible: true });
const headerCount = (page: Page, grid: string) =>
  page.locator(`[aria-label="${grid}"] > div > div.h-12`).count();
const modeButton = (page: Page) => page.getByRole("button", { name: "드래그로 선택" });
const dockTop = (page: Page) =>
  page.evaluate(() => document.querySelector("[data-drag-dock]")!.getBoundingClientRect().top);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

async function center(locator: ReturnType<Page["locator"]>) {
  const b = (await locator.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test("휴대폰: 날짜 4일씩 넘기기 — 첫·마지막 구간 버튼 흐림, 가로 스크롤 없음, 「모두의 시간」과 같은 구간", async ({
  seed,
  app,
}) => {
  mobileOnly();
  const P = await seed.collecting({ members: 0, settings: WEEK });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);

  await expect(
    page.getByRole("heading", { name: "내 가능 시간" }),
    "휴대폰은 제목 줄 없음(탭 「내 시간」과 겹침)",
  ).toBeHidden();
  await expect(dayRange(page)).toHaveText(`${dayText(seoulDate(1))} – ${dayText(seoulDate(4))}`);
  await expect(visibleButton(page, "이전 4일")).toBeDisabled();
  await expect(visibleButton(page, "다음 4일")).toBeEnabled();
  expect(await headerCount(page, "내 가능 시간")).toBe(4);
  const grid = page.locator('[aria-label="내 가능 시간"]');
  expect(
    await grid.evaluate((el) => el.scrollWidth <= el.clientWidth),
    "그리드 가로 스크롤 없음",
  ).toBe(true);
  // 4일이 그리드 폭에 딱 맞는다: 마지막 날 칸의 오른쪽 끝 = 그리드 안쪽 오른쪽 끝
  const last = (await myCell(page, slotMs(4, "09:00")).boundingBox())!;
  const frame = (await grid.boundingBox())!;
  expect(Math.abs(last.x + last.width - (frame.x + frame.width - 1))).toBeLessThan(2);

  await visibleButton(page, "다음 4일").tap();
  await expect(dayRange(page)).toHaveText(`${dayText(seoulDate(5))} – ${dayText(seoulDate(7))}`);
  await expect(visibleButton(page, "다음 4일")).toBeDisabled();
  await expect(visibleButton(page, "이전 4일")).toBeEnabled();
  expect(await headerCount(page, "내 가능 시간"), "마지막 구간은 남은 3일").toBe(3);
  await expect(myCell(page, slotMs(1, "09:00"))).toHaveCount(0);
  await expect(myCell(page, slotMs(5, "09:00"))).toHaveCount(1);

  await page.getByRole("tab", { name: "모두의 시간" }).tap();
  await expect(dayRange(page), "탭을 바꿔도 같은 구간").toHaveText(
    `${dayText(seoulDate(5))} – ${dayText(seoulDate(7))}`,
  );
  const everyone = (ms: number) =>
    page.locator(`[aria-label="모두의 가능 시간"] button[data-slot="${ms}"]`);
  await expect(everyone(slotMs(5, "09:00"))).toHaveCount(1);
  await expect(everyone(slotMs(1, "09:00"))).toHaveCount(0);
  await visibleButton(page, "이전 4일").tap();
  await expect(dayRange(page)).toHaveText(`${dayText(seoulDate(1))} – ${dayText(seoulDate(4))}`);
  await page.getByRole("tab", { name: "내 시간" }).tap();
  await expect(dayRange(page)).toHaveText(`${dayText(seoulDate(1))} – ${dayText(seoulDate(4))}`);
  await expectNoHScroll(page);
});

test("휴대폰: 처음 열면 오늘(지나지 않은 첫 날)이 든 구간", async ({ seed, app }) => {
  mobileOnly();
  const P = await seed.collecting({
    members: 0,
    settings: { ...WEEK, dateRange: { startDate: seoulDate(0), endDate: seoulDate(3) } },
  });
  // 약속 범위 첫날을 5일 전으로 옮긴다(화면만 확인, API로는 지난 날짜를 고를 수 없음) → 구간 [-5~-2] [-1~2] [3]
  await db().query(`UPDATE promises SET date_range_start = $2::date WHERE id = $1`, [
    P.promiseId,
    seoulDate(-5),
  ]);
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  // 22:00 뒤에 돌면 오늘 칸이 모두 지나 첫 날이 내일이 되지만 같은 구간이다
  await expect(dayRange(page)).toHaveText(`${dayText(seoulDate(-1))} – ${dayText(seoulDate(2))}`);
  await expect(visibleButton(page, "이전 4일")).toBeEnabled();
  await expect(visibleButton(page, "다음 4일")).toBeEnabled();
});

test("휴대폰: 표시 단위 30분·1시간·2시간 — n/m 표시, 묶은 칸 누름, 단위를 바꿔도 선택 그대로, 기기에 기억", async ({
  seed,
  app,
}) => {
  mobileOnly();
  const P = await seed.collecting({ members: 0, settings: WEEK });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  const at9 = slotMs(2, "09:00");
  await expect(unitButton(page, "30분")).toHaveAttribute("aria-pressed", "true");

  await myCell(page, at9).tap();
  await myCell(page, slotMs(2, "09:30")).tap();
  await expect.poll(() => selectedCount(page)).toBe(2);
  await expect(myCell(page, at9).locator("svg"), "30분 칸에도 체크 표시").toHaveCount(1);

  await unitButton(page, "2시간").tap();
  await expect(unitButton(page, "2시간")).toHaveAttribute("aria-pressed", "true");
  await expect(myCell(page, at9), "30분 칸 대신 묶은 칸").toHaveCount(0);
  const g = myGroup(page, at9);
  await expect(g).toHaveText("2/4");
  await expect(g).toHaveAttribute("aria-pressed", "mixed");
  await expect(g).toHaveAttribute("aria-label", /09:00–11:00, 4칸 중 2칸 선택$/);
  await expect(myGroup(page, slotMs(2, "21:00")), "끝에 남는 짧은 묶음").toHaveAttribute(
    "aria-label",
    /21:00–22:00, 2칸, 선택 없음$/,
  );

  await unitButton(page, "1시간").tap();
  await expect(myGroup(page, at9)).toHaveAttribute("aria-pressed", "true");
  await expect(myGroup(page, at9)).toHaveAttribute("aria-label", /09:00–10:00, 2칸 모두 선택$/);
  await expect(myGroup(page, slotMs(2, "10:00"))).toHaveAttribute("aria-pressed", "false");

  await unitButton(page, "30분").tap();
  await expect(myCell(page, at9)).toHaveAttribute("aria-pressed", "true");
  await expect(myCell(page, slotMs(2, "09:30"))).toHaveAttribute("aria-pressed", "true");
  expect(await selectedCount(page)).toBe(2);

  // 묶은 칸 누름: 일부 → 전부(지나지 않은 칸 모두), 전부 → 전부 해제
  await unitButton(page, "2시간").tap();
  await myGroup(page, at9).tap();
  await expect(myGroup(page, at9)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => selectedCount(page)).toBe(4);
  await myGroup(page, at9).tap();
  await expect(myGroup(page, at9)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => selectedCount(page)).toBe(0);
  await myGroup(page, slotMs(3, "11:00")).tap();
  await expect.poll(() => selectedCount(page)).toBe(4);

  // 새로고침해도 2시간 보기(기기에 기억), 제출 전 입력도 그대로
  await page.reload();
  await expectInputScreen(page, P.hostNick);
  await expect(unitButton(page, "2시간")).toHaveAttribute("aria-pressed", "true");
  await expect(myGroup(page, slotMs(3, "11:00"))).toHaveAttribute("aria-pressed", "true");
  expect(await pressedCells(page)).toBe(1);
});

test("휴대폰: 묶은 칸 단위로 끌기(드래그로 선택) — 사각형을 첫 칸의 반대 상태로", async ({
  seed,
  app,
}) => {
  mobileOnly();
  const P = await seed.collecting({ members: 0, settings: WEEK });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  await unitButton(page, "2시간").tap();
  await modeButton(page).tap();
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "true");
  const from = myGroup(page, slotMs(2, "09:00"));
  const to = myGroup(page, slotMs(3, "11:00"));
  await syntheticTouchDrag(page, from, to);
  // 2일 × 2시간 묶음 2개 = 30분 칸 16개
  await expect.poll(() => selectedCount(page)).toBe(16);
  expect(await pressedCells(page)).toBe(4);
  // 전부 선택된 묶은 칸에서 시작하면 해제
  await syntheticTouchDrag(page, to, to);
  await expect.poll(() => selectedCount(page)).toBe(12);
});

test("휴대폰: 날짜 머리글 하루 토글 → 「되돌리기」 알림(약 3초), 되돌리면 그날만 직전 상태로", async ({
  seed,
  app,
}) => {
  mobileOnly();
  const P = await seed.collecting({ members: 0, settings: WEEK });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  const one = slotMs(3, "10:00");
  await myCell(page, one).tap();
  await myCell(page, slotMs(2, "12:00")).tap();
  await expect.poll(() => selectedCount(page)).toBe(2);

  await dayToggle(page, seoulDate(3)).tap();
  const toast = page.getByRole("status").filter({ hasText: "되돌리기" });
  await expect(toast).toContainText(`${dayText(seoulDate(3))} 전체 선택됨`);
  await expect.poll(() => selectedCount(page)).toBe(27); // 그날 26칸 + 다른 날 1칸
  await toast.getByRole("button", { name: "되돌리기" }).tap();
  await expect.poll(() => selectedCount(page)).toBe(2);
  await expect(myCell(page, one)).toHaveAttribute("aria-pressed", "true");
  await expect(toast).toHaveCount(0);

  // 건드리지 않으면 약 3초 뒤 저절로 닫힌다
  await dayToggle(page, seoulDate(3)).tap();
  await expect(toast).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(toast, "1.5초에는 아직 보임").toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 4000 });
  expect(await selectedCount(page), "닫혀도 하루 선택은 그대로").toBe(27);

  await dayToggle(page, seoulDate(3)).tap();
  await expect(toast).toContainText(`${dayText(seoulDate(3))} 전체 해제됨`);
  await expect.poll(() => selectedCount(page)).toBe(1);
});

test("휴대폰: 범례는 제출 바 「?」를 눌렀을 때만 — 칸 모양 네 가지 한 줄과 하루 선택 한 줄", async ({
  seed,
  app,
}) => {
  mobileOnly();
  const P = await seed.collecting({ members: 0, settings: WEEK });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  const legend = page.locator("[data-cell-key]").filter({ visible: true });
  await expect(legend).toHaveCount(0);
  const help = page.getByRole("button", { name: "칸 색 안내" });
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await help.tap();
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(legend).toHaveCount(1);
  const panel = page.locator("#grid-help");
  const names = await panel
    .locator("[data-cell-key] > span")
    .evaluateAll((items) => items.map((el) => el.textContent?.trim()));
  // 견본 글자(n/m·—) + 이름. 선택 견본의 체크는 SVG라 글자가 없다
  expect(names).toEqual(["선택", "n/m일부", "—지난 시간", "선택 안 함"]);
  const tops = await panel
    .locator("[data-cell-key] > span")
    .evaluateAll((items) => items.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size, "견본 네 가지가 한 줄").toBe(1);
  await expect(panel.locator("p")).toHaveText(["날짜를 누르면 하루 전체를 골라요."]);
  await help.tap();
  await expect(legend).toHaveCount(0);
});

// 도구 줄(단위 선택 + 드래그 버튼)이 한 줄: 두 요소의 세로 위치가 같고 도구 줄이 그리드 폭을 넘지 않는다
async function expectToolbarOneLine(page: Page) {
  const unit = (await page.getByRole("group", { name: "표시 단위" }).boundingBox())!;
  const drag = (await modeButton(page).boundingBox())!;
  expect(Math.abs(unit.y - drag.y), "단위 선택과 드래그 버튼이 같은 줄").toBeLessThan(2);
  const bar = (await page.locator("[data-toolbar]").boundingBox())!;
  expect(drag.x + drag.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
  await expectNoHScroll(page);
}

// 제출 바 선택 요약: 좁은 화면은 짧은 문구 한 줄(잘리지 않음), 화면 낭독기용 전체 문구는 그대로 남는다
async function expectSummaryOneLine(page: Page, short: string, full: string) {
  const line = page.locator("[data-selected-slots]");
  const shown = line.locator("[data-summary-short]");
  await expect(shown).toHaveText(short);
  await expect(shown).toBeVisible();
  await expect(shown).toHaveAttribute("aria-hidden", "true");
  const box = await line.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    cut: el.scrollWidth > el.clientWidth,
  }));
  expect(box.height, "제출 바 문구 한 줄").toBeLessThan(box.lineHeight * 1.5);
  expect(box.cut, "말줄임 없이 다 보임").toBe(false);
  // 접근성 트리: 전체 문구만 있고 짧은 문구(aria-hidden)는 없다
  const tree = await line.ariaSnapshot();
  expect(tree, "화면 낭독기는 전체 문구").toContain(full);
  expect(tree).not.toContain(short);
}

// 선택 없음 → 1일 3칸(1시간 30분) 선택에서 제출 바 문구 확인
async function checkSummary(page: Page) {
  await expectSummaryOneLine(page, "선택 없음", "아직 선택한 시간이 없어요");
  for (const t of ["09:00", "09:30", "10:00"]) await myCell(page, slotMs(2, t)).tap();
  await expect.poll(() => selectedCount(page)).toBe(3);
  await expectSummaryOneLine(page, "1일 · 1시간 30분", "1일 · 총 1시간 30분 선택");
}

test("휴대폰: 도구 줄·제출 바 문구 한 줄 — 드래그 버튼은 손가락 아이콘 + 「드래그」, 이름은 「드래그로 선택」, 켜짐은 색·aria-pressed", async ({
  seed,
  app,
}) => {
  mobileOnly();
  const P = await seed.collecting({ members: 0, settings: WEEK });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  await expect(modeButton(page)).toHaveText("드래그");
  await expect(modeButton(page).locator("svg")).toHaveCount(1);
  await expectToolbarOneLine(page);
  await checkSummary(page);
  const off = await modeButton(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  await modeButton(page).tap();
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText(
      "그리드 위에서는 끌어서 고르고, 스크롤은 날짜·시각 줄이나 그리드 밖에서 해 주세요.",
    ),
  ).toBeVisible();
  const on = await modeButton(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(on, "켜짐은 색으로 구분").not.toBe(off);
  await expectToolbarOneLine(page);
});

test("휴대폰 360px(chromium 터치 흉내): 도구 줄·제출 바 문구 한 줄", async ({ seed, app }) => {
  test.skip(test.info().project.name !== "chromium-desktop", "360px 휴대폰 흉내는 chromium");
  const P = await seed.collecting({ members: 0, settings: WEEK });
  const { page } = await app.open(P, P.hostToken, "방장", {
    viewport: { width: 360, height: 780 },
    userAgent: devices["Pixel 7"].userAgent,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await expectInputScreen(page, P.hostNick);
  await expect(modeButton(page)).toBeVisible();
  await checkSummary(page);
  for (const label of ["2시간", "30분"]) {
    await unitButton(page, label).tap();
    await expectToolbarOneLine(page);
  }
  await modeButton(page).tap();
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "true");
  await expectToolbarOneLine(page);
});

test("휴대폰: 드래그 중 화면 아래 끝에서 자동 스크롤, 스크롤된 만큼 칸이 더 선택된다 (합성 터치)", async ({
  seed,
  app,
}) => {
  mobileOnly();
  const P = await seed.collecting({ members: 0, settings: LONG_DAY });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  await modeButton(page).tap();
  const start = myCell(page, slotMs(2, "07:00"));
  await start.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -100));
  const from = await center(start);
  const edgeY = (await dockTop(page)) - 12;
  const before = await scrollY(page);
  // 끝에 닿은 손가락 자리에서 스크롤 없이 고를 수 있는 칸 수(30px 칸)
  const still = Math.floor((edgeY - (from.y - 15)) / 30) + 1;
  await start.evaluate(
    async (el, { a, y }) => {
      const fire = (target: EventTarget, type: string, cy: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 9,
            pointerType: "touch",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            clientX: a.x,
            clientY: cy,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      fire(el, "pointerdown", a.y);
      for (let i = 1; i <= 5; i += 1) fire(document, "pointermove", a.y + ((y - a.y) * i) / 5);
      await new Promise((r) => setTimeout(r, 900)); // 손가락을 끝에 둔 채
      fire(document, "pointerup", y);
    },
    { a: from, y: edgeY },
  );
  const after = await scrollY(page);
  expect(after - before, "아래로 자동 스크롤").toBeGreaterThan(60);
  const count = await selectedCount(page);
  expect(count, `스크롤 없이 ${still}칸 → 스크롤로 더`).toBeGreaterThan(still + 1);
});

test("휴대폰 실제 터치(chromium CDP): 드래그 중 화면 끝 자동 스크롤과 손가락 아래 칸 반영", async ({
  seed,
  app,
}) => {
  test.skip(test.info().project.name !== "chromium-desktop", "CDP 터치는 chromium만");
  const pixel = devices["Pixel 7"];
  const P = await seed.collecting({ members: 0, settings: LONG_DAY });
  const { context, page } = await app.open(P, P.hostToken, "방장", {
    viewport: { width: 390, height: 844 },
    userAgent: pixel.userAgent,
    deviceScaleFactor: pixel.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  });
  await expectInputScreen(page, P.hostNick);
  const cdp = await context.newCDPSession(page);
  await modeButton(page).tap();
  const start = myCell(page, slotMs(2, "07:00"));
  await start.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -100));
  await page.waitForTimeout(300);
  const a = await center(start);
  const edgeY = (await dockTop(page)) - 12;
  const before = await scrollY(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
  for (let i = 1; i <= 10; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: a.x, y: a.y + ((edgeY - a.y) * i) / 10 }],
    });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(400); // 길면 그리드 끝을 지나간다
  // 위로 다시 끌어 올리면 멈춘다(끝에서 벗어남)
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: a.x, y: edgeY - 200 }],
  });
  const stopped = await scrollY(page);
  await page.waitForTimeout(300);
  expect(await scrollY(page), "끝에서 벗어나면 멈춤").toBe(stopped);
  const expected = await rowsTo(page, slotMs(2, "07:00"), a.x, edgeY - 200);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(stopped - before, "아래로 자동 스크롤").toBeGreaterThan(60);
  // 놓은 손가락 아래 칸까지: 스크롤된 만큼 스크롤 전 같은 자리의 칸보다 아래
  expect(expected).toBeGreaterThan(Math.floor((edgeY - 200 - a.y) / 30) + 2);
  await expect.poll(() => selectedCount(page)).toBe(expected);
});

// 시작 칸부터 화면 좌표(x, y) 아래 칸까지의 30분 칸 수(같은 날)
async function rowsTo(page: Page, startMs: number, x: number, y: number) {
  const slot = await page.evaluate(
    ({ x, y }) =>
      (document.elementFromPoint(x, y)?.closest("[data-slot]") as HTMLElement | null)?.dataset.slot,
    { x, y },
  );
  expect(slot, "좌표 아래에 칸이 있음").toBeTruthy();
  return (Number(slot) - startMs) / (30 * 60 * 1000) + 1;
}

// ── 모두의 시간 표시 단위와 사람 목록 (034 실기기 확인 뒤 추가, R-40)
// 두 번째 날 09:00–11:00: 첫째 = 네 칸 모두, 둘째 = 09:00·09:30, 셋째 = 10:30. 참여자 = 방장 + 3명
async function seedEveryone(seed: Seed) {
  const P = await seed.collecting({ members: 3, settings: WEEK });
  const [a, b, c] = P.members;
  const pick = (times: string[]) => times.map((t) => slotAt(2, t));
  expect(
    (await as(P.promiseId, a.token).submit(pick(["09:00", "09:30", "10:00", "10:30"]))).status,
  ).toBe(200);
  expect((await as(P.promiseId, b.token).submit(pick(["09:00", "09:30"]))).status).toBe(200);
  expect((await as(P.promiseId, c.token).submit(pick(["10:30"]))).status).toBe(200);
  return P;
}
const everyoneCell = (page: Page, attr: "data-slot" | "data-group", ms: number) =>
  page.locator(`[aria-label="모두의 가능 시간"] button[${attr}="${ms}"]`);

test("휴대폰: 모두의 시간도 같은 표시 단위 — 묶은 칸 숫자는 내내 가능한 사람, 누르면 아래 창에 내내·일부만 가능", async ({
  seed,
  app,
}) => {
  mobileOnly();
  const P = await seedEveryone(seed);
  const [a, b, c] = P.members;
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);

  // 내 시간에서 2시간 → 모두의 시간도 2시간(두 탭이 같은 단위), 드래그 버튼은 모두의 시간에 없음
  await unitButton(page, "2시간").tap();
  await page.getByRole("tab", { name: "모두의 시간" }).tap();
  await expect(unitButton(page, "2시간")).toHaveAttribute("aria-pressed", "true");
  await expect(modeButton(page)).toBeHidden();
  const g9 = everyoneCell(page, "data-group", slotMs(2, "09:00"));
  await expect(g9).toHaveText("1");
  await expect(g9).toHaveAttribute("aria-label", /09:00–11:00 내내 가능 1명, 일부만 가능 2명$/);

  // 누르면 아래에서 올라오는 창: 내내 가능 / 일부만 가능(가능한 시간)
  await g9.tap();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("09:00–11:00 · 내내 가능 1/4명");
  await expect(sheet.getByRole("region", { name: "내내 가능" }).locator("li")).toHaveText([
    a.nickname,
  ]);
  await expect(sheet.getByRole("region", { name: "일부만 가능" }).locator("li")).toHaveText([
    `${b.nickname}09:00–10:00`,
    `${c.nickname}10:30–11:00`,
  ]);
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(box.y + box.height), "화면 아래에 붙은 창").toBe(viewport.height);

  // 아무도 없는 칸
  await everyoneCell(page, "data-group", slotMs(2, "13:00")).tap();
  await expect(sheet).toContainText("이 시간에 가능한 사람이 없어요.");
  await sheet.getByRole("button", { name: "닫기" }).tap();
  await expect(sheet).toHaveCount(0);

  // 모두의 시간에서 30분으로 바꾸면 내 시간도 30분, 30분 칸은 그 30분에 가능한 사람
  await unitButton(page, "30분").tap();
  const s9 = everyoneCell(page, "data-slot", slotMs(2, "09:00"));
  await expect(s9).toHaveText("2");
  await s9.tap();
  await expect(sheet).toContainText("09:00–09:30 · 가능 2/4명");
  await expect(sheet.locator("li")).toHaveText([a.nickname, b.nickname]);
  await page.getByRole("tab", { name: "내 시간" }).tap();
  await expect(sheet, "내 시간 탭에서는 창이 없다").toHaveCount(0);
  await expect(unitButton(page, "30분")).toHaveAttribute("aria-pressed", "true");
  await expectNoHScroll(page);
});

test("데스크톱: 모두의 시간 칸 상세는 그리드 아래 그대로(아래 창 없음)", async ({ seed, app }) => {
  test.skip(test.info().project.name === "webkit-mobile", "마우스 데스크톱");
  const P = await seedEveryone(seed);
  const [a, b] = P.members;
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  await everyoneCell(page, "data-slot", slotMs(2, "09:00")).click();
  const panel = page.locator("[data-people-detail]");
  await expect(panel).toContainText("09:00–09:30 · 가능 2/4명");
  await expect(panel.locator("li")).toHaveText([a.nickname, b.nickname]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "표시 단위" })).toHaveCount(0);
});

test("데스크톱: 마우스 드래그 중 화면 아래 끝에서 자동 스크롤, 날짜 넘기기·표시 단위 없음", async ({
  seed,
  app,
}) => {
  test.skip(test.info().project.name === "webkit-mobile", "마우스 데스크톱");
  const P = await seed.collecting({ members: 0, settings: LONG_DAY });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  // 넓은 화면은 그대로: 모든 날짜, 날짜 넘기기·표시 단위·「?」 없음, 범례는 그리드 위
  await expect(page.locator("[data-day-range]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "내 가능 시간" })).toBeVisible();
  await expect(page.getByText("아직 선택한 시간이 없어요", { exact: true })).toBeVisible();
  await expect(page.locator("[data-summary-short]")).toBeHidden();
  await expect(page.getByRole("group", { name: "표시 단위" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "칸 색 안내" })).toBeHidden();
  await expect(page.getByText("지난 시간", { exact: true }).first()).toBeVisible();
  await expect(myCell(page, slotMs(7, "06:00"))).toHaveCount(1);

  const start = myCell(page, slotMs(2, "07:00"));
  await start.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -100));
  const a = await center(start);
  const edgeY = (await dockTop(page)) - 12;
  const before = await scrollY(page);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, edgeY, { steps: 8 });
  await page.waitForTimeout(400); // 길면 그리드 끝을 지나간다
  await page.mouse.move(a.x, edgeY - 200, { steps: 2 });
  const end = await scrollY(page);
  const expected = await rowsTo(page, slotMs(2, "07:00"), a.x, edgeY - 200);
  await page.mouse.up();
  expect(end - before, "아래로 자동 스크롤").toBeGreaterThan(60);
  // 놓은 자리(끝에서 200px 위)의 칸까지 사각형이 이어진다 — 스크롤된 만큼 시작 칸에서 멀어졌다
  expect(expected).toBeGreaterThan(Math.floor((edgeY - 200 - a.y) / 30) + 2);
  await expect.poll(() => selectedCount(page)).toBe(expected);
});

// 합성 터치 끌기(mobile-drag.spec.ts와 같은 방식): 누른 칸에서 pointerdown → 창에 pointermove → pointerup
async function syntheticTouchDrag(
  page: Page,
  from: ReturnType<Page["locator"]>,
  to: ReturnType<Page["locator"]>,
) {
  const a = await center(from);
  const b = await center(to);
  await from.evaluate(
    (el, { a, b }) => {
      const fire = (target: EventTarget, type: string, x: number, y: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: "touch",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      fire(el, "pointerdown", a.x, a.y);
      for (let i = 1; i <= 6; i += 1)
        fire(document, "pointermove", a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
      fire(document, "pointerup", b.x, b.y);
    },
    { a, b },
  );
}
