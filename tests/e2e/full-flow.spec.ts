// 전체 흐름 (031 추가): 방장 약속 만들기 → 참여자 3명 등록 → 시간 입력·제출 → 마감 → 후보 → 확정 → 결과
// → 재조율 → 다시 제출 → 취소. 단계마다 다른 사람 화면이 폴링으로 바뀌는지 요청 순서로 본다
// (변경 뒤 시작한 첫 폴링 응답이 새 값이고 그 응답 뒤 화면이 곧 바뀐다)
import {
  pollPath,
  changeClock,
  expect,
  expectPollReflects,
  statusPath,
  subPath,
  test,
} from "./support/fixtures";
import { BASE, nick, seoulDate } from "./support/api";
import { promiseRow } from "./support/db";
import { clickWithRateLimitRetry } from "./support/rate-limit-wait";
import {
  CANCELLED_TITLE,
  CANDIDATES_TITLE,
  JOIN_TITLE,
  REGISTER_HOST_TITLE,
  dayToggle,
  dialogOf,
  expectInputScreen,
  expectNoHScroll,
  fillAuth,
  isMobile,
  localOf,
  menuOf,
  openList,
  openManage,
  pickCalendarDay,
  text,
} from "./support/ui";
import type { Page } from "@playwright/test";

type Json = Record<string, unknown> & {
  promiseStatus?: string;
  participants?: { availableSlots?: unknown[] }[];
};
const submittedCount = (j: unknown) =>
  ((j as Json)?.participants ?? []).filter((p) => (p.availableSlots?.length ?? 0) > 0).length;

async function showEveryone(page: Page) {
  if (isMobile(page)) await page.getByRole("tab", { name: "모두의 시간" }).click();
  await expect(text(page, "모두의 가능 시간")).toBeVisible();
}

