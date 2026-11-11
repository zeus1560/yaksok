// 참여자 화면 마무리 (028) — scripts/verify/028-participant-finish.mjs에서 옮김
// 나가기(일반·승계·혼자인 방장·draft 방장), 나가기 응답 유실, 로그아웃(이 기기·모든 기기), 범위 축소 뒤 선택 칸 정리
import {
  pollPath,
  changeClock,
  expect,
  expectPollReflects,
  nextPollResponse,
  subPath,
  test,
} from "./support/fixtures";
import { as, call, cookieOf, login, nick, seoulDate, type Collecting } from "./support/api";
import { participantByNick, participantRow, promiseStatus, sessionCount } from "./support/db";
import {
  CANCELLED_TITLE,
  REGISTER_HOST_TITLE,
  dayToggle,
  dialogOf,
  expectInputScreen,
  expectNoHScroll,
  fillAuth,
  isInputScreen,
  menuOf,
  mineOf,
  pressedCells,
  selectedCount,
  storageKeys,
  text,
} from "./support/ui";

const keys = (
  page: import("@playwright/test").Page,
  P: Collecting | { promiseId: string; inviteToken: string },
) => storageKeys(page, P.promiseId, P.inviteToken);

test("일반 참여자 나가기: 확인 창·저장값 삭제·같은 닉네임 재참여 불가", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 2 });
  const m = P.members[0];
  const { page } = await app.open(P, m.token, "참여자");
  await expectInputScreen(page, m.nickname);
  await expect(mineOf(page).getByRole("button", { name: "약속 나가기" })).toBeVisible();
  // 제출 전 입력을 만들어 저장값이 생기게 한다
  await dayToggle(page, seoulDate(4)).click();
  await expect.poll(async () => (await keys(page, P)).length).toBe(1);
  let leaves = 0;
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().endsWith("/participants/me")) leaves += 1;
  });
  await mineOf(page).getByRole("button", { name: "약속 나가기" }).click();
  const dialog = dialogOf(page);
  await expect(dialog.getByText("약속에서 나가면 다시 참여할 수 없어요")).toBeVisible();
  expect(leaves, "확인 창 열기만으로 요청 없음").toBe(0);
  await expectNoHScroll(page);
  await dialog.getByRole("button", { name: "돌아가기" }).click();
  await expect(dialog).toHaveCount(0);
  expect(leaves).toBe(0);
  await mineOf(page).getByRole("button", { name: "약속 나가기" }).click();
  await dialogOf(page).getByRole("button", { name: "약속 나가기", exact: true }).click();
  await expect(
    text(page, "약속에서 나갔어요. 나간 닉네임으로는 다시 참여할 수 없어요."),
  ).toBeVisible();
  expect(leaves).toBe(1);
  expect(await keys(page, P), "이 약속의 저장값 삭제").toEqual([]);
  expect((await participantRow(m.id))?.status).toBe("cancelled");
  await expectNoHScroll(page);
  await fillAuth(page, m.nickname, "2468", "참여하고 시간 선택하기");
  await expect(text(page, "참여가 끝난 닉네임이에요")).toBeVisible();
});

