// 실행 시작: .env.e2e 확인 → 지난 실행이 남긴 테스트 데이터 정리 → DB 스냅샷 저장(끝에서 비교)
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR, loadE2eEnv } from "./e2e-env";
import { closeDb, deleteLinks, snapshot } from "./db";
import { clearLedger, readLedger } from "./ledger";

export default async function globalSetup() {
  loadE2eEnv();
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