test("약속 만들기부터 취소까지 한 약속의 전체 흐름 @smoke", async ({ app, seed }) => {
  test.setTimeout(420_000);
  const hostNick = nick("방");
  const names = [nick("가"), nick("나"), nick("다")];
  const host = await app.blank("방장");
  const hp = host.page;

  let inviteUrl = "";
  let inviteToken = "";
  let promiseId = "";
  await test.step("방장: 홈 → 새 약속 만들기 → 방장 등록 → 설정 → 완료", async () => {
    await hp.goto("/");
    // 미리보기 smoke는 이 PC의 IP 하나로 모여 링크 발급(1분 10회)에 걸릴 수 있다 — 429면 기다렸다 다시 누른다(R-41)
    await clickWithRateLimitRetry(
      hp,
      () => hp.getByRole("button", { name: "새 약속 만들기" }).click(),
      (url, method) => method === "POST" && url.pathname === "/api/v1/links",
      "화면 새 약속 만들기",
    );
    await expect(text(hp, REGISTER_HOST_TITLE)).toBeVisible();
    inviteToken = decodeURIComponent(new URL(hp.url()).pathname.split("/").pop()!);
    expect(seed.links.has(inviteToken), "브라우저가 만든 링크도 정리 대상").toBe(true);
    await hp.locator("#nickname").fill(hostNick);
    await hp.locator("#pin").fill("1357");
    const hostRes = await clickWithRateLimitRetry(
      hp,
      () => hp.getByRole("button", { name: "방장으로 시작하기", exact: true }).click(),
      (url, method) => method === "POST" && url.pathname.endsWith("/host"),
      "화면 방장 등록",
    );
    promiseId = (await hostRes.json()).promiseId;
    await expect(text(hp, "새 약속 만들기")).toBeVisible();
    await expect(text(hp, "설정 시간")).toBeVisible();
    // 날짜: 모레 ~ 4일 뒤 (마감 기본값 = 시작 전날 23:59)
    await pickCalendarDay(hp, seoulDate(2));
    await pickCalendarDay(hp, seoulDate(4));
    await expect(hp.getByLabel("투표 마감 (한국 시간)")).toHaveValue(
      localOf(seoulDate(1), "23:59"),
    );
    await hp.getByRole("button", { name: "설정 완료 · 초대 링크 만들기" }).click();
    await expect(text(hp, "약속이 만들어졌어요")).toBeVisible();
    inviteUrl = await hp.locator("#invite-url").inputValue();
    expect(inviteUrl).toBe(`${BASE}/p/${inviteToken}`);
    await expectNoHScroll(hp);
    await hp.getByRole("button", { name: "내 가능 시간 입력하기" }).click();
    await expectInputScreen(hp, hostNick);
    const row = await promiseRow(promiseId);
    expect([row!.status, row!.participant_limit, row!.s, row!.e]).toEqual([
      "collecting",
      4,
      seoulDate(2),
      seoulDate(4),
    ]);
  });

  const people: { name: string; page: Page }[] = [];
  await test.step("참여자 3명 등록 — 방장 명단이 폴링으로 늘어남", async () => {
    const list = await openList(hp);
    for (const [i, name] of names.entries()) {
      const person = await app.blank(`참여자${i + 1}`);
      await person.page.goto(inviteUrl);
      await expect(text(person.page, JOIN_TITLE)).toBeVisible();
      await fillAuth(person.page, name, "2468", "참여하고 시간 선택하기");
      await expectInputScreen(person.page, name);
      const after = Date.now();
      people.push({ name, page: person.page });
      await expectPollReflects(hp, {
        match: subPath(promiseId, "/participants"),
        after,
        fresh: (j) => ((j as Json).participants ?? []).length === i + 2,
        screen: async () => {
          await expect(list.getByText(name)).toBeVisible({ timeout: 3000 });
          await expect(text(hp, `${i + 2} / 4명`)).toBeVisible({ timeout: 3000 });
        },
      });
    }
  });

  const day = seoulDate(3);
  await test.step("시간 입력·제출 — 다른 사람의 모두의 시간이 폴링으로 바뀜", async () => {
    const watcher = people[2].page; // 마지막 참여자가 다른 사람들의 제출을 지켜본다
    await showEveryone(watcher);
    const submitters: { name: string; page: Page }[] = [
      { name: hostNick, page: hp },
      people[0],
      people[1],
    ];
    for (const [i, person] of submitters.entries()) {
      if (isMobile(person.page)) await person.page.getByRole("tab", { name: "내 시간" }).click();
      await dayToggle(person.page, day).click();
      await person.page.getByRole("button", { name: "가능 시간 제출" }).click();
      await expect(text(person.page, "제출했어요.")).toBeVisible();
      const after = Date.now();
      await expectPollReflects(watcher, {
        match: subPath(promiseId, "/availability"),
        after,
        fresh: (j) => submittedCount(j) === i + 1,
        screen: async () => {
          await expect(text(watcher, `현재 최대 ${i + 1}명 가능`)).toBeVisible({ timeout: 3000 });
        },
      });
    }
    const last = people[2].page;
    if (isMobile(last)) await last.getByRole("tab", { name: "내 시간" }).click();
    await dayToggle(last, day).click();
    await last.getByRole("button", { name: "가능 시간 제출" }).click();
    await expect(text(last, "제출했어요.")).toBeVisible();
    await showEveryone(last);
    await expect(text(last, "현재 최대 4명 가능")).toBeVisible();
  });

  // 폴링은 사람마다 따로 돈다. 변경 전에 모두의 대기를 걸어 두고(변경 응답을 받은 순간이 기준 시각), 동시에 기다린다
  const watchAll = (
    clock: ReturnType<typeof changeClock>,
    fresh: (j: unknown) => boolean,
    screen: (person: { name: string; page: Page }) => Promise<void>,
    match: (promiseId: string) => (p: string) => boolean = statusPath,
  ) =>
    Promise.all(
      people.map((person) =>
        expectPollReflects(person.page, {
          match: match(promiseId),
          after: clock.after,
          fresh,
          screen: () => screen(person),
        }),
      ),
    );
  const mutation = (sub: string) =>
    hp.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(sub));

  await test.step("방장 마감 — 참여자 화면이 후보 화면으로", async () => {
    const clock = changeClock();
    const watched = watchAll(
      clock,
      (j) => (j as Json).promiseStatus === "closed",
      async ({ page }) => {
        await expect(text(page, CANDIDATES_TITLE)).toBeVisible({ timeout: 5000 });
      },
    );
    const changed = mutation("/close");
    await menuOf(hp).getByRole("button", { name: "응답 마감하기", exact: true }).click();
    await dialogOf(hp).getByRole("button", { name: "마감하기", exact: true }).click();
    await changed;
    clock.mark();
    await expect(text(hp, CANDIDATES_TITLE)).toBeVisible();
    await watched;
    for (const person of people) {
      await expect(person.page.getByRole("button", { name: "이 시간으로 확정" })).toHaveCount(0);
      await expect(text(person.page, "방장이 이 중에서 최종 확정할 때까지")).toBeVisible();
    }
  });

  let confirmedDate = "";
  await test.step("후보 확인 → 확정 → 결과가 모두에게", async () => {
    // 명단(열려 있음)도 목록이라 확정 버튼이 있는 후보 항목만 고른다
    const first = hp
      .locator("li")
      .filter({ has: hp.getByRole("button", { name: "이 시간으로 확정" }) })
      .first();
    await expect(first.getByText("4명 가능")).toBeVisible();
    confirmedDate = (await first.locator("p").first().innerText()).trim();
    const clock = changeClock();
    const watched = watchAll(
      clock,
      (j) => (j as Json).promiseStatus === "confirmed",
      async ({ page }) => {
        await expect(text(page, "우리 이때 만나요!")).toBeVisible({ timeout: 5000 });
      },
    );
    const changed = mutation("/confirmation");
    await first.getByRole("button", { name: "이 시간으로 확정" }).click();
    await dialogOf(hp).getByRole("button", { name: "약속 확정하기" }).click();
    await changed;
    clock.mark();
    await expect(text(hp, "우리 이때 만나요!")).toBeVisible();
    await expect(text(hp, confirmedDate)).toBeVisible();
    expect((await promiseRow(promiseId))?.status).toBe("confirmed");
    await watched;
    for (const person of people) {
      await expect(text(person.page, confirmedDate)).toBeVisible();
      await expect(text(person.page, "함께 가능한 사람")).toBeVisible();
      await expectNoHScroll(person.page);
    }
  });

  await test.step("재조율 → 모두 시간 입력으로 → 다시 제출이 다른 사람에게 반영", async () => {
    await openManage(hp, "다시 열기(재조율)");
    await expect(text(hp, "확정된 일정이 해제돼요.")).toBeVisible();
    await menuOf(hp)
      .getByLabel("새 응답 마감 (한국 시간)")
      .fill(localOf(seoulDate(1), "20:00"));
    const clock = changeClock();
    const watched = watchAll(
      clock,
      (j) => (j as Json).promiseStatus === "collecting",
      ({ name, page }) => expectInputScreen(page, name, 5000),
    );
    const changed = mutation("/reopen");
    await menuOf(hp).getByRole("button", { name: "다시 열기", exact: true }).click();
    await changed;
    clock.mark();
    await expect(text(hp, "확정된 일정을 해제했어요.")).toBeVisible();
    await expectInputScreen(hp, hostNick);
    await watched;
    // 참여자1이 하루를 해제하고 다시 제출 → 방장의 모두의 시간에서 최대 3명
    const p1 = people[0].page;
    if (isMobile(p1)) await p1.getByRole("tab", { name: "내 시간" }).click();
    await dayToggle(p1, day).click();
    await p1.getByRole("button", { name: "다시 제출" }).click();
    await dialogOf(p1).getByRole("button", { name: "가능 시간 없음으로 제출" }).click();
    await expect(text(p1, "제출했어요.")).toBeVisible();
    const resubmitted = Date.now();
    await showEveryone(hp);
    await expectPollReflects(hp, {
      match: subPath(promiseId, "/availability"),
      after: resubmitted,
      fresh: (j) => submittedCount(j) === 3,
      screen: async () => {
        await expect(text(hp, "현재 최대 3명 가능")).toBeVisible({ timeout: 3000 });
      },
    });
  });

  await test.step("방장 취소 → 모두 취소 안내", async () => {
    await openManage(hp, "약속 취소");
    // 취소 뒤에는 상태·명단·가능 시간 중 어느 폴링이든 먼저 409를 받으면 링크를 다시 조회해 화면이 바뀐다
    const clock = changeClock();
    const watched = watchAll(
      clock,
      (j) => (j as { code?: string }).code === "PROMISE_CANCELLED",
      async ({ page }) => {
        await expect(text(page, CANCELLED_TITLE)).toBeVisible({ timeout: 5000 });
      },
      pollPath,
    );
    const changed = mutation("/cancel");
    await dialogOf(hp).getByRole("button", { name: "약속 취소하기" }).click();
    await changed;
    clock.mark();
    await expect(text(hp, CANCELLED_TITLE)).toBeVisible();
    expect((await promiseRow(promiseId))?.status).toBe("cancelled");
    await watched;
    for (const person of people) await expectNoHScroll(person.page);
  });
});
