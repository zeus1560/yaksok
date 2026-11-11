// 방장 관리 화면 (027) — scripts/verify/027-host-manage.mjs에서 옮김 + 재조율 응답 유실 뒤 재요청(031 추가)
// 시간 기준 판정은 요청 순서로 본다: 변경 뒤 시작한 첫 폴링 응답이 새 값이고 그 뒤 화면이 바뀌는가
import {
  pollPath,
  changeClock,
  expect,
  expectPollReflects,
  statusPath,
  subPath,
  test,
} from "./support/fixtures";
import { as, seoulDate, slotAt } from "./support/api";
import { passDeadline, promiseMd5, promiseRow, participantRow, slotCount } from "./support/db";
import {
  CANCELLED_TITLE,
  CANDIDATES_TITLE,
  JOIN_TITLE,
  RESULT_TEXT,
  dayLabel,
  deadlineText,
  dialogOf,
  expectInputScreen,
  expectNoHScroll,
  localOf,
  menuOf,
  openList,
  openManage,
  rowNames,
  text,
} from "./support/ui";
import type { Page } from "@playwright/test";

const dayCount = (page: Page) =>
  page.getByRole("button", { name: /하루 전체 선택 또는 해제$/ }).count();
async function pickRange(page: Page, startYmd: string, endYmd: string) {
  const day = (ymd: string) =>
    menuOf(page).getByRole("button", { name: new RegExp(`^${dayLabel(ymd)}( 오늘)?$`) });
  await day(startYmd).click();
  await day(endYmd).click();
}
const reqBody = async (page: Page, method: string, suffix: string, action: () => Promise<void>) => {
  const req = page.waitForRequest((r) => r.method() === method && r.url().endsWith(suffix));
  await action();
  return JSON.parse((await req).postData() ?? "{}");
};

