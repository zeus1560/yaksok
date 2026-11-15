// 휴대폰 드래그 선택 (033, R-38): 「드래그로 선택」을 켜면 손가락으로 끌어 여러 칸, 끄면 지금처럼 스크롤
// 터치 흉내 방식(실기기와의 차이는 033 보고서·MOBILE_CHECKLIST 10절):
// - webkit 모바일(iPhone 13 흉내): Playwright에 터치 이동 API가 없어 손가락 끌기는 합성 PointerEvent(pointerType touch)로
//   보낸다 — 화면 코드(포인터 처리·좌표 → 칸·탭 중복 방지)는 실제와 같이 돌지만, 브라우저의 touch-action·스크롤 판단은
//   거치지 않는다. 그래서 스크롤 막기는 칸·머리글의 계산된 touch-action으로 확인한다. 탭은 실제 터치(touchscreen.tap)
// - chromium(휴대폰 흉내 컨텍스트): CDP Input.dispatchTouchEvent로 실제 터치를 보낸다 — 브라우저가 touch-action을 보고
//   스크롤할지 포인터 이벤트를 줄지 정하므로, 켠 상태 끌기 = 칸 선택·스크롤 없음, 끈 상태 끌기 = 스크롤·칸 그대로를 본다
import { devices, type Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { seoulDate, slotMs } from "./support/api";
import { expectInputScreen, myCell, pressedCells } from "./support/ui";

const MODE = "드래그로 선택";
const HINT = "그리드 위에서는 끌어서 고르고, 스크롤은 날짜·시각 줄이나 그리드 밖에서 해 주세요.";
// 날짜 범위 시작이 내일(seoulDate(1))이라 slotMs(2, …)는 두 번째 열
const SETTINGS = {
  dateRange: { startDate: seoulDate(1), endDate: seoulDate(7) },
  dailyTimeRange: { startTime: "09:00", endTime: "22:00" },
  durationMinutes: 90,
};

const modeButton = (page: Page) => page.getByRole("button", { name: MODE });
// 칸을 감싼 틀(touch-action을 다는 곳)과 날짜 머리글 틀의 계산된 touch-action
const touchAction = (page: Page, ms: number) =>
  myCell(page, ms).evaluate((el) => getComputedStyle(el.parentElement!).touchAction);
const headerTouchAction = (page: Page) =>
  page
    .getByRole("button", { name: /하루 전체 선택 또는 해제$/ })
    .first()
    .evaluate((el) => getComputedStyle(el.parentElement!).touchAction);

async function center(page: Page, ms: number) {
  const b = (await myCell(page, ms).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// 합성 터치 끌기: 누른 칸에서 pointerdown → 창에 pointermove(좌표) → pointerup. 실제 터치처럼 click은 보내지 않는다
async function syntheticTouchDrag(page: Page, from: number, to: number) {
  const a = await center(page, from);
  const b = await center(page, to);
  await myCell(page, from).evaluate(
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

test("휴대폰: 「드래그로 선택」 켜고 끄기 — 눌림·테두리·안내 1회, 켰을 때만 칸 영역 스크롤 막기", async ({
  seed,
  app,
}) => {
  test.skip(test.info().project.name !== "webkit-mobile", "터치 기기 화면");
  const P = await seed.collecting({ members: 0, settings: SETTINGS });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  const cell = slotMs(2, "18:00");
  const grid = page.locator('[aria-label="내 가능 시간"]');

  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "false");
  expect(await touchAction(page, cell)).toBe("auto");
  await expect(grid).not.toHaveAttribute("data-selecting");

  await modeButton(page).tap();
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: HINT })).toBeVisible();
  await expect(grid).toHaveAttribute("data-selecting", "true");
  expect(await touchAction(page, cell)).toBe("none");
  expect(await headerTouchAction(page), "날짜 머리글은 켜도 스크롤된다").toBe("auto");

  await modeButton(page).tap();
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(HINT)).toHaveCount(0);
  expect(await touchAction(page, cell)).toBe("auto");

  await modeButton(page).tap();
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(HINT), "안내는 처음 켤 때 한 번").toHaveCount(0);
});

