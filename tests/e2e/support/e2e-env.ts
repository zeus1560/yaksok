// 통합 테스트 실행 환경 (031). 테스트는 .env.e2e의 DB(Neon e2e 브랜치)만 쓴다
// .env.e2e가 없거나 개발 DB(.env)와 같은 DB를 가리키면 실행을 거부한다 — 개발 DB 보호
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const ROOT = path.resolve(__dirname, "..", "..", "..");
export const STATE_DIR = path.join(ROOT, "tests", "e2e", ".state");

// 브라우저와 테스트가 여는 주소. 로컬 https 프록시(serve.ts)가 받아 내부 next start로 넘긴다
// https인 이유: 세션 쿠키가 항상 Secure라 WebKit은 http://localhost에서 쿠키를 보내지 않는다
export const E2E_PORT = 3100;
export const E2E_APP_PORT = 3101; // next start(운영 모드). 127.0.0.1에서만 연다
export const E2E_BASE_URL = `https://localhost:${E2E_PORT}`;

export type E2eEnv = { DATABASE_URL: string; DIRECT_URL: string };

function readEnvFile(file: string): Record<string, string> {
  return parseEnv(fs.readFileSync(file, "utf8")) as Record<string, string>;
}

// 같은 DB를 다른 표기(풀러·직접 연결, 매개변수 차이)로 가리켜도 같다고 본다
function dbIdentity(url: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
  return `${host}:${u.port || "5432"}${u.pathname}`;
}

// root는 가드 확인용(임시 폴더)으로만 바꾼다
export function loadE2eEnv(root = ROOT): E2eEnv {
  const e2ePath = path.join(root, ".env.e2e");
  if (!fs.existsSync(e2ePath)) {
    throw new Error(
      ".env.e2e가 없어 통합 테스트를 실행하지 않습니다. docs/architecture/SETUP.md 4-5 「통합 테스트(e2e) DB와 실행」을 따라 Neon e2e 브랜치 주소로 만들어 주세요.",
    );
  }
  const e2e = readEnvFile(e2ePath);
  const databaseUrl = e2e.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error(".env.e2e에 DATABASE_URL이 없습니다.");
  const directUrl = e2e.DIRECT_URL?.trim() || databaseUrl;

  const devPath = path.join(root, ".env");
  const dev = fs.existsSync(devPath) ? readEnvFile(devPath) : {};
  const devUrls = [dev.DATABASE_URL, dev.DIRECT_URL].map((v) => v?.trim()).filter(Boolean);
  if (devUrls.includes(databaseUrl)) {
    throw new Error(
      ".env.e2e의 DATABASE_URL이 .env(개발 DB)와 같아 실행을 거부합니다. e2e 브랜치 주소를 넣어 주세요.",
    );
  }
  const devIds = new Set(devUrls.map((v) => dbIdentity(v as string)));
  for (const url of [databaseUrl, directUrl]) {
    if (devIds.has(dbIdentity(url))) {
      throw new Error(
        ".env.e2e가 .env(개발 DB)와 같은 DB 호스트·이름을 가리켜 실행을 거부합니다. e2e 브랜치 주소를 넣어 주세요.",
      );
    }
  }
  return { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl };
}