test("방장 메뉴·명단, 설정 변경(정원·마감·범위), 내보내기, 마감 뒤 메뉴, closed 재조율", async ({
  seed,
  app,
}) => {
  test.setTimeout(180_000);
  const P = await seed.collecting({
    members: 2,
    settings: { dateRange: { startDate: seoulDate(1), endDate: seoulDate(4) } },
  });
  await as(P.promiseId, P.members[0].token).submit([slotAt(4, "10:00")]);
  const host = await app.open(P, P.hostToken, "방장");
  const mem = await app.open(P, P.members[0].token, "참여자");
  await expectInputScreen(host.page, P.hostNick);
  await expectInputScreen(mem.page, P.members[0].nickname);

  await test.step("방장 메뉴는 방장에게만, 시간 입력보다 위", async () => {
    await expect(menuOf(host.page).getByRole("button", { name: "약속 관리" })).toBeVisible();
    const menuBox = await menuOf(host.page).boundingBox();
    const boardBox = await host.page
      .getByRole("heading", { name: "가능한 시간을 골라 주세요" })
      .boundingBox();
    expect(menuBox!.y).toBeLessThan(boardBox!.y);
    await expect(menuOf(mem.page)).toHaveCount(0);
    await expect(mem.page.getByRole("button", { name: "약속 관리" })).toHaveCount(0);
  });

  await test.step("명단: 정원 현황·등록순·방장·나, 참여자에게는 제출 여부·내보내기 없음", async () => {
    const memList = await openList(mem.page);
    await expect(text(mem.page, "3 / 6명")).toBeVisible();
    const rows = await rowNames(memList);
    expect(rows).toEqual([
      `${P.hostNick}방장`,
      `${P.members[0].nickname}나`,
      P.members[1].nickname,
    ]);
    expect(rows.some((r) => /제출/.test(r))).toBe(false);
    await expect(memList.getByRole("button", { name: "내보내기" })).toHaveCount(0);
    await expectNoHScroll(mem.page);
    const hostList = await openList(host.page);
    expect((await rowNames(hostList))[0]).toBe(`${P.hostNick}방장나`);
    await expect(hostList.getByRole("button", { name: "내보내기" })).toHaveCount(2);
  });

  const menu = menuOf(host.page);
  await test.step("설정 변경: 초기값·막히는 축소·마감 단축은 요청 없이 막음", async () => {
    const md5 = await promiseMd5(P.promiseId);
    await openManage(host.page, "설정 변경");
    await expect(menu.getByRole("button", { name: "정원 줄이기" })).toBeDisabled();
    const deadline = menu.getByLabel("응답 마감 (한국 시간)");
    await expect(deadline).toHaveAttribute("min", localOf(seoulDate(1), "12:00"));
    await expect(deadline).toHaveValue(localOf(seoulDate(1), "12:00"));
    await expect(menu.getByRole("button", { name: "변경 저장" })).toBeDisabled();
    // 마감 때문에 막히는 축소: 오늘~내일(마지막 날 00:00 ≤ 마감 내일 12:00)
    await pickRange(host.page, seoulDate(0), seoulDate(1));
    await expect(
      text(host.page, "마감이 새 마지막 날보다 늦어서 줄일 수 없어요. 재조율로 다시 열어 주세요."),
    ).toBeVisible();
    await expect(menu.getByRole("button", { name: "변경 저장" })).toBeDisabled();
    await menu.getByRole("button", { name: "돌아가기" }).click();

    await openManage(host.page, "설정 변경");
    await menu.getByLabel("응답 마감 (한국 시간)").fill(localOf(seoulDate(1), "11:00"));
    let patches = 0;
    host.page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().endsWith("/settings")) patches += 1;
    });
    await menu.getByRole("button", { name: "변경 저장" }).click();
    await expect(text(host.page, "모집 중에는 응답 마감을 앞당길 수 없습니다.")).toBeVisible();
    expect(patches, "요청 없음").toBe(0);
    expect(await promiseMd5(P.promiseId), "DB 그대로").toBe(md5);
    await menu.getByRole("button", { name: "돌아가기" }).click();
  });

  await test.step("정원 증가·마감 연장: 바꾼 필드만 보내고 참여자 화면에 다음 폴링으로 반영", async () => {
    await openManage(host.page, "설정 변경");
    await menu.getByRole("button", { name: "정원 늘리기" }).click();
    await menu.getByLabel("응답 마감 (한국 시간)").fill(localOf(seoulDate(2), "12:00"));
    const body = await reqBody(host.page, "PATCH", "/settings", () =>
      menu.getByRole("button", { name: "변경 저장" }).click(),
    );
    expect(Object.keys(body).sort()).toEqual(["participantLimit", "votingDeadlineAt"]);
    expect(body.participantLimit).toBe(7);
    await expect(text(host.page, "설정을 저장했어요.")).toBeVisible();
    const after = Date.now();
    const row = await promiseRow(P.promiseId);
    expect(row!.participant_limit).toBe(7);
    expect(row!.voting_deadline_at!.getTime()).toBe(Date.parse(`${seoulDate(2)}T12:00:00+09:00`));
    expect(row!.status).toBe("collecting");
    // 시간 입력 화면 머리글의 마감은 가능 시간 조회(/availability)로, 정원 현황은 명단 조회로 그린다
    const newDeadline = Date.parse(`${seoulDate(2)}T12:00:00+09:00`);
    await Promise.all([
      expectPollReflects(mem.page, {
        match: subPath(P.promiseId, "/availability"),
        after,
        fresh: (j) =>
          Date.parse(
            (j as { settings?: { votingDeadlineAt?: string } })?.settings?.votingDeadlineAt ?? "",
          ) === newDeadline,
        screen: async () => {
          await expect(text(mem.page, deadlineText(seoulDate(2), "12:00"))).toBeVisible({
            timeout: 3000,
          });
        },
      }),
      expectPollReflects(mem.page, {
        match: subPath(P.promiseId, "/participants"),
        after,
        fresh: (j) => (j as { participantLimit?: number })?.participantLimit === 7,
        screen: async () => {
          await expect(text(mem.page, "3 / 7명")).toBeVisible({ timeout: 3000 });
        },
      }),
    ]);
  });

  await test.step("범위 축소: dateRange만 보내고 범위 밖 입력 삭제, 참여자 날짜 칸 3", async () => {
    await openManage(host.page, "설정 변경");
    await pickRange(host.page, seoulDate(1), seoulDate(3));
    await expect(text(host.page, "범위 밖 입력이 삭제돼요.")).toBeVisible();
    await expect(text(host.page, "모든 참여자가 다시 제출해야 해요.")).toBeHidden();
    const body = await reqBody(host.page, "PATCH", "/settings", () =>
      menu.getByRole("button", { name: "변경 저장" }).click(),
    );
    expect(body).toEqual({ dateRange: { startDate: seoulDate(1), endDate: seoulDate(3) } });
    await expect(text(host.page, "범위 밖 입력 1칸을 지웠어요.")).toBeVisible();
    expect(await slotCount(P.promiseId)).toBe(0);
    await expect.poll(() => dayCount(mem.page), { timeout: 15_000 }).toBe(3);
  });

  await test.step("범위 확대: 재제출 안내, 참여자 날짜 칸 5", async () => {
    await openManage(host.page, "설정 변경");
    await pickRange(host.page, seoulDate(1), seoulDate(5));
    await expect(text(host.page, "모든 참여자가 다시 제출해야 해요.")).toBeVisible();
    await expect(text(host.page, "범위 밖 입력이 삭제돼요.")).toBeHidden();
    await menu.getByRole("button", { name: "변경 저장" }).click();
    await expect(
      text(host.page, "모든 참여자의 제출이 해제되어 다시 제출해야 해요."),
    ).toBeVisible();
    await expect.poll(() => dayCount(mem.page), { timeout: 15_000 }).toBe(5);
    await expectNoHScroll(mem.page);
  });

  await test.step("내보내기: 확인 창 → 명단 갱신, 내보내진 사람은 다음 요청 401 → 참여 화면", async () => {
    const target = P.members[1];
    const gone = await app.open(P, target.token, "내보낼 참여자");
    await expectInputScreen(gone.page, target.nickname);
    const list = await openList(host.page);
    await list
      .locator("li", { hasText: target.nickname })
      .getByRole("button", { name: "내보내기" })
      .click();
    await expect(dialogOf(host.page)).toBeVisible();
    await dialogOf(host.page).getByRole("button", { name: "내보내기" }).click();
    await expect.poll(async () => (await rowNames(list)).length).toBe(2);
    await expect(text(host.page, "2 / 7명")).toBeVisible();
    await expect(text(gone.page, JOIN_TITLE)).toBeVisible({ timeout: 15_000 });
    expect((await participantRow(target.id))?.status).toBe("cancelled");
  });

  await test.step("마감 경과(DB): 후보 화면, 내보내기 없음, 메뉴는 다시 열기·취소", async () => {
    await passDeadline(P.promiseId);
    await expect(text(host.page, CANDIDATES_TITLE)).toBeVisible({ timeout: 15_000 });
    const list = await openList(host.page);
    await expect(list.getByRole("button", { name: "내보내기" })).toHaveCount(0);
    await menu.getByRole("button", { name: "약속 관리" }).click();
    await expect(menu.getByRole("button", { name: "다시 열기(재조율)" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "설정 변경" })).toHaveCount(0);
    await menu.getByRole("button", { name: "약속 관리 닫기" }).click();
  });

  await test.step("closed 재조율: 새 마감만 보냄, 방장·참여자 시간 입력으로", async () => {
    await openManage(host.page, "다시 열기(재조율)");
    await expect(menu.getByLabel("하루 시작 시각")).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "설정도 바꾸기" })).toBeVisible();
    await expect(text(host.page, "확정된 일정이 해제돼요.")).toBeHidden();
    await menu.getByRole("button", { name: "다시 열기", exact: true }).click();
    await expect(text(host.page, "새 응답 마감을 입력해 주세요.")).toBeVisible();
    await menu.getByLabel("새 응답 마감 (한국 시간)").fill(localOf(seoulDate(2), "18:00"));
    const body = await reqBody(host.page, "POST", "/reopen", () =>
      menu.getByRole("button", { name: "다시 열기", exact: true }).click(),
    );
    expect(body).toEqual({ votingDeadlineAt: `${seoulDate(2)}T18:00:00+09:00` });
    const after = Date.now();
    await expect(text(host.page, "다시 열었어요.")).toBeVisible();
    await expectInputScreen(host.page, P.hostNick);
    await expectPollReflects(mem.page, {
      match: statusPath(P.promiseId),
      after,
      fresh: (j) => (j as { promiseStatus?: string })?.promiseStatus === "collecting",
      screen: () => expectInputScreen(mem.page, P.members[0].nickname, 5000),
    });
    expect((await promiseRow(P.promiseId))?.status).toBe("collecting");
    await expectNoHScroll(host.page);
  });
});

