// 테스트·미리보기 DB에 커밋된 마이그레이션만 적용한다 (prisma migrate deploy)
//   npm run test:e2e:migrate   → .env.e2e (Neon e2e 브랜치). test:e2e도 서버를 띄우기 전에 같은 단계를 실행한다
//   npm run db:deploy:preview  → .env.preview (Neon 미리보기 브랜치, 032). db:status:preview는 적용 상태만 본다
// 두 파일 모두 개발 DB(.env)와 같으면 거부한다. DATABASE_URL·DIRECT_URL을 둘 다 넘겨 prisma.config.ts가 읽는
// .env의 DIRECT_URL(개발 DB)이 끼어들지 못하게 한다
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT, loadE2eEnv, loadPreviewDb } from "./e2e-env";

const args = process.argv.slice(2);
const preview = args.includes("--preview");
const command = args.includes("--status") ? "status" : "deploy";

const env = preview ? loadPreviewDb() : loadE2eEnv();
const host = new URL(env.DIRECT_URL).hostname;
console.error(
  `[migrate] ${preview ? ".env.preview" : ".env.e2e"} → prisma migrate ${command} (${host})`,
);

const result = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", command],
  {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL },
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