test("방장 나가기 → 명단 다음 사람에게 자동 승계, 후임 화면에 방장 메뉴", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 2 });
  const succ = P.members[0];
  const h = await app.open(P, P.hostToken, "방장");
  const s = await app.open(P, succ.token, "후임");
  await expectInputScreen(h.page, P.hostNick);
  await expectInputScreen(s.page, succ.nickname);
  await expect(menuOf(s.page)).toHaveCount(0);
  await mineOf(h.page).getByRole("button", { name: "약속 나가기" }).click();
  const dialog = dialogOf(h.page);
  await expect(dialog.getByText(`${succ.nickname}님이 방장이 돼요`)).toBeVisible();
  await expectNoHScroll(h.page);
  const leaveRes = h.page.waitForResponse(
    (r) => r.url().endsWith("/participants/me") && r.request().method() === "DELETE",
  );
  await dialog.getByRole("button", { name: "방장 넘기고 나가기" }).click();
  const body = await (await leaveRes).json();
  const after = Date.now();
  expect([body.hostTransferred, body.newHostParticipantId]).toEqual([true, succ.id]);
  await expect(text(h.page, "약속에서 나갔어요.")).toBeVisible();
  // 후임 화면: 승계 뒤 처음 받은 명단 응답에 내 역할 host → 새로고침 없이 방장 메뉴
  await expectPollReflects(s.page, {
    match: subPath(P.promiseId, "/participants"),
    after,
    fresh: (j) =>
      (j as { participants?: { isMe: boolean; role: string }[] })?.participants?.some(
        (p) => p.isMe && p.role === "host",
      ) === true,
    screen: async () => {
      await expect(menuOf(s.page)).toBeVisible({ timeout: 5000 });
    },
  });
  await expect(text(s.page, "이제 내가 방장이에요")).toBeVisible();
  expect((await participantRow(succ.id))?.role).toBe("host");
  expect((await participantByNick(P.promiseId, P.hostNick))?.status).toBe("cancelled");
  await expectNoHScroll(s.page);
  await expectNoHScroll(h.page);
});

test("혼자인 방장 나가기 → 약속 취소", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 0 });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  await mineOf(page).getByRole("button", { name: "약속 나가기" }).click();
  const dialog = dialogOf(page);
  await expect(dialog.getByText("약속이 취소돼요")).toBeVisible();
  await dialog.getByRole("button", { name: "약속 취소하고 나가기" }).click();
  await expect(text(page, CANCELLED_TITLE)).toBeVisible();
  await expect(text(page, "다른 참여자가 없어 약속을 취소하고 나왔어요.")).toBeVisible();
  expect(await promiseStatus(P.promiseId)).toBe("cancelled");
});

test("draft 방장 그만두기 → 초안 삭제, 같은 링크 재사용", async ({ seed, app }) => {
  const D = await seed.draft();
  const { page } = await app.open(D, D.hostToken, "draft 방장");
  await expect(text(page, "새 약속 만들기")).toBeVisible({ timeout: 20_000 });
  // 이 기기에서 방장 등록한 것처럼 카운트다운 기준값을 넣고 다시 연다
  await page.evaluate(
    ([t, p]) =>
      localStorage.setItem(
        `yaksok:setup:${t}`,
        JSON.stringify({ promiseId: p, localExpiresAt: Date.now() + 9 * 60e3 }),
      ),
    [D.inviteToken, D.promiseId],
  );
  await page.reload();
  await expect(text(page, "설정 시간")).toBeVisible();
  await page.getByRole("button", { name: "약속 만들기 그만두기" }).click();
  const dialog = dialogOf(page);
  await expect(dialog.getByText("만들던 약속이 삭제돼요")).toBeVisible();
  await dialog.getByRole("button", { name: "삭제하고 나가기" }).click();
  await expect(text(page, REGISTER_HOST_TITLE)).toBeVisible();
  await expect(text(page, "만들던 약속을 삭제했어요")).toBeVisible();
  expect(await promiseStatus(D.promiseId)).toBeNull();
  expect(await keys(page, D)).toEqual([]);
  const again = await call("POST", `/api/v1/links/${D.inviteToken}/host`, {
    body: { nickname: nick("n"), pin: "1111" },
  });
  expect(again.status, "같은 링크로 다시 방장 등록 201").toBe(201);
});