test("confirmed 재조율: 설정도 바꾸기(정원 하한·범위 이동)", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 1 });
  const slots = [slotAt(2, "10:00"), slotAt(2, "10:30")];
  await as(P.promiseId, P.hostToken).submit(slots);
  await as(P.promiseId, P.members[0].token).submit(slots);
  const host = as(P.promiseId, P.hostToken);
  await host.send("POST", "/close");
  const cands = await host.get("/candidates?limit=5&offset=0");
  expect(
    (await host.send("POST", "/confirmation", { startAt: cands.json.candidates[0].startAt }))
      .status,
  ).toBe(200);

  const h = await app.open(P, P.hostToken, "방장");
  const m = await app.open(P, P.members[0].token, "참여자");
  await expect(text(h.page, RESULT_TEXT)).toBeVisible({ timeout: 20_000 });
  await expect(text(m.page, RESULT_TEXT)).toBeVisible({ timeout: 20_000 });
  await expectNoHScroll(m.page);
  const menu = menuOf(h.page);
  await openManage(h.page, "다시 열기(재조율)");
  await expect(text(h.page, "확정된 일정이 해제돼요.")).toBeVisible();
  await menu.getByRole("button", { name: "설정도 바꾸기" }).click();
  for (let i = 0; i < 10; i += 1) {
    const minus = menu.getByRole("button", { name: "정원 줄이기" });
    if (await minus.isDisabled()) break;
    await minus.click();
  }
  await expect(menu.getByLabel("정원 직접 입력"), "정원 하한 = 현재 인원(2)").toHaveValue("2");
  await pickRange(h.page, seoulDate(2), seoulDate(5));
  await expect(text(h.page, "범위 밖 입력이 삭제돼요.")).toBeVisible();
  await expect(text(h.page, "모든 참여자가 다시 제출해야 해요.")).toBeVisible();
  await menu.getByLabel("새 응답 마감 (한국 시간)").fill(localOf(seoulDate(1), "20:00"));
  const body = await reqBody(h.page, "POST", "/reopen", () =>
    menu.getByRole("button", { name: "다시 열기", exact: true }).click(),
  );
  expect(Object.keys(body).sort()).toEqual(["dateRange", "participantLimit", "votingDeadlineAt"]);
  const after = Date.now();
  await expect(text(h.page, "확정된 일정을 해제했어요.")).toBeVisible();
  const row = await promiseRow(P.promiseId);
  expect([row!.status, row!.confirmed_start_at, row!.participant_limit, row!.s, row!.e]).toEqual([
    "collecting",
    null,
    2,
    seoulDate(2),
    seoulDate(5),
  ]);
  await expectPollReflects(m.page, {
    match: statusPath(P.promiseId),
    after,
    fresh: (j) => (j as { promiseStatus?: string })?.promiseStatus === "collecting",
    screen: () => expectInputScreen(m.page, P.members[0].nickname, 5000),
  });
});

