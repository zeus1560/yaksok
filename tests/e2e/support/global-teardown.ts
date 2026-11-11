// 실행 끝: 테스트가 지우지 못한 링크를 기록으로 지우고, DB가 시작 상태(행 수·md5)와 같은지 확인한다
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./e2e-env";
import { closeDb, deleteLinks, snapshot } from "./db";
import { clearLedger, readLedger } from "./ledger";

export default async function globalTeardown() {
  const leftover = readLedger();
  const removed = await deleteLinks(leftover);
  if (removed > 0) console.log(`[e2e] 테스트가 지우지 못한 링크 ${removed}개 정리`);
  const file = path.join(STATE_DIR, "snapshot.json");
  const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const after = await snapshot();
  await closeDb();
  if (before && JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      `e2e DB가 시작 상태와 다릅니다(테스트 데이터가 남음):\n${JSON.stringify({ before, after }, null, 2)}`,
    );
  }
  clearLedger();
  console.log("[e2e] DB 스냅샷(모든 테이블 행 수·md5) 시작 상태와 동일");
}
