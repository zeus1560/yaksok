// 시간 입력 화면 동기화 (012·fix 001) — scripts/verify/fix-availability-intake.mjs에서 옮김
// + 029-bug-repro.mjs의 관찰(빈 제출 확인 취소 직후 첫 드래그, 드래그 뒤 글자 선택)을 회귀 검사로
// 시간 기준 판정은 요청 순서로 본다(030): 정기 폴링 응답보다 먼저 채워지는가, 변경 뒤 첫 폴링 응답에 반영되는가
import { addSession, test, expect, expectPollReflects, subPath } from "./support/fixtures";
import { as, cookieOf, call, seoulDate, slotAt, slotMs } from "./support/api";
import { participantSlotCount } from "./support/db";
import {
  CANDIDATES_TITLE,
  dayToggle,
  dialogOf,
  expectInputScreen,
  expectNoHScroll,
  isMobile,
  myCell,
  pressedCells,
  selectedCount,
  text,
} from "./support/ui";
import type { Request } from "@playwright/test";

const NOTICE_CHANGED = "다른 곳에서 내용이 바뀌었어요. 최신 내용으로 다시 그렸어요.";
const NOTICE_CONFLICT = "다른 기기에서 먼저 저장한 내용이 있어요.";
const BOARD_POLL_MS = 5000; // components/availability/availability-board.tsx POLL_MS

test("첫 조회·로컬 입력 유지·다른 기기 변경 안내·409 충돌·제출", async ({ seed, app }) => {
  test.setTimeout(150_000);
  const P = await seed.collecting({ members: 1 });
  const m = P.members[0];
  const availPath = subPath(P.promiseId, "/availability");
  const { page } = await app.blank("참여자");
  const gets: Request[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" && availPath(new URL(r.url()).pathname)) gets.push(r);
  });
  await addSession(page.context(), P.promiseId, m.token);
  await page.goto(`/p/${P.inviteToken}`);
  await expectInputScreen(page, m.nickname);

  await test.step("첫 조회: 화면이 채워질 때까지 가능 시간 조회 1회(합류가 아니면 추가 조회 없음)", async () => {
    await expect(page.getByRole("button", { name: "가능 시간 제출" })).toBeVisible();
    expect(gets.length).toBe(1);
  });

  await test.step("로컬 입력: 폴링 한 주기 뒤에도 유지, 새로고침 뒤 복원", async () => {
    await dayToggle(page, seoulDate(4)).click();
    await expect.poll(() => selectedCount(page)).toBe(18);
    await expect(text(page, "입력 중 · 제출 전")).toBeVisible();
    const after = Date.now();
    await expectPollReflects(page, {
      match: availPath,
      after,
      fresh: () => true,
      screen: async () => {
        expect(await selectedCount(page)).toBe(18);
        expect(await pressedCells(page)).toBe(18);
      },
    });
    await page.reload();
    await expect.poll(() => selectedCount(page), { timeout: 15_000 }).toBe(18);
    await expect(text(page, "입력 중 · 제출 전")).toBeVisible();
  });

  await test.step("다른 기기가 먼저 제출 → 다음 폴링에서 로컬 입력 폐기·안내", async () => {
    const other = await as(P.promiseId, m.token).submit([slotAt(3, "09:00")]);
    expect(other.status).toBe(200);
    const after = Date.now();
    await expectPollReflects(page, {
      match: availPath,
      after,
      fresh: (j) => (j as { me?: { version?: number } })?.me?.version === 1,
      screen: async () => {
        await expect(text(page, NOTICE_CHANGED)).toBeVisible({ timeout: 3000 });
      },
    });
    expect(await pressedCells(page)).toBe(1);
    await expect(text(page, "제출됨")).toBeVisible();
  });

  await test.step("409 충돌: 폴링 전에 이 기기가 제출 → 서버 값으로 다시 그림", async () => {
    await dayToggle(page, seoulDate(4)).click();
    await expect.poll(() => selectedCount(page)).toBe(19);
    let hold = true;
    const polls = /\/api\/v1\/promises\/[^/]+(\/.*)?$/;
    await page.route(polls, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      while (hold) await new Promise((r) => setTimeout(r, 100));
      await route.continue().catch(() => {});
    });
    const other = await as(P.promiseId, m.token).submit(
      [slotAt(2, "10:00"), slotAt(2, "10:30")],
      1,
    );
    expect(other.status).toBe(200);
    const put = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().endsWith("/me/availability"),
    );
    await page.getByRole("button", { name: "다시 제출" }).click();
    expect((await put).status()).toBe(409);
    await expect(text(page, NOTICE_CONFLICT)).toBeVisible();
    expect(await pressedCells(page)).toBe(2);
    await expect(text(page, "제출됨")).toBeVisible();
    hold = false;
    await page.unroute(polls);
    const after = Date.now();
    await expectPollReflects(page, {
      match: availPath,
      after,
      fresh: (j) => (j as { me?: { version?: number } })?.me?.version === 2,
      screen: async () => {
        expect(await pressedCells(page), "409 뒤 폴링에도 서버 값 유지").toBe(2);
        await expect(text(page, "제출됨")).toBeVisible();
      },
    });
  });

  await test.step("정상 제출", async () => {
    await dayToggle(page, seoulDate(4)).click();
    await expect.poll(() => selectedCount(page)).toBe(20);
    await page.getByRole("button", { name: "다시 제출" }).click();
    await expect(text(page, "제출했어요.")).toBeVisible();
    await expect(text(page, "제출됨")).toBeVisible();
    expect(await participantSlotCount(m.id)).toBe(20);
  });
  await expectNoHScroll(page);
});

