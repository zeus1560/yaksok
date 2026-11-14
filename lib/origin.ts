import { allowedOrigins, originOf } from "@/lib/public-url";

// 상태 변경 요청의 CSRF 방어 (API_CONVENTIONS 7절). 허용 출처는 배포 환경별 목록(lib/public-url.ts, 032)이다
// — 로컬·운영은 NEXT_PUBLIC_BASE_URL, Vercel 미리보기는 그 배포의 주소. 그 밖의 Origin은 403
export function isAllowedOrigin(request: Request): boolean {
  const origin = originOf(request.headers.get("origin"));
  return origin !== null && allowedOrigins(process.env).includes(origin);
}
