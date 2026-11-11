// e2e DB에 커밋된 마이그레이션만 적용한다(npm run test:e2e:migrate). test:e2e도 서버를 띄우기 전에 같은 단계를 실행한다
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT, loadE2eEnv } from "./e2e-env";

const env = loadE2eEnv();
const result = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
  {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL },
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
