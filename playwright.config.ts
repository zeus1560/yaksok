// 통합 테스트(Playwright Test, 031). 단위 테스트(Vitest, npm run test)와 따로 돈다: npm run test:e2e
// - DB: .env.e2e(Neon e2e 브랜치)만 쓴다. 없거나 개발 DB(.env)와 같으면 여기서 실행을 거부한다
// - 서버: next build → next start(운영 모드). 브라우저는 https://localhost:3100(로컬 https 프록시)으로 연다
//   세션 쿠키가 항상 Secure라 WebKit은 http://localhost로는 쿠키를 보내지 않기 때문이다(tests/e2e/support/serve.ts)
// - 프로젝트: chromium 데스크톱, webkit 데스크톱, webkit 모바일(iPhone 크기)
//   API만 부르는 테스트(tests/e2e/api/)는 브라우저와 관계없어 chromium 데스크톱에서만 돈다
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, loadE2eEnv } from "./tests/e2e/support/e2e-env";

loadE2eEnv();

const API_ONLY = /tests[\\/]e2e[\\/]api[\\/]/;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  outputDir: "./test-results/e2e",
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
    ["html", { outputFolder: "./test-results/e2e-report", open: "never" }],
    ["json", { outputFile: "./test-results/e2e-results.json" }],
  ],
  use: {
    baseURL: E2E_BASE_URL,
    ignoreHTTPSErrors: true,
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
  webServer: {
    command: "npx tsx tests/e2e/support/serve.ts",
    url: `${E2E_BASE_URL}/api/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
