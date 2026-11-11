// 테스트가 만든 초대 링크 기록. 만들자마자 파일에 적어 두고, 테스트가 끝나면 지운다
// 실행이 중간에 멈춰 남은 링크는 다음 실행의 globalSetup(또는 globalTeardown)이 이 기록으로 지운다
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./e2e-env";

const PREFIX = "created-links-";

export function recordLink(inviteToken: string) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(path.join(STATE_DIR, `${PREFIX}${process.pid}.txt`), `${inviteToken}\n`);
}

export function ledgerFiles(): string[] {
  if (!fs.existsSync(STATE_DIR)) return [];
  return fs
    .readdirSync(STATE_DIR)
    .filter((f) => f.startsWith(PREFIX))
    .map((f) => path.join(STATE_DIR, f));
}

export function readLedger(): string[] {
  const tokens = new Set<string>();
  for (const file of ledgerFiles()) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line.trim()) tokens.add(line.trim());
    }
  }
  return [...tokens];
}

export function clearLedger() {
  for (const file of ledgerFiles()) fs.rmSync(file, { force: true });
}
