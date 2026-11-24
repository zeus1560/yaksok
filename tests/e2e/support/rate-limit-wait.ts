// 미리보기 smoke의 429 RATE_LIMITED 처리 (035, R-41)
// 배포 주소에서는 Vercel이 x-forwarded-for를 실제 IP로 덮어써 모든 요청이 이 PC의 IP 하나로 모인다(링크 발급 1분 10회 등).
// 미리보기 기준을 따로 두지 않고, 429 RATE_LIMITED를 받으면 Retry-After만큼 기다렸다 다시 보낸다
// - 로컬 실행은 요청마다 다른 시험용 IP를 보내 429가 나지 않고, 429를 기대하는 테스트도 있어 기다리지 않는다
// - 기다린 기록은 작업자 프로세스끼리 파일 하나에 모으고, 실행 전체 대기 상한을 넘으면 더 기다리지 않는다(그 429로 실패)
// - 실행이 끝나면 global-teardown이 기다린 횟수와 시간을 출력한다
import fs from "node:fs";
import path from "node:path";
import { IS_PREVIEW, STATE_DIR } from "./e2e-env";

export const RATE_LIMIT_WAIT_CAP_MS = 180_000; // 실행 전체(모든 작업자) 대기 상한 3분
const WAIT_FILE = path.join(STATE_DIR, "rate-limit-waits.jsonl");

type WaitRecord = { where: string; ms: number };

function readWaits(): WaitRecord[] {
  if (!fs.existsSync(WAIT_FILE)) return [];
  return fs
    .readFileSync(WAIT_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WaitRecord);
}

export function resetRateLimitWaits() {
  fs.rmSync(WAIT_FILE, { force: true });
}

export function rateLimitWaitSummary(): string {
  const waits = readWaits();
  const total = waits.reduce((sum, w) => sum + w.ms, 0);
  const detail = waits.map((w) => `${w.where} ${(w.ms / 1000).toFixed(1)}초`).join(", ");
  return `[e2e] 429 RATE_LIMITED 대기 ${waits.length}회, 합계 ${(total / 1000).toFixed(1)}초${detail ? ` (${detail})` : ""}`;
}

// 429 RATE_LIMITED 응답을 받았을 때 부른다. 기다렸으면 true(다시 보내면 된다), 기다리지 않으면 false
export async function waitForRateLimit(
  status: number,
  code: unknown,
  retryAfter: string | null | undefined,
  where: string,
): Promise<boolean> {
  if (!IS_PREVIEW || status !== 429 || code !== "RATE_LIMITED") return false;
  const seconds = Number(retryAfter);
  const ms = (Number.isFinite(seconds) && seconds > 0 ? seconds : 5) * 1000 + 500;
  const used = readWaits().reduce((sum, w) => sum + w.ms, 0);
  if (used + ms > RATE_LIMIT_WAIT_CAP_MS) {
    console.warn(
      `[e2e] ⚠ ${where}: 429 대기 상한 ${RATE_LIMIT_WAIT_CAP_MS / 1000}초를 넘어 더 기다리지 않음(지금까지 ${(used / 1000).toFixed(1)}초)`,
    );
    return false;
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(WAIT_FILE, `${JSON.stringify({ where, ms })}\n`);
  console.log(`[e2e] ${where}: 429 RATE_LIMITED — ${(ms / 1000).toFixed(1)}초 기다렸다 다시 보냄`);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return true;
}

// 화면에서 누른 버튼의 요청이 429 RATE_LIMITED면 기다렸다 다시 누른다(미리보기에서만). 마지막 응답을 돌려준다
export async function clickWithRateLimitRetry(
  page: import("@playwright/test").Page,
  click: () => Promise<void>,
  matches: (url: URL, method: string) => boolean,
  where: string,
): Promise<import("@playwright/test").Response> {
  for (;;) {
    const responded = page.waitForResponse((r) => matches(new URL(r.url()), r.request().method()));
    await click();
    const res = await responded;
    const body = res.status() === 429 ? await res.json().catch(() => null) : null;
    const waited = await waitForRateLimit(
      res.status(),
      body?.code,
      await res.headerValue("retry-after"),
      where,
    );
    if (!waited) return res;
  }
}
