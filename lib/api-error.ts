// API_CONVENTIONS 3절 실패 응답 포맷 { code, message, details? }
export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ORIGIN"
  | "LINK_NOT_FOUND"
  | "HOST_ALREADY_REGISTERED"
  | "LINK_EXPIRED"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(details ? { code, message, details } : { code, message }, { status });
}

export function invalidRequest(): Response {
  return apiError(400, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.");
}

export function validationFailed(field: string, message: string): Response {
  return apiError(422, "VALIDATION_FAILED", message, { field });
}

export function invalidOrigin(): Response {
  return apiError(403, "INVALID_ORIGIN", "허용되지 않은 요청 출처입니다.");
}

export function linkNotFound(): Response {
  return apiError(404, "LINK_NOT_FOUND", "유효하지 않은 링크입니다.");
}

export function hostAlreadyRegistered(): Response {
  return apiError(
    409,
    "HOST_ALREADY_REGISTERED",
    "이미 다른 분이 약속을 만들었습니다. 본인이 등록했다면 로그인해 주세요.",
  );
}

export function linkExpired(): Response {
  return apiError(410, "LINK_EXPIRED", "만료된 링크입니다.");
}

export function internalError(): Response {
  return apiError(500, "INTERNAL_ERROR", "처리 중 오류가 발생했습니다.");
}
