// API_CONVENTIONS 3절 실패 응답 포맷 { code, message, details? }
export type ApiErrorCode = "INVALID_ORIGIN" | "LINK_NOT_FOUND" | "LINK_EXPIRED" | "INTERNAL_ERROR";

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(details ? { code, message, details } : { code, message }, { status });
}

export function invalidOrigin(): Response {
  return apiError(403, "INVALID_ORIGIN", "허용되지 않은 요청 출처입니다.");
}

export function linkNotFound(): Response {
  return apiError(404, "LINK_NOT_FOUND", "유효하지 않은 링크입니다.");
}

export function linkExpired(): Response {
  return apiError(410, "LINK_EXPIRED", "만료된 링크입니다.");
}

export function internalError(): Response {
  return apiError(500, "INTERNAL_ERROR", "처리 중 오류가 발생했습니다.");
}
