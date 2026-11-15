// 통합 테스트 공통 픽스처
// - seed: 테스트 하나가 만든 링크를 기록하고 끝나면 지운다(브라우저가 만든 링크도 응답을 보고 기록한다)
// - app: 사람마다 브라우저 컨텍스트를 따로 연다(쿠키·저장소 분리). 끝나면 콘솔 오류가 없는지 본다
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from "@playwright/test";
import { BASE, Seed, cookieName, type Draft } from "./api";
import { E2E_HOST, IS_PREVIEW, bypassHeaders } from "./e2e-env";

export { expect };

type Person = { context: BrowserContext; page: Page };
type DeviceOptions = Pick<
  BrowserContextOptions,
  "viewport" | "userAgent" | "deviceScaleFactor" | "isMobile" | "hasTouch"
>;

export class App {
  private contexts: BrowserContext[] = [];
  readonly consoleErrors: string[] = [];
  readonly loadErrors: string[] = [];

  constructor(
    private browser: Browser,
    private seed: Seed,
    private testInfo: TestInfo,
  ) {}

  // 프로젝트(데스크톱·모바일)의 화면 크기·터치 설정을 그대로 쓴다. device는 그 위에 덮어쓴다
  // (예: chromium에서 휴대폰을 흉내 내 CDP로 실제 터치를 보낼 때 — mobile-drag.spec.ts)
  async newContext(device: DeviceOptions = {}): Promise<BrowserContext> {
    const use = this.testInfo.project.use;
    const context = await this.browser.newContext({
      viewport: use.viewport,
      userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor,
      isMobile: use.isMobile,
      hasTouch: use.hasTouch,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      ignoreHTTPSErrors: !IS_PREVIEW,
      baseURL: BASE,
      // 미리보기의 Deployment Protection 우회(값이 없으면 빈 객체)
      extraHTTPHeaders: bypassHeaders(),
      ...device,
    });
    this.contexts.push(context);
    this.trackLinks(context);
    return context;
  }

  // 브라우저에서 만든 초대 링크(홈의 새 약속 만들기)도 정리 대상에 넣는다
  trackLinks(context: BrowserContext) {
    context.on("response", async (res) => {
      const req = res.request();
      if (req.method() !== "POST" || !/\/api\/v1\/links$/.test(new URL(res.url()).pathname)) return;
      try {
        const body = await res.json();
        if (typeof body?.inviteToken === "string") this.seed.track(body.inviteToken);
      } catch {}
    });
  }

  watch(page: Page, label: string) {
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // 의도한 4xx(나간 뒤·취소 뒤 재조회 등)와 끊은 요청의 리소스 로드 실패는 따로 센다
      if (/Failed to load resource/.test(msg.text()))
        this.loadErrors.push(`${label}: ${msg.text()}`);
      else this.consoleErrors.push(`${label}: ${msg.text()}`);
    });
    page.on("pageerror", (error) => this.consoleErrors.push(`${label}: ${error.message}`));
  }

  // 세션 쿠키를 가진 사람으로 초대 링크를 연다. token이 없으면 처음 온 사람
  async open(
    P: Pick<Draft, "inviteToken" | "promiseId">,
    token: string | null,
    label: string,
    device: DeviceOptions = {},
  ): Promise<Person> {
    const context = await this.newContext(device);
    if (token) await addSession(context, P.promiseId, token);
    const page = await context.newPage();
    this.watch(page, label);
    await page.goto(`/p/${P.inviteToken}`);
    return { context, page };
  }

  async blank(label: string): Promise<Person> {
    const context = await this.newContext();
    const page = await context.newPage();
    this.watch(page, label);
    return { context, page };
  }

  async close() {
    for (const c of this.contexts) await c.close().catch(() => {});
  }
}

