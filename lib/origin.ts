// 상태 변경 요청의 CSRF 방어 (API_CONVENTIONS 7절). 허용 출처는 NEXT_PUBLIC_BASE_URL의 origin 하나다.
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!origin || !baseUrl) return false;

  try {
    return new URL(origin).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