// 후보 화면 「모두의 시간」을 연 상태에서 방장이 다시 열면, 새로 그려진 시간 입력 화면이 정기 폴링을 기다리지 않고 채워진다
// 화면 전환 시점 S = 재조율 응답 뒤 처음 받은 collecting 상태 응답. S + 5초 이후에 보낸 /availability 요청을 정기 폴링으로 본다
// 통과 조건: 정기 폴링 응답을 받기 전에 채워진다. fix 001 이전 버그(합류한 응답을 못 받음)라면 정기 폴링 뒤에야 채워진다
test("재조율 뒤 시간 입력 화면이 진행 중인 요청에 합류해 바로 채워짐(5회)", async ({
  seed,
  app,
}) => {
  test.setTimeout(240_000);
  const P = await seed.collecting({ members: 1 });
  const hostCookie = cookieOf(P.promiseId, P.hostToken);
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  const PROMISE_PATH = `/api/v1/promises/${P.promiseId}`;
  type Net = { kind: "status" | "avail"; sentAt: number; doneAt?: number; promiseStatus?: string };
  const net: Net[] = [];
  const netOf = new Map<Request, Net>();
  const kindOf = (req: Request) => {
    if (req.method() !== "GET") return null;
    const p = new URL(req.url()).pathname;
    if (p === PROMISE_PATH) return "status" as const;
    if (p === `${PROMISE_PATH}/availability`) return "avail" as const;
    return null;
  };
  page.on("request", (req) => {
    const kind = kindOf(req);
    if (!kind) return;
    const e: Net = { kind, sentAt: Date.now() };
    net.push(e);
    netOf.set(req, e);
  });
  page.on("requestfinished", async (req) => {
    const e = netOf.get(req);
    if (!e) return;
    const doneAt = Date.now();
    if (e.kind === "status") {
      try {
        e.promiseStatus = (await (await req.response())?.json())?.promiseStatus;
      } catch {}
    }
    e.doneAt = doneAt;
  });
  // 합류를 확실히 만든다: 「모두의 시간」 조회 하나를 붙잡아 두었다가 화면이 바뀐 직후 놓아준다
  const hold: { armed: boolean; held: boolean; release: (() => void) | null; req: Request | null } =
    {
      armed: false,
      held: false,
      release: null,
      req: null,
    };
  await page.route(new RegExp(`${PROMISE_PATH}/availability$`), async (route) => {
    if (route.request().method() !== "GET" || !hold.armed) return route.continue();
    hold.armed = false;
    hold.req = route.request();
    await new Promise<void>((r) => {
      hold.release = r;
      hold.held = true;
    });
    await route.continue().catch(() => {});
  });

  const rounds: { ok: boolean; joinable: boolean; text: string }[] = [];
  for (let round = 0; round < 5; round += 1) {
    await call("POST", `${PROMISE_PATH}/close`, { cookie: hostCookie });
    await expect(text(page, CANDIDATES_TITLE)).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByRole("button", { name: "모두의 시간 보기" });
    if (await toggle.isVisible()) await toggle.click();
    await expect(text(page, "모두의 가능 시간")).toBeVisible();
    Object.assign(hold, { armed: true, held: false, release: null, req: null });
    await expect.poll(() => hold.held, { timeout: 15_000 }).toBe(true);
    await call("POST", `${PROMISE_PATH}/reopen`, {
      cookie: hostCookie,
      body: { votingDeadlineAt: `${seoulDate(1)}T12:00:00+09:00` },
    });
    const t0 = Date.now();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const switched = () =>
      net.find(
        (e) => e.kind === "status" && (e.doneAt ?? 0) >= t0 && e.promiseStatus === "collecting",
      );
    await expect.poll(() => !!switched(), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(300);
    hold.armed = false;
    hold.release?.();
    let filledAt: number | null = null;
    const filled = async () =>
      (await page.getByRole("button", { name: "다시 제출" }).isVisible()) ||
      (await page.getByRole("button", { name: "가능 시간 제출" }).isVisible());
    const end = Date.now() + 15_000;
    while (Date.now() < end) {
      if (await filled().catch(() => false)) {
        filledAt = Date.now();
        break;
      }
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(300);
    const S = switched()?.doneAt;
    const regular =
      S === undefined
        ? undefined
        : net.find((e) => e.kind === "avail" && e.sentAt >= S + BOARD_POLL_MS);
    const used =
      S === undefined || filledAt === null
        ? undefined
        : net
            .filter((e) => e.kind === "avail" && e.doneAt !== undefined && e.doneAt <= filledAt!)
            .at(-1);
    const source = !used
      ? "?"
      : used.sentAt < S!
        ? used.doneAt! < S!
          ? "막 받은 응답"
          : "합류"
        : "새 요청";
    const ok =
      filledAt !== null &&
      S !== undefined &&
      filledAt >= S &&
      (regular === undefined || regular.doneAt === undefined || filledAt < regular.doneAt);
    const heldE = hold.req ? netOf.get(hold.req) : undefined;
    rounds.push({
      ok,
      joinable:
        S !== undefined && heldE?.doneAt !== undefined && heldE.sentAt < S && heldE.doneAt > S,
      text: `${round + 1}회: 전환 +${S === undefined ? "?" : S - t0}ms, 채워짐 +${filledAt === null || S === undefined ? "?" : filledAt - S}ms, ${source}, 정기 폴링 ${regular?.doneAt === undefined ? "채워진 뒤" : `+${regular.doneAt - S!}ms`}`,
    });
  }
  await page.unroute(new RegExp(`${PROMISE_PATH}/availability$`));
  await test.info().attach("회차별 기록", {
    body: rounds.map((r) => r.text).join("\n"),
    contentType: "text/plain",
  });
  expect(
    rounds.map((r) => r.joinable),
    `준비: 합류 상황 ${rounds.map((r) => r.text).join(" / ")}`,
  ).toEqual(Array(5).fill(true));
  expect(
    rounds.map((r) => r.ok),
    rounds.map((r) => r.text).join(" / "),
  ).toEqual(Array(5).fill(true));
});

test("빈 제출 확인 취소 직후 첫 드래그 반영, 드래그 뒤 글자 선택 없음 (마우스)", async ({
  seed,
  app,
}) => {
  const P = await seed.collecting({
    members: 0,
    settings: {
      dateRange: { startDate: seoulDate(1), endDate: seoulDate(7) },
      dailyTimeRange: { startTime: "14:00", endTime: "22:00" },
      durationMinutes: 90,
    },
  });
  const { page } = await app.open(P, P.hostToken, "방장");
  test.skip(isMobile(page), "마우스 드래그는 데스크톱만(휴대폰은 칸을 눌러 고른다)");
  await expectInputScreen(page, P.hostNick);
  await page.getByRole("button", { name: /^가능 시간 제출$/ }).click();
  await dialogOf(page).getByRole("button", { name: "시간 선택으로" }).click();
  await expect(dialogOf(page)).toHaveCount(0);
  const center = async (ms: number) => {
    const cell = myCell(page, ms);
    await cell.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    const b = (await cell.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const drag = async (from: number, to: number) => {
    const a = await center(from);
    const b = (await myCell(page, to).boundingBox())!;
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    // 사람 손처럼 마지막 칸에 들어간 뒤 잠깐 있다가 놓는다. 들어가자마자(0ms) 놓는 경우는 아래 별도 테스트
    await page.waitForTimeout(50);
    await page.mouse.up();
  };
  await drag(slotMs(2, "18:00"), slotMs(2, "19:00"));
  await expect
    .poll(() => pressedCells(page), { message: "확인 창 취소 직후 첫 드래그 3칸" })
    .toBe(3);
  const selection = () => page.evaluate(() => window.getSelection()?.toString() ?? "");
  // 칸에서 시작해 오른쪽 패널 글자 위까지 끌어도 글자가 선택되지 않는다
  const start = await center(slotMs(3, "17:00"));
  const right = (await page.getByText("모두의 가능 시간").first().boundingBox())!;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(right.x + right.width / 2, right.y + 5, { steps: 10 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  expect(await selection()).toBe("");
  await drag(slotMs(5, "17:00"), slotMs(6, "18:00"));
  expect(await selection()).toBe("");
});

// fix 002 회귀: 마지막 칸에 들어간 직후(0ms) 놓으면 WebKit에서 그 칸이 빠졌다
// (놓기 리스너가 효과에서 다시 달리기 전의 드래그 상태를 읽음 → lib/availability/drag.ts가 즉시 바꾸는 상태로 수정)
test("드래그 마지막 칸에 들어간 직후(0ms) 놓아도 3칸이 선택된다 (마우스)", async ({
  seed,
  app,
}) => {
  const projectName = test.info().project.name;
  test.skip(projectName === "webkit-mobile", "마우스 드래그는 데스크톱만");
  const P = await seed.collecting({
    members: 0,
    settings: {
      dateRange: { startDate: seoulDate(1), endDate: seoulDate(7) },
      dailyTimeRange: { startTime: "14:00", endTime: "22:00" },
      durationMinutes: 90,
    },
  });
  const { page } = await app.open(P, P.hostToken, "방장");
  await expectInputScreen(page, P.hostNick);
  const from = myCell(page, slotMs(2, "18:00"));
  await from.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  const a = (await from.boundingBox())!;
  const b = (await myCell(page, slotMs(2, "19:00")).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up(); // 기다리지 않고 바로 놓는다
  await expect
    .poll(() => pressedCells(page), { message: "18:00·18:30·19:00 3칸", timeout: 3000 })
    .toBe(3);
});