export async function addSession(context: BrowserContext, promiseId: string, token: string) {
  await context.addCookies([
    {
      name: cookieName(promiseId),
      value: token,
      domain: E2E_HOST,
      path: `/api/v1/promises/${promiseId}`,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

// 픽스처의 두 번째 인자(Playwright의 use)는 React 훅 규칙에 걸리지 않게 provide로 부른다
export const test = base.extend<{ seed: Seed; app: App }>({
  seed: async ({}, provide) => {
    const seed = new Seed();
    await provide(seed);
    await seed.cleanup();
  },
  app: async ({ browser, seed }, provide, testInfo) => {
    const app = new App(browser, seed, testInfo);
    await provide(app);
    await app.close();
    if (app.loadErrors.length > 0) {
      await testInfo.attach("의도한 4xx·끊은 요청 리소스 로드 메시지", {
        body: [...new Set(app.loadErrors)].join("\n"),
        contentType: "text/plain",
      });
    }
    // 실패한 테스트에는 덧붙이지 않는다(원래 실패를 가리지 않게)
    if (testInfo.status === testInfo.expectedStatus) {
      expect(app.consoleErrors, "콘솔 오류 없음(리소스 로드 실패 제외)").toEqual([]);
    }
  },
});

// ── 요청 순서 판정 (030 방식): 절대 시간 대신 "변경 뒤에 시작한 첫 폴링 응답"을 기준으로 본다
// after: 변경 응답을 받은 시각. 함수로 넘기면 응답을 기다리기 시작한 뒤에 정할 수 있다(changeClock)
export function startedAt(req: Request): number {
  const t = req.timing().startTime;
  return t > 0 ? t : 0;
}

type After = number | (() => number);
const afterOf = (after: After) => (typeof after === "function" ? after() : after);

// 변경 전에 대기를 먼저 걸어 두고, 변경 응답을 받은 순간 mark()한다
// (변경 뒤 폴링이 멈추는 화면 — 취소·로그아웃 — 은 기준 시각을 잡기 전에 끝난 응답을 놓치면 다시 오지 않는다)
export function changeClock() {
  let at = Number.POSITIVE_INFINITY;
  return {
    after: () => at,
    mark: () => {
      at = Date.now();
    },
  };
}

export async function nextPollResponse(
  page: Page,
  match: (pathname: string) => boolean,
  after: After,
  timeout = 20_000,
): Promise<Response> {
  return page.waitForResponse(
    (res) => {
      const req = res.request();
      return (
        req.method() === "GET" &&
        match(new URL(res.url()).pathname) &&
        startedAt(req) >= afterOf(after)
      );
    },
    { timeout },
  );
}

export const statusPath = (promiseId: string) => (p: string) =>
  p === `/api/v1/promises/${promiseId}`;
export const subPath = (promiseId: string, sub: string) => (p: string) =>
  p === `/api/v1/promises/${promiseId}${sub}`;
// 화면이 주기적으로 보내는 조회(상태·명단·가능 시간·후보). /me·링크 조회는 화면 전환 때만 보내므로 뺀다
export const pollPath = (promiseId: string) => (p: string) =>
  p === `/api/v1/promises/${promiseId}` ||
  ["/participants", "/availability", "/candidates"].some(
    (sub) => p === `/api/v1/promises/${promiseId}${sub}`,
  );

export type Fresh = (json: unknown, res: Response) => boolean;

// 변경 뒤 폴링이 새 값을 받고(캐시가 끼지 않음), 그 응답 뒤 화면이 곧 바뀌는지 본다
// 기준 응답: ① 변경 뒤에 시작한 첫 폴링 응답(반드시 새 값이어야 한다), 또는 ② 그보다 먼저,
// 변경 중에 이미 나가 있던 폴링이 변경 뒤에 새 값을 받아 온 응답(화면이 거기서 바뀌고 폴링이 멈출 수 있다)
export async function expectPollReflects(
  page: Page,
  opts: {
    match: (pathname: string) => boolean;
    after: After;
    fresh: Fresh;
    screen: () => Promise<void>;
  },
) {
  const res = await page.waitForResponse(
    async (r) => {
      const req = r.request();
      if (req.method() !== "GET" || !opts.match(new URL(r.url()).pathname)) return false;
      const after = afterOf(opts.after);
      if (startedAt(req) >= after) return true;
      // ②: 기준 시각(변경 응답을 받고 mark()한 때)보다 먼저 도착했어도 새 값이면 받는다. 새 값은 서버가 이미
      // 변경을 커밋했다는 뜻이다. 응답이 빠른 배포에서는 커밋 직후의 폴링이 mark()보다 먼저 돌아오고,
      // 취소처럼 폴링이 멈추는 화면은 그 응답을 버리면 다음 응답이 오지 않는다(032 2부)
      return opts.fresh(await r.json().catch(() => null), r);
    },
    { timeout: 20_000 },
  );
  const json = await res.json().catch(() => null);
  expect(
    opts.fresh(json, res),
    `변경 뒤 폴링 응답이 새 값: ${res.status()} ${res.url()} ${JSON.stringify(json)?.slice(0, 300)}`,
  ).toBe(true);
  await opts.screen();
}