test("재조율 응답 유실 → 다시 누르면 409 → 최신 상태(시간 입력)로", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 1 });
  await as(P.promiseId, P.hostToken).send("POST", "/close");
  const h = await app.open(P, P.hostToken, "방장");
  await expect(text(h.page, CANDIDATES_TITLE)).toBeVisible({ timeout: 20_000 });
  // 첫 응답을 끊은 뒤 다시 누르기 전에 폴링이 먼저 collecting을 받아 화면을 바꾸지 않게 GET을 붙잡아 둔다
  let holdPolls = true;
  await h.page.route(/\/api\/v1\/promises\/[^/]+(\/[a-z]+.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    while (holdPolls) await new Promise((r) => setTimeout(r, 100));
    await route.continue().catch(() => {});
  });
  let firstStatus: number | null = null;
  await h.page.route("**/reopen", async (route) => {
    const response = await route.fetch(); // 서버는 처리한다
    firstStatus = response.status();
    await route.abort("failed"); // 브라우저에는 응답이 오지 않는다
  });
  const menu = menuOf(h.page);
  await openManage(h.page, "다시 열기(재조율)");
  await menu.getByLabel("새 응답 마감 (한국 시간)").fill(localOf(seoulDate(2), "18:00"));
  await menu.getByRole("button", { name: "다시 열기", exact: true }).click();
  await expect.poll(() => firstStatus, { message: "서버는 200으로 재조율" }).toBe(200);
  await expect(text(h.page, "다시 열지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeVisible();
  const row = await promiseRow(P.promiseId);
  expect(row!.status).toBe("collecting");
  expect(row!.voting_deadline_at!.getTime()).toBe(Date.parse(`${seoulDate(2)}T18:00:00+09:00`));
  const md5 = await promiseMd5(P.promiseId);

  await h.page.unroute("**/reopen");
  const second = h.page.waitForResponse((r) => r.url().endsWith("/reopen"));
  await menu.getByRole("button", { name: "다시 열기", exact: true }).click();
  const res = await second;
  expect([res.status(), (await res.json()).code]).toEqual([409, "INVALID_PROMISE_STATE"]);
  holdPolls = false;
  await expect(
    text(h.page, "약속 상태가 바뀌어 처리하지 못했어요. 최신 상태로 다시 불러왔어요."),
  ).toBeVisible();
  await expectInputScreen(h.page, P.hostNick);
  expect(await promiseMd5(P.promiseId), "다시 누름은 DB를 바꾸지 않음").toBe(md5);
});

