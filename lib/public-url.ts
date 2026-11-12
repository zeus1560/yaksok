// 배포 환경별 공개 주소 (032): 상태 변경 요청의 허용 Origin과 초대 링크 기준 주소
// 화면에서도 import한다 — node 전용 모듈을 쓰지 않는다
//
// - 로컬·운영: NEXT_PUBLIC_BASE_URL (운영은 Vercel 운영 도메인 VERCEL_PROJECT_PRODUCTION_URL도)
// - Vercel 미리보기(VERCEL_ENV=preview): 배포마다 바뀌는 그 배포의 주소(VERCEL_URL)와 브랜치 주소(VERCEL_BRANCH_URL)
//   Vercel 시스템 환경변수는 스킴 없는 호스트라 https를 붙인다
// - VERCEL_ENV가 없으면(로컬·CI·e2e) Vercel 주소 변수를 보지 않는다
export type PublicUrlEnv = {
  NEXT_PUBLIC_BASE_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  // process.env를 그대로 넘길 수 있게 한다
  [name: string]: string | undefined;
};

// 호스트(포트 포함 가능)만 받는다. 스킴·경로가 붙은 값은 Vercel이 넣는 형식이 아니므로 버린다
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

function hostOrigin(host: string | undefined): string | null {
  const value = host?.trim();
  if (!value || !HOST.test(value)) return null;
  return originOf(`https://${value}`);
}

export function originOf(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function previewOrigins(env: PublicUrlEnv): string[] {
  if (env.VERCEL_ENV !== "preview") return [];
  // 브랜치 주소를 먼저: PR 동안 같은 주소로 최신 배포를 가리킨다
  return unique([hostOrigin(env.VERCEL_BRANCH_URL), hostOrigin(env.VERCEL_URL)]);
}

function productionOrigin(env: PublicUrlEnv): string | null {
  return env.VERCEL_ENV === "production" ? hostOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) : null;
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}

// 상태 변경 요청의 허용 Origin 목록 (API_CONVENTIONS 7절). 그 밖의 Origin은 403 INVALID_ORIGIN
// 운영에서는 배포별 주소(VERCEL_URL)를 허용하지 않는다 — 초대 링크가 바뀌지 않는 옛 배포에 묶이지 않게
export function allowedOrigins(env: PublicUrlEnv): string[] {
  return unique([
    originOf(env.NEXT_PUBLIC_BASE_URL),
    productionOrigin(env),
    ...previewOrigins(env),
  ]);
}

// 초대 링크 기준 주소. currentOrigin: 서버는 허용 검사를 통과한 요청 Origin, 화면은 window.location.origin
// - 미리보기: 요청이 온 그 배포 주소(이 배포의 주소 목록에 있을 때. 화면처럼 목록을 모르면 그대로)
//   → 없으면 브랜치 주소 → 배포 주소. NEXT_PUBLIC_BASE_URL(운영 주소가 잘못 들어간 경우 포함)보다 우선한다
// - 그 밖: NEXT_PUBLIC_BASE_URL → 운영 도메인 → currentOrigin
// 아무 값도 없으면 null (서버는 링크를 만들지 않는다)
export function inviteBaseUrl(env: PublicUrlEnv, currentOrigin?: string | null): string | null {
  const current = originOf(currentOrigin);
  if (env.VERCEL_ENV === "preview") {
    const previews = previewOrigins(env);
    if (current && (previews.length === 0 || previews.includes(current))) return current;
    return previews[0] ?? null;
  }
  return env.NEXT_PUBLIC_BASE_URL?.trim() || productionOrigin(env) || current;
}
