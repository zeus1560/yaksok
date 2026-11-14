// 배포 주소 확인 묶음 실행 (032): npm run test:e2e:preview [-- --project=chromium-desktop ...]
// E2E_TARGET=preview를 붙여 Playwright를 실행한다(Windows PowerShell에서도 같은 명령으로 쓰려고 따로 둔다)
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const result = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules", "@playwright", "test", "cli.js"),
    "test",
    ...process.argv.slice(2),
  ],
  { cwd: ROOT, env: { ...process.env, E2E_TARGET: "preview" }, stdio: "inherit" },
);
process.exit(result.status ?? 1);
