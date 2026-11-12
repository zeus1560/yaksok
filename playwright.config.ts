// 통합 테스트(Playwright Test, 031·032). 단위 테스트(Vitest, npm run test)와 따로 돈다
// 로컬(기본, npm run test:e2e)
// - DB: .env.e2e(Neon e2e 브랜치)만 쓴다. 없거나 개발 DB(.env)와 같으면 여기서 실행을 거부한다
// - 서버: next build → next start(운영 모드). 브라우저는 https://localhost:3100(로컬 https 프록시)으로 연다
//   세션 쿠키가 항상 Secure라 WebKit은 http://localhost로는 쿠키를 보내지 않기 때문이다(tests/e2e/support/serve.ts)
// 배포 주소(E2E_TARGET=preview, npm run test:e2e:preview)
// - 서버를 띄우지 않고 E2E_BASE_URL(Vercel 미리보기 주소)에 붙는다. DB 도우미는 .env.preview(Neon 미리보기 브랜치)
// - @smoke 태그가 붙은 묶음만 돈다: 전체 흐름, 운영 응답(no-store·쿠키 속성), 다른 Origin 거부, 초대 링크 주소, /api/health
// - Deployment Protection 우회 비밀값(VERCEL_AUTOMATION_BYPASS_SECRET)이 있으면 모든 요청에 헤더로 보낸다
// 프로젝트: chromium 데스크톱, webkit 데스크톱, webkit 모바일(iPhone 크기)
//   API만 부르는 테스트(tests/e2e/api/)는 브라우저와 관계없어 chromium 데스크톱에서만 돈다
import { defineConfig, devices } from "@playwright/test";
import {
  E2E_BASE_URL,
  IS_PREVIEW,
  LOCAL_BASE_URL,
  bypassHeaders,
  loadTargetDb,
} from "./tests/e2e/support/e2e-env";

loadTargetDb();

const API_ONLY = /tests[\\/]e2e[\\/]api[\\/]/;
const OUT = IS_PREVIEW ? "./test-results/preview" : "./test-results";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  grep: IS_PREVIEW ? /@smoke/ : undefined,
  outputDir: `${OUT}/e2e`,
  globalSetup: "./tests/e2e/support/global-setup.ts",
  globalTeardown: "./tests/e2e/support/global-teardown.ts",
  // 폴링(5초) 반영을 기다리는 테스트가 많아 넉넉히 둔다. 전체 흐름은 테스트 안에서 더 늘린다
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${OUT}/e2e-report`, open: "never" }],
    ["json", { outputFile: `${OUT}/e2e-results.json` }],
  ],
  use: {
    baseURL: E2E_BASE_URL,
    // 자체 서명 인증서는 로컬 프록시에서만 받는다
    ignoreHTTPSErrors: !IS_PREVIEW,
    extraHTTPHeaders: bypassHeaders(),
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "webkit-desktop",
      testIgnore: API_ONLY,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "webkit-mobile",
      testIgnore: API_ONLY,
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: IS_PREVIEW
    ? undefined
    : {
        command: "npx tsx tests/e2e/support/serve.ts",
        url: `${LOCAL_BASE_URL}/api/health`,
        ignoreHTTPSErrors: true,
        reuseExistingServer: false,
        timeout: 300_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