test("휴대폰: 켜면 끌어서 사각형으로 여러 칸, 꺼져 있으면 끌어도 그대로, 탭은 늘 한 칸 (합성 터치)", async ({
  seed,
  app,
}) => {
  test.skip(test.info().project.name !== "webkit-mobile", "터치 기기 화면");
  const P = await seed.collecting({ members: 0, settings: SETTINGS });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  const from = slotMs(2, "18:00");
  const to = slotMs(3, "19:00");
  await myCell(page, from).scrollIntoViewIfNeeded();

  // 꺼진 상태: 끌어도 칸이 바뀌지 않는다
  await syntheticTouchDrag(page, from, to);
  await page.waitForTimeout(300);
  expect(await pressedCells(page), "꺼진 상태 끌기").toBe(0);
  // 꺼진 상태 탭은 한 칸
  await myCell(page, from).tap();
  await expect.poll(() => pressedCells(page), { message: "꺼진 상태 탭 한 칸" }).toBe(1);
  await myCell(page, from).tap();
  await expect.poll(() => pressedCells(page)).toBe(0);

  // 켠 상태: 18:00~19:00 × 두 열 = 6칸(첫 칸의 반대 상태 = 선택)
  await modeButton(page).tap();
  await syntheticTouchDrag(page, from, to);
  await expect.poll(() => pressedCells(page), { message: "켠 상태 끌기 6칸" }).toBe(6);
  for (const ms of [from, slotMs(2, "19:00"), slotMs(3, "18:00"), to])
    await expect(myCell(page, ms)).toHaveAttribute("aria-pressed", "true");
  // 고른 칸에서 시작하면 해제(첫 칸의 반대 상태)
  await syntheticTouchDrag(page, from, slotMs(2, "18:30"));
  await expect.poll(() => pressedCells(page), { message: "고른 칸부터 끌면 해제" }).toBe(4);

  // 켠 상태 탭은 한 칸만 바뀐다(놓기 확정 + click이 두 번 바꾸지 않음) — 실제 터치
  await myCell(page, slotMs(4, "20:00")).tap();
  await expect.poll(() => pressedCells(page), { message: "켠 상태 탭 한 칸" }).toBe(5);
  await page.waitForTimeout(300);
  expect(await pressedCells(page)).toBe(5);
});

test("데스크톱(마우스)에는 「드래그로 선택」 버튼이 없다", async ({ seed, app }) => {
  test.skip(test.info().project.name === "webkit-mobile", "마우스 데스크톱");
  const P = await seed.collecting({ members: 0, settings: SETTINGS });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  await expect(modeButton(page)).toHaveCount(0);
});

test("휴대폰 실제 터치(chromium CDP): 켜면 끌어서 칸 선택·스크롤 없음, 끄면 끌어서 스크롤·칸 그대로", async ({
  seed,
  app,
}) => {
  test.skip(test.info().project.name !== "chromium-desktop", "CDP 터치는 chromium만");
  const pixel = devices["Pixel 7"];
  const P = await seed.collecting({ members: 0, settings: SETTINGS });
  const { context, page } = await app.open(P, P.hostToken, "방장", {
    viewport: { width: 390, height: 844 },
    userAgent: pixel.userAgent,
    deviceScaleFactor: pixel.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  });
  await expectInputScreen(page, P.hostNick);
  const cdp = await context.newCDPSession(page);
  const touchDrag = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
    // 손가락처럼 한 프레임(16ms)마다 움직이고 끝에서 잠깐 멈춘 뒤 뗀다. 간격 없이 빠르게 보내면 브라우저가 튕기기(fling)로 보고
    // 다음 탭을 그 멈추기로 써서 click이 오지 않았다
    for (let i = 1; i <= 10; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 }],
      });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  // 탭도 같은 CDP 세션의 터치로 보낸다(끌기와 같은 입력 경로)
  const touchTap = async (locator: ReturnType<Page["locator"]>) => {
    await locator.scrollIntoViewIfNeeded();
    const b = (await locator.boundingBox())!;
    const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const scrollY = () => page.evaluate(() => window.scrollY);
  // 끌기 뒤 관성 스크롤이 멈출 때까지 기다린다. 움직이는 중의 탭은 브라우저가 관성 멈추기로 쓰고 click을 주지 않는다
  const settle = async () => {
    let last = -1;
    await expect
      .poll(
        async () => {
          const now = await scrollY();
          const still = now === last;
          last = now;
          return still;
        },
        { intervals: [200] },
      )
      .toBe(true);
  };

  await expect(modeButton(page), "chromium 휴대폰 흉내도 터치 기기로 판정").toBeVisible();
  const from = slotMs(2, "12:00");
  await myCell(page, from).scrollIntoViewIfNeeded();

  // 켠 상태: 12:00~13:00 × 두 열 = 6칸, 스크롤 없음
  await modeButton(page).tap();
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "true");
  await myCell(page, from).scrollIntoViewIfNeeded();
  await settle();
  const start = await scrollY();
  const p = await center(page, from);
  const q = await center(page, slotMs(3, "13:00"));
  await touchDrag(p, q);
  await expect.poll(() => pressedCells(page), { message: "켠 상태 실제 터치 끌기 6칸" }).toBe(6);
  await settle();
  expect(await scrollY(), "켠 상태 끌기 = 스크롤 없음").toBe(start);

  // 꺼진 상태: 칸 위에서 위로 끌면 페이지가 스크롤되고 칸은 그대로
  await touchTap(modeButton(page));
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "false");
  await settle();
  const before = await scrollY();
  const a = await center(page, from);
  await touchDrag(a, { x: a.x, y: a.y - 150 });
  await expect.poll(scrollY, { message: "꺼진 상태 끌기 = 스크롤" }).toBeGreaterThan(before + 50);
  expect(await pressedCells(page), "꺼진 상태 끌기 = 칸 그대로").toBe(6);
});