test("나가기 응답 유실 → 다시 누르면 401 → 같은 나감 처리", async ({ seed, app }) => {
  const P = await seed.collecting({ members: 1 });
  const m = P.members[0];
  const { page } = await app.open(P, m.token, "참여자");
  await expectInputScreen(page, m.nickname);
  await dayToggle(page, seoulDate(3)).click();
  await expect.poll(async () => (await keys(page, P)).length).toBe(1);
  // 첫 응답을 끊은 뒤 다시 누르기 전에 폴링이 401을 먼저 받아 화면을 바꾸지 않게 GET을 붙잡아 둔다
  let holdPolls = true;
  const polls = /\/api\/v1\/promises\/[^/]+(\/.*)?$/;
  await page.route(polls, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    while (holdPolls) await new Promise((r) => setTimeout(r, 100));
    await route.continue().catch(() => {});
  });
  let firstStatus: number | null = null;
  await page.route("**/participants/me", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    const response = await route.fetch();
    firstStatus = response.status();
    await route.abort("failed");
  });
  await mineOf(page).getByRole("button", { name: "약속 나가기" }).click();
  const dialog = dialogOf(page);
  await dialog.getByRole("button", { name: "약속 나가기", exact: true }).click();
  await expect.poll(() => firstStatus, { message: "서버는 200으로 탈퇴" }).toBe(200);
  await expect(text(page, "나가지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeVisible();
  expect((await participantRow(m.id))?.status).toBe("cancelled");
  await page.unroute("**/participants/me");
  const second = page.waitForResponse(
    (r) => r.url().endsWith("/participants/me") && r.request().method() === "DELETE",
  );
  await dialog.getByRole("button", { name: "약속 나가기", exact: true }).click();
  const res = await second;
  expect([res.status(), (await res.json()).code]).toEqual([401, "UNAUTHENTICATED"]);
  holdPolls = false;
  await expect(text(page, "약속에서 나갔어요.")).toBeVisible();
  expect(await keys(page, P)).toEqual([]);
  await page.unroute(polls);
});

test("로그아웃: 이 기기만(다른 기기 유지) → 재로그인 → 모든 기기", async ({ seed, app }) => {
  test.setTimeout(150_000);
  const P = await seed.collecting({ members: 1 });
  const m = P.members[0];
  const second = await login(P.promiseId, m.nickname);
  const d1 = await app.open(P, m.token, "기기1");
  const d2 = await app.open(P, second.token!, "기기2");
  await expectInputScreen(d1.page, m.nickname);
  await expectInputScreen(d2.page, m.nickname);
  expect(await sessionCount(m.id)).toBe(2);
  await dayToggle(d1.page, seoulDate(2)).click();
  await expect.poll(async () => (await keys(d1.page, P)).length).toBe(1);
  await expect(mineOf(d1.page).getByText("닉네임과 PIN으로 다시 로그인할 수 있어요")).toBeVisible();

  await test.step("이 기기에서 로그아웃", async () => {
    let logoutUrl: string | null = null;
    d1.page.on("request", (r) => {
      if (r.method() === "DELETE" && r.url().includes("/auth/session")) logoutUrl = r.url();
    });
    await mineOf(d1.page).getByRole("button", { name: "이 기기에서 로그아웃" }).click();
    await expect(text(d1.page, "다시 로그인하기")).toBeVisible();
    await expect(
      text(d1.page, "로그아웃했어요. 닉네임과 PIN으로 다시 로그인할 수 있어요."),
    ).toBeVisible();
    const after = Date.now();
    expect(logoutUrl).not.toBeNull();
    expect(logoutUrl!).not.toContain("allDevices");
    expect(await keys(d1.page, P)).toEqual([]);
    expect(await sessionCount(m.id)).toBe(1);
    expect((await participantRow(m.id))?.status).toBe("active");
    // 다른 기기: 로그아웃 뒤에 보낸 폴링이 200을 받고 화면이 그대로다
    const poll = await nextPollResponse(
      d2.page,
      (p) => p === `/api/v1/promises/${P.promiseId}`,
      after,
    );
    expect(poll.status()).toBe(200);
    expect(await isInputScreen(d2.page, m.nickname)).toBe(true);
    expect((await as(P.promiseId, second.token!).get("/me")).status).toBe(200);
    await fillAuth(d1.page, m.nickname, "2468", "로그인");
    await expectInputScreen(d1.page, m.nickname);
  });

  await test.step("모든 기기에서 로그아웃", async () => {
    let allCalls = 0;
    d1.page.on("request", (r) => {
      if (r.method() === "DELETE" && r.url().includes("/auth/session?allDevices=true"))
        allCalls += 1;
    });
    await mineOf(d1.page).getByRole("button", { name: "모든 기기에서 로그아웃" }).click();
    const dialog = dialogOf(d1.page);
    await expect(dialog.getByText("모든 기기에서 로그아웃할까요?")).toBeVisible();
    await expect(dialog.getByText("다시 로그인할 수 있어요")).toBeVisible();
    await expect(dialog.getByText("다시 참여할 수 없어요")).toHaveCount(0);
    expect(allCalls).toBe(0);
    await expectNoHScroll(d1.page);
    // 다른 기기: 로그아웃 뒤 폴링이 401 → 링크 재조회로 참여·로그인 화면(그 뒤 폴링이 멈춰 대기를 먼저 건다)
    const clock = changeClock();
    const otherOut = expectPollReflects(d2.page, {
      match: pollPath(P.promiseId),
      after: clock.after,
      fresh: (_json, res) => res.status() === 401,
      screen: async () => {
        await expect(d2.page.locator("#nickname")).toBeVisible({ timeout: 5000 });
      },
    });
    const changed = d1.page.waitForResponse((r) =>
      r.url().includes("/auth/session?allDevices=true"),
    );
    await dialog.getByRole("button", { name: "모든 기기에서 로그아웃", exact: true }).click();
    await changed;
    clock.mark();
    await expect(text(d1.page, "다시 로그인하기")).toBeVisible();
    expect(allCalls).toBe(1);
    expect(await sessionCount(m.id)).toBe(0);
    await otherOut;
    await d2.page.getByRole("button", { name: "이미 참여했어요 · 다시 로그인" }).click();
    await fillAuth(d2.page, m.nickname, "2468", "로그인");
    await expectInputScreen(d2.page, m.nickname);
    expect(await sessionCount(m.id, true)).toBe(1);
  });
  await expectNoHScroll(d2.page);
});

