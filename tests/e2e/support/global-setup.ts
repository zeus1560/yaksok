// 실행 시작: 테스트 DB 확인 → (미리보기) 배포 주소 응답 확인 → 지난 실행이 남긴 테스트 데이터 정리 → DB 스냅샷 저장(끝에서 비교)
import fs from "node:fs";
import path from "node:path";
import { E2E_BASE_URL, IS_PREVIEW, STATE_DIR, bypassHeaders, loadTargetDb } from "./e2e-env";
import { closeDb, deleteLinks, snapshot } from "./db";
import { clearLedger, readLedger } from "./ledger";

// /api/health(쿼리 1번)가 이보다 느리면 함수 지역이 DB와 먼 것으로 보고 알린다(같은 지역이면 0.1초 안팎)
const SLOW_HEALTH_MS = 300;

// x-vercel-id: 「요청을 받은 곳::함수가 돈 곳::요청 ID」(예: icn1::sin1::abcde-…). 함수가 돈 곳만 꺼낸다
function functionRegionOf(vercelId: string | null): string | null {
  const parts = vercelId?.split("::") ?? [];
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}

// 배포 주소가 앱 응답을 주는지 먼저 본다. Deployment Protection에 막히면(401·403, Vercel 로그인 화면) 안내하고 멈춘다
async function checkDeployment() {
  const health = () =>
    fetch(`${E2E_BASE_URL}/api/health`, { headers: bypassHeaders(), redirect: "manual" });
  const res = await health();
  const body = await res.text();
  if (res.status !== 200 || !body.includes('"ok":true')) {
    const protectedHint =
      res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)
        ? " Deployment Protection에 막혔을 수 있습니다. .env.preview의 VERCEL_AUTOMATION_BYPASS_SECRET을 확인해 주세요(DEPLOY.md 5절)."
        : "";
    throw new Error(
      `배포 주소 ${E2E_BASE_URL}/api/health 가 ${res.status}를 돌려줬습니다.${protectedHint}`,
    );
  }
  // 첫 요청은 함수가 깨어나는 시간이 섞인다. 두 번째 요청으로 응답 시간과 함수 지역을 본다
  const startedAt = performance.now();
  const warm = await health();
  await warm.text();
  const ms = Math.round(performance.now() - startedAt);
  const region = functionRegionOf(warm.headers.get("x-vercel-id"));
  console.log(`[e2e] 배포 응답: /api/health ${ms}ms, 함수 지역 ${region ?? "알 수 없음"}`);
  if (ms > SLOW_HEALTH_MS) {
    console.warn(
      `[e2e] ⚠ 배포 응답이 느립니다(${ms}ms). 함수 지역(${region ?? "알 수 없음"})이 DB 지역과 멀면 전체 흐름이 시간 초과로 실패할 수 있습니다. vercel.json의 regions가 DB와 같은 지역인지, 그 커밋의 배포인지 확인해 주세요(DEPLOY.md 3절 ⑤).`,
    );
  }
}

export default async function globalSetup() {
  loadTargetDb();
  if (IS_PREVIEW) await checkDeployment();
  const leftover = readLedger();
  if (leftover.length > 0) {
    const removed = await deleteLinks(leftover);
    console.log(`[e2e] 지난 실행이 남긴 테스트 링크 ${removed}개 정리 (기록 ${leftover.length}개)`);
  }
  clearLedger();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, "snapshot.json"), JSON.stringify(await snapshot()));
  await closeDb();
}
