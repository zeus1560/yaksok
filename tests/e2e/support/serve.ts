// 통합 테스트 서버 (Playwright webServer가 실행한다): 운영 모드(next build → next start)
// 1) .env.e2e 확인(개발 DB면 거부) 2) prisma generate 3) e2e DB에 커밋된 마이그레이션 적용(migrate deploy)
// 4) next build 5) next start(127.0.0.1:3101) 6) https://localhost:3100 로컬 https 프록시
// 세션 쿠키가 항상 Secure라 WebKit은 http://localhost로는 쿠키를 보내지 않는다. 그래서 테스트도 배포처럼 https로 연다
// E2E_SKIP_BUILD=1이면 이전 e2e 빌드를 다시 쓴다(같은 주소로 빌드한 표시가 있을 때만)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import {
  E2E_APP_PORT,
  E2E_PORT,
  LOCAL_BASE_URL as E2E_BASE_URL,
  ROOT,
  loadE2eEnv,
} from "./e2e-env";
import { createLocalhostCertificate } from "./self-signed";

const log = (message: string) => console.error(`[e2e 서버] ${message}`);

const env = loadE2eEnv();
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: env.DATABASE_URL,
  DIRECT_URL: env.DIRECT_URL,
  // 빌드에 들어가는 값(Origin 검사·초대 링크 주소). .env의 개발용 값보다 먼저 쓰인다
  NEXT_PUBLIC_BASE_URL: E2E_BASE_URL,
  NEXT_TELEMETRY_DISABLED: "1",
  PRISMA_HIDE_UPDATE_MESSAGE: "1",
};

const PRISMA = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const BUILD_MARK = path.join(ROOT, ".next", "e2e-build.json");

function run(label: string, args: string[]) {
  log(label);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    log(`${label} 실패 (exit ${result.status})`);
    process.exit(1);
  }
}

run("prisma generate", [PRISMA, "generate"]);
run("e2e DB 마이그레이션 적용 (prisma migrate deploy)", [PRISMA, "migrate", "deploy"]);

// 다시 쓰는 조건: e2e 주소로 빌드한 표시가 있고, 그 뒤 다른 빌드(npm run build)가 .next를 덮어쓰지 않았다(BUILD_ID 같음)
const BUILD_ID = path.join(ROOT, ".next", "BUILD_ID");
const readMark = () => {
  try {
    return JSON.parse(fs.readFileSync(BUILD_MARK, "utf8")) as {
      baseUrl?: string;
      buildId?: string;
    };
  } catch {
    return null;
  }
};
const currentBuildId = () =>
  fs.existsSync(BUILD_ID) ? fs.readFileSync(BUILD_ID, "utf8").trim() : null;
const mark = readMark();
const reuse =
  process.env.E2E_SKIP_BUILD === "1" &&
  mark?.baseUrl === E2E_BASE_URL &&
  mark.buildId !== undefined &&
  mark.buildId === currentBuildId();
if (reuse) {
  log("E2E_SKIP_BUILD=1 — 이전 e2e 빌드를 다시 씀");
} else {
  if (process.env.E2E_SKIP_BUILD === "1") log("다시 쓸 e2e 빌드가 없어 새로 빌드함");
  run("next build (운영 모드)", [NEXT, "build"]);
  fs.writeFileSync(
    BUILD_MARK,
    JSON.stringify({ baseUrl: E2E_BASE_URL, buildId: currentBuildId(), builtAt: new Date() }),
  );
}

log(`next start 127.0.0.1:${E2E_APP_PORT}`);
const app = spawn(
  process.execPath,
  [NEXT, "start", "-H", "127.0.0.1", "-p", String(E2E_APP_PORT)],
  {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", "ignore", "inherit"],
  },
);
app.on("exit", (code) => {
  log(`next start 종료 (exit ${code})`);
  process.exit(code ?? 1);
});
const stop = () => {
  app.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// https 프록시: 요청을 그대로 넘기고 응답 헤더(여러 Set-Cookie 포함)를 원래 순서대로 돌려준다
const { cert, key } = createLocalhostCertificate();
const handler: http.RequestListener = (req, res) => {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: E2E_APP_PORT,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, "x-forwarded-proto": "https" },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, upRes.rawHeaders);
      upRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
};
// next start가 응답하기 시작한 뒤에 프록시를 연다(준비 전 502로 Playwright 준비 확인이 흔들리지 않게)
async function waitForApp() {
  for (let i = 0; i < 600; i += 1) {
    const ok = await new Promise<boolean>((resolve) => {
      http
        .get(
          { host: "127.0.0.1", port: E2E_APP_PORT, path: "/api/health", timeout: 5000 },
          (res) => {
            res.resume();
            resolve(res.statusCode === 200);
          },
        )
        .on("error", () => resolve(false))
        .on("timeout", function (this: http.ClientRequest) {
          this.destroy();
          resolve(false);
        });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  log("next start가 5분 안에 응답하지 않음");
  process.exit(1);
}
void waitForApp().then(() => {
  for (const host of ["127.0.0.1", "::1"]) {
    https
      .createServer({ cert, key }, handler)
      .on("error", (error) => {
        // ::1이 없는 환경은 127.0.0.1만으로 충분하다
        if (host === "::1") return;
        log(`https 프록시 시작 실패: ${error.message}`);
        process.exit(1);
      })
      .listen(E2E_PORT, host, () => log(`https 프록시 ${host}:${E2E_PORT} → ${E2E_APP_PORT}`));
  }
});