test("방장이 하루 범위를 줄이면 제출 전 입력도 다음 폴링에서 정리(선택 N칸 = 화면 칸)", async ({
  seed,
  app,
}) => {
  const P = await seed.collecting({ members: 1 });
  const m = P.members[0];
  const { page } = await app.open(P, m.token, "참여자");
  await expectInputScreen(page, m.nickname);
  await dayToggle(page, seoulDate(4)).click(); // 09~18시 하루 전체 18칸
  await expect.poll(() => selectedCount(page)).toBe(18);
  expect(await pressedCells(page)).toBe(18);
  const patch = await call("PATCH", `/api/v1/promises/${P.promiseId}/settings`, {
    cookie: cookieOf(P.promiseId, P.hostToken),
    body: { dailyTimeRange: { startTime: "09:00", endTime: "12:00" } },
  });
  expect(patch.status, patch.text).toBe(200);
  const after = Date.now();
  // 시간 입력 그리드는 가능 시간 조회(/availability)의 설정으로 그린다
  await expectPollReflects(page, {
    match: subPath(P.promiseId, "/availability"),
    after,
    fresh: (j) =>
      (j as { settings?: { dailyEndTime?: string } })?.settings?.dailyEndTime === "12:00",
    screen: async () => {
      await expect.poll(() => pressedCells(page), { timeout: 5000 }).toBe(6);
      expect(await selectedCount(page)).toBe(6);
    },
  });
  await expect(text(page, "범위 밖 입력 12칸을 지웠어요")).toBeVisible();
  const stored = await page.evaluate(
    (p) =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) => k.startsWith(`yaksok:availability:${p}:`))!,
        )!,
      ).slots.length,
    P.promiseId,
  );
  expect(stored, "저장소의 제출 전 입력도 6칸").toBe(6);
  await expect(text(page, "입력 중 · 제출 전")).toBeVisible();
  await expectNoHScroll(page);
});
