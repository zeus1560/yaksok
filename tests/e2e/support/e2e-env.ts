// 통합 테스트 실행 환경 (031·032)
// - 로컬(기본): .env.e2e의 DB(Neon e2e 브랜치)와 로컬 운영 빌드(https://localhost:3100)
// - 배포 주소(E2E_TARGET=preview): 이미 배포된 주소(E2E_BASE_URL)에 붙고, DB 도우미는 .env.preview의 DB(Neon 미리보기 브랜치)
// 테스트 DB 파일이 없거나 개발 DB(.env)와 같은 DB를 가리키면 실행을 거부한다 — 개발 DB 보호
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const ROOT = path.resolve(__dirname, "..", "..", "..");

export type E2eTarget = "local" | "preview";

export function e2eTarget(value = process.env.E2E_TARGET): E2eTarget {
  const v = value?.trim() || "local";
  if (v !== "local" && v !== "preview") {
    throw new Error(`E2E_TARGET은 local 또는 preview입니다(받은 값: ${v}).`);
  }
  return v;
}

export const TARGET = e2eTarget();
export const IS_PREVIEW = TARGET === "preview";

// 실행 기록(남은 링크·스냅샷)은 대상별로 따로 둔다 — 로컬 기록으로 미리보기 DB를 지우지 않게
export const STATE_DIR = path.join(
  ROOT,
  "tests",
  "e2e",
  ".state",
  ...(IS_PREVIEW ? ["preview"] : []),
);

// 로컬: 로컬 https 프록시(serve.ts)가 받아 내부 next start로 넘긴다
// https인 이유: 세션 쿠키가 항상 Secure라 WebKit은 http://localhost에서 쿠키를 보내지 않는다
export const E2E_PORT = 3100;
export const E2E_APP_PORT = 3101; // next start(운영 모드). 127.0.0.1에서만 연다
export const LOCAL_BASE_URL = `https://localhost:${E2E_PORT}`;

export type E2eEnv = { DATABASE_URL: string; DIRECT_URL: string };
export type PreviewEnv = E2eEnv & { BASE_URL: string; BYPASS_SECRET: string | null };

function readEnvFile(file: string): Record<string, string> {
  return parseEnv(fs.readFileSync(file, "utf8")) as Record<string, string>;
}

// 같은 DB를 다른 표기(풀러·직접 연결, 매개변수 차이)로 가리켜도 같다고 본다
function dbIdentity(url: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
  return `${host}:${u.port || "5432"}${u.pathname}`;
}