test("취소: 확인 창·요청 중 버튼 막힘·참여자 화면 반영", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 1 });
  const h = await app.open(P, P.hostToken, "방장");
  const m = await app.open(P, P.members[0].token, "참여자");
  await expectInputScreen(h.page, P.hostNick);
  await expectInputScreen(m.page, P.members[0].nickname);
  await openManage(h.page, "약속 취소");
  const dialog = dialogOf(h.page);
  await expect(dialog).toBeVisible();
  await expect(text(h.page, "되돌릴 수 없어요")).toBeVisible();
  let cancels = 0;
  h.page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/cancel")) cancels += 1;
  });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await h.page.route("**/cancel", async (route) => {
    await gate;
    await route.continue();
  });
  // 참여자 화면은 취소 뒤 첫 409를 받으면 폴링을 멈춘다. 기준 시각을 잡기 전에 대기를 먼저 건다
  const clock = changeClock();
  const watched = expectPollReflects(m.page, {
    match: pollPath(P.promiseId),
    after: clock.after,
    fresh: (j) => (j as { code?: string })?.code === "PROMISE_CANCELLED",
    screen: async () => {
      await expect(text(m.page, CANCELLED_TITLE)).toBeVisible({ timeout: 5000 });
    },
  });
  const changed = h.page.waitForResponse((r) => r.url().endsWith("/cancel"));
  await dialog.getByRole("button", { name: "약속 취소하기" }).click();
  await expect(dialog.getByRole("button", { name: "취소하는 중…" })).toBeDisabled();
  release();
  await changed;
  clock.mark();
  await expect(text(h.page, CANCELLED_TITLE)).toBeVisible();
  expect(cancels).toBe(1);
  expect((await promiseRow(P.promiseId))?.status).toBe("cancelled");
  await watched;
  await expectNoHScroll(m.page);
});

