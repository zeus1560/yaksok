// 화면 도우미 — 선택자는 사용자가 보는 이름(역할·라벨·문구)을 쓴다
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const text = (page: Page, value: string | RegExp) =>
  page.getByText(value, { exact: false }).first();

export const menuOf = (page: Page) => page.getByRole("region", { name: "방장 메뉴" });
export const mineOf = (page: Page) => page.getByRole("region", { name: "내 참여" });
export const dialogOf = (page: Page) => page.getByRole("alertdialog");
export const identityOf = (page: Page) => page.getByLabel("내 닉네임과 역할").first();

// 시간 입력 화면: 헤더 「닉네임 · 역할」과 제목 「가능한 시간을 골라 주세요」(029)
export async function expectInputScreen(page: Page, nickname: string, timeout = 20_000) {
  await expect(identityOf(page)).toHaveText(new RegExp(`^${escape(nickname)} · `), { timeout });
  await expect(
    page.getByRole("heading", { name: "가능한 시간을 골라 주세요" }).first(),
  ).toBeVisible({ timeout });
}
export async function isInputScreen(page: Page, nickname: string): Promise<boolean> {
  const label = identityOf(page);
  if ((await label.count()) === 0) return false;
  const value = await label.textContent();
  return (
    value?.startsWith(`${nickname} · `) === true &&
    (await page.getByRole("heading", { name: "가능한 시간을 골라 주세요" }).first().isVisible())
  );
}

export const CANDIDATES_TITLE = "응답이 마감됐어요";
export const RESULT_TEXT = "약속 시간이 확정됐어요";
export const CANCELLED_TITLE = "취소된 약속이에요";
export const JOIN_TITLE = "약속에 참여해 볼까요";
export const REGISTER_HOST_TITLE = "새 약속을 만들어 볼까요";

export async function openManage(page: Page, action: string) {
  const toggle = menuOf(page).getByRole("button", { name: "약속 관리", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await menuOf(page).getByRole("button", { name: action, exact: true }).click();
}

export async function openList(page: Page): Promise<Locator> {
  const toggle = page.getByRole("button", { name: "명단 보기" });
  if (await toggle.isVisible()) await toggle.click();
  return page.getByRole("region", { name: "참여자 명단" });
}
export const rowNames = (region: Locator) =>
  region
    .locator("li")
    .evaluateAll((items) => items.map((li) => (li as HTMLElement).innerText.replace(/\s+/g, "")));

export const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
export async function expectNoHScroll(page: Page) {
  expect(await noHScroll(page), "가로 스크롤 없음").toBe(true);
}

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 640;

// 날짜 하루 전체 토글: 「11/12(목) 하루 전체 선택 또는 해제」
export function dayToggle(page: Page, ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const label = `${d.getUTCMonth() + 1}\\/${d.getUTCDate()}`;
  return page.getByRole("button", {
    name: new RegExp(`^${label}\\(.\\) 하루 전체 선택 또는 해제$`),
  });
}
// 설정·관리 달력의 날짜 버튼: 「11월 12일」(오늘이면 「11월 12일 오늘」)
export const dayLabel = (ymd: string) =>
  `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
export function calendarDay(scope: Page | Locator, ymd: string) {
  return scope.getByRole("button", { name: new RegExp(`^${dayLabel(ymd)}( 오늘)?$`) });
}
// 달력에서 날짜를 고른다. 다른 달이면 「다음 달」로 넘긴다
export async function pickCalendarDay(scope: Page | Locator, ymd: string) {
  for (let i = 0; i < 4; i += 1) {
    const day = calendarDay(scope, ymd);
    if ((await day.count()) > 0) return day.click();
    await scope.getByRole("button", { name: "다음 달" }).click();
  }
  throw new Error(`달력에서 ${ymd}를 찾지 못함`);
}

// 선택 칸 수(029: data-selected-slots)와 눌린 칸 수
export const selectedCount = (page: Page) =>
  page.evaluate(() => {
    const p = document.querySelector("[data-selected-slots]");
    return p ? Number(p.getAttribute("data-selected-slots")) : null;
  });
export const pressedCells = (page: Page) =>
  page.locator('[aria-label="내 가능 시간"] button[aria-pressed="true"]').count();
export const myCell = (page: Page, ms: number) =>
  page.locator(`[aria-label="내 가능 시간"] button[data-slot="${ms}"]`);
// 휴대폰 1시간·2시간 보기의 묶은 칸(첫 30분 칸 시각, 034)
export const myGroup = (page: Page, ms: number) =>
  page.locator(`[aria-label="내 가능 시간"] button[data-group="${ms}"]`);
// 휴대폰 날짜 넘기기 줄의 구간 글자 「11/16 (월) – 11/19 (목)」(보이는 탭의 것, 034)
export const dayRange = (page: Page) => page.locator("[data-day-range]").filter({ visible: true });
export const dayText = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAY[d.getUTCDay()]})`;
};

export const storageKeys = (page: Page, promiseId: string, inviteToken: string) =>
  page.evaluate(
    ([p, t]) =>
      Object.keys(localStorage).filter(
        (k) => k.startsWith(`yaksok:availability:${p}:`) || k === `yaksok:setup:${t}`,
      ),
    [promiseId, inviteToken],
  );

export async function fillAuth(page: Page, nickname: string, pin: string, submit: string) {
  await page.locator("#nickname").fill(nickname);
  await page.locator("#pin").fill(pin);
  await page.getByRole("button", { name: submit, exact: true }).click();
}

// 시간 입력 화면 머리글의 마감 표기 (lib/availability/sync.ts formatSeoulDateTime)
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
export const deadlineText = (ymd: string, hhmm: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `마감 ${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]}) ${hhmm}`;
};
export const localOf = (ymd: string, hhmm: string) => `${ymd}T${hhmm}`; // datetime-local 입력값

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 화면 색 비교용: Tailwind 토큰 --color-danger(#b63838)
export const DANGER_RGB = "rgb(182, 56, 56)";