// file의 DB 주소를 읽고, refuse 파일들(개발 DB 등)과 같은 DB면 거부한다
function loadDbFile(
  root: string,
  file: string,
  guide: string,
  refuse: { file: string; label: string }[],
): { db: E2eEnv; raw: Record<string, string> } {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${file}이(가) 없어 실행하지 않습니다. ${guide}`);
  }
  const raw = readEnvFile(filePath);
  const databaseUrl = raw.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error(`${file}에 DATABASE_URL이 없습니다.`);
  const directUrl = raw.DIRECT_URL?.trim() || databaseUrl;

  for (const other of refuse) {
    const otherPath = path.join(root, other.file);
    const env = fs.existsSync(otherPath) ? readEnvFile(otherPath) : {};
    const urls = [env.DATABASE_URL, env.DIRECT_URL].map((v) => v?.trim()).filter(Boolean);
    if (urls.includes(databaseUrl)) {
      throw new Error(
        `${file}의 DATABASE_URL이 ${other.file}(${other.label})와 같아 실행을 거부합니다. ${guide}`,
      );
    }
    const ids = new Set(urls.map((v) => dbIdentity(v as string)));
    for (const url of [databaseUrl, directUrl]) {
      if (ids.has(dbIdentity(url))) {
        throw new Error(
          `${file}이(가) ${other.file}(${other.label})와 같은 DB 호스트·이름을 가리켜 실행을 거부합니다. ${guide}`,
        );
      }
    }
  }
  return { db: { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl }, raw };
}

// root는 가드 확인용(임시 폴더)으로만 바꾼다
export function loadE2eEnv(root = ROOT): E2eEnv {
  return loadDbFile(
    root,
    ".env.e2e",
    "docs/architecture/SETUP.md 4-5 「통합 테스트(e2e) DB와 실행」을 따라 Neon e2e 브랜치 주소로 만들어 주세요.",
    [{ file: ".env", label: "개발 DB" }],
  ).db;
}

// 미리보기 배포 DB: .env.preview(Neon 미리보기 브랜치). 개발 DB·e2e DB와 같으면 거부한다
function readPreviewFile(root: string) {
  return loadDbFile(
    root,
    ".env.preview",
    "docs/architecture/DEPLOY.md 1절을 따라 Neon 미리보기 브랜치 주소로 만들어 주세요.",
    [
      { file: ".env", label: "개발 DB" },
      { file: ".env.e2e", label: "e2e DB" },
    ],
  );
}

export function loadPreviewDb(root = ROOT): E2eEnv {
  return readPreviewFile(root).db;
}

// 미리보기 배포 테스트: DB + 배포 주소 + 보호 우회 비밀값
// E2E_BASE_URL·VERCEL_AUTOMATION_BYPASS_SECRET은 명령 환경변수가 .env.preview보다 우선한다
export function loadPreviewEnv(root = ROOT, env: NodeJS.ProcessEnv = process.env): PreviewEnv {
  const { db, raw } = readPreviewFile(root);
  const base = (env.E2E_BASE_URL?.trim() || raw.E2E_BASE_URL?.trim() || "").replace(/\/+$/, "");
  let u: URL | null = null;
  try {
    u = base ? new URL(base) : null;
  } catch {}
  if (!u || u.protocol !== "https:" || u.pathname !== "/" || u.search) {
    throw new Error(
      `E2E_BASE_URL에 배포 주소(https://….vercel.app, 경로 없이)를 넣어 주세요(받은 값: ${base || "없음"}).`,
    );
  }
  const bypass =
    env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ||
    raw.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ||
    null;
  return { ...db, BASE_URL: u.origin, BYPASS_SECRET: bypass };
}

// 이번 실행이 쓰는 DB(DB 도우미·정리·스냅샷)
export function loadTargetDb(): E2eEnv {
  return IS_PREVIEW ? loadPreviewEnv() : loadE2eEnv();
}

// 브라우저와 테스트가 여는 주소
export const E2E_BASE_URL = IS_PREVIEW ? loadPreviewEnv().BASE_URL : LOCAL_BASE_URL;
export const E2E_HOST = new URL(E2E_BASE_URL).hostname;

// Vercel Deployment Protection 우회(Protection Bypass for Automation). 미리보기에서만 보낸다
export function bypassHeaders(): Record<string, string> {
  const secret = IS_PREVIEW ? loadPreviewEnv().BYPASS_SECRET : null;
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

// IP 기준 레이트 리밋·PIN 시도 제한(035, R-41)
// 로컬 서버는 x-forwarded-for 첫 값을 접속 IP로 본다(Vercel에서는 Vercel이 덮어쓰는 헤더). 통합 테스트는 요청(API 도우미)과
// 브라우저 컨텍스트마다 시험용 대역(198.18.0.0/15, RFC 2544)의 다른 IP를 보내, 한 PC에서 몰아 보내는 요청이 운영 기준에
// 걸리지 않게 한다 — 운영 기준을 바꾸지 않는다. 배포 주소(미리보기)에서는 Vercel이 이 값을 버리므로 효과가 없다
export const TEST_IP_PREFIXES = ["198.18.", "198.19."];
export function testIp(): string {
  const r = (n: number) => Math.floor(Math.random() * n);
  return `198.${18 + r(2)}.${r(256)}.${r(254) + 1}`;
}