test("취소 응답 유실(closed): 다시 눌러 409를 받아도 취소 안내", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 1 });
  await as(P.promiseId, P.hostToken).send("POST", "/close");
  const h = await app.open(P, P.hostToken, "방장");
  await expect(text(h.page, CANDIDATES_TITLE)).toBeVisible({ timeout: 20_000 });
  let holdPolls = true;
  await h.page.route(
    /\/api\/v1\/promises\/[^/]+(\/participants|\/candidates.*)?$/,
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      while (holdPolls) await new Promise((r) => setTimeout(r, 100));
      await route.continue().catch(() => {});
    },
  );
  let firstStatus: number | null = null;
  await h.page.route("**/cancel", async (route) => {
    const response = await route.fetch();
    firstStatus = response.status();
    await route.abort("failed");
  });
  await openManage(h.page, "약속 취소");
  const dialog = dialogOf(h.page);
  await dialog.getByRole("button", { name: "약속 취소하기" }).click();
  await expect.poll(() => firstStatus).toBe(200);
  await expect(text(h.page, "취소하지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeVisible();
  await h.page.unroute("**/cancel");
  const second = h.page.waitForResponse((r) => r.url().endsWith("/cancel"));
  await dialog.getByRole("button", { name: "약속 취소하기" }).click();
  const res = await second;
  expect([res.status(), (await res.json()).code]).toEqual([409, "PROMISE_CANCELLED"]);
  holdPolls = false;
  await expect(text(h.page, CANCELLED_TITLE)).toBeVisible();
});

test("메뉴의 응답 마감하기: 확인 창 → 후보 화면, 참여자에게 반영", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 1 });
  const h = await app.open(P, P.hostToken, "방장");
  const m = await app.open(P, P.members[0].token, "참여자");
  await expectInputScreen(h.page, P.hostNick);
  await expectInputScreen(m.page, P.members[0].nickname);
  const menu = menuOf(h.page);
  await expect(menu.getByRole("button", { name: "응답 마감하기", exact: true })).toBeVisible();
  await expect(m.page.getByRole("button", { name: "응답 마감하기" })).toHaveCount(0);
  let closes = 0;
  h.page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/close")) closes += 1;
  });
  await menu.getByRole("button", { name: "응답 마감하기", exact: true }).click();
  await expect(dialogOf(h.page)).toBeVisible();
  await expect(text(h.page, "지금 응답을 마감할까요?")).toBeVisible();
  expect(closes).toBe(0);
  await dialogOf(h.page).getByRole("button", { name: "마감하기", exact: true }).click();
  await expect(text(h.page, CANDIDATES_TITLE)).toBeVisible();
  const after = Date.now();
  expect(closes).toBe(1);
  expect((await promiseRow(P.promiseId))?.status).toBe("closed");
  await expectPollReflects(m.page, {
    match: statusPath(P.promiseId),
    after,
    fresh: (j) => (j as { promiseStatus?: string })?.promiseStatus === "closed",
    screen: async () => {
      await expect(text(m.page, CANDIDATES_TITLE)).toBeVisible({ timeout: 5000 });
    },
  });
  await expect(menu.getByRole("button", { name: "응답 마감하기" })).toHaveCount(0);
  await menu.getByRole("button", { name: "약속 관리", exact: true }).click();
  await expect(menu.getByRole("button", { name: "다시 열기(재조율)", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "약속 취소", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "설정 변경" })).toHaveCount(0);
  await expectNoHScroll(m.page);
  await expectNoHScroll(h.page);
});
