// 실행 시작: 테스트 DB 확인 → (미리보기) 배포 주소 응답 확인 → 지난 실행이 남긴 테스트 데이터 정리 → DB 스냅샷 저장(끝에서 비교)
import fs from "node:fs";
import path from "node:path";
import { E2E_BASE_URL, IS_PREVIEW, STATE_DIR, bypassHeaders, loadTargetDb } from "./e2e-env";
import { closeDb, deleteLinks, snapshot } from "./db";
import { clearLedger, readLedger } from "./ledger";

// 배포 주소가 앱 응답을 주는지 먼저 본다. Deployment Protection에 막히면(401·403, Vercel 로그인 화면) 안내하고 멈춘다
async function checkDeployment() {
  const res = await fetch(`${E2E_BASE_URL}/api/health`, {
    headers: bypassHeaders(),
    redirect: "manual",
  });
  const body = await res.text();
  if (res.status === 200 && body.includes('"ok":true')) return;
  const protectedHint =
    res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)
      ? " Deployment Protection에 막혔을 수 있습니다. .env.preview의 VERCEL_AUTOMATION_BYPASS_SECRET을 확인해 주세요(DEPLOY.md 4절)."
      : "";
  throw new Error(
    `배포 주소 ${E2E_BASE_URL}/api/health 가 ${res.status}를 돌려줬습니다.${protectedHint}`,
  );
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
