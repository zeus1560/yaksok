// API_CONVENTIONS 3절 실패 응답 포맷 { code, message, details? }
export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ORIGIN"
  | "LINK_NOT_FOUND"
  | "HOST_ALREADY_REGISTERED"
  | "LINK_EXPIRED"
  | "INVALID_CREDENTIALS"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PARTICIPANT_CANCELLED"
  | "PROMISE_NOT_FOUND"
  | "PROMISE_CANCELLED"
  | "INVALID_PROMISE_STATE"
  | "ACCESS_PERIOD_EXPIRED"
  | "DRAFT_EXPIRED"
  | "PROMISE_NOT_OPEN"
  | "DEADLINE_PASSED"
  | "PROMISE_FULL"
  | "NICKNAME_TAKEN"
  | "ALREADY_PARTICIPANT"
  | "VALIDATION_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "VOTING_CLOSED"
  | "AVAILABILITY_VERSION_CONFLICT"
  | "INVALID_SLOT_FORMAT"
  | "SLOT_LIMIT_EXCEEDED"
  | "INVALID_CONFIRMATION_CANDIDATE"
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

// 닉네임 없음과 PIN 불일치를 구분하지 않는다 (API_CONVENTIONS 7절)
export function invalidCredentials(): Response {
  return apiError(401, "INVALID_CREDENTIALS", "닉네임 또는 PIN이 올바르지 않습니다.");
}

export function participantCancelled(): Response {
  return apiError(403, "PARTICIPANT_CANCELLED", "참여가 종료된 계정입니다.");
}

export function promiseNotFound(): Response {
  return apiError(404, "PROMISE_NOT_FOUND", "약속을 찾을 수 없습니다.");
}

export function promiseCancelled(): Response {
  return apiError(409, "PROMISE_CANCELLED", "취소된 약속입니다.");
}

export function accessPeriodExpired(): Response {
  return apiError(410, "ACCESS_PERIOD_EXPIRED", "접근 기간이 지난 약속입니다.");
}

// 생성 후 10분 안에 설정을 마치지 못한 draft (STATE-02-02). 약속 기준 API의 공통 코드
export function draftExpired(): Response {
  return apiError(410, "DRAFT_EXPIRED", "설정 시간이 지나 약속이 만료되었습니다.");
}

export function unauthenticated(): Response {
  return apiError(401, "UNAUTHENTICATED", "다시 로그인해 주세요.");
}

export function forbidden(): Response {
  return apiError(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
}

export function invalidPromiseState(promiseStatus: string, allowedStates: string[]): Response {
  return apiError(409, "INVALID_PROMISE_STATE", "현재 약속 상태에서는 요청할 수 없습니다.", {
    promiseStatus,
    allowedStates,
  });
}

// MEMBER-API-03 참여자 등록
export function promiseNotOpen(): Response {
  return apiError(409, "PROMISE_NOT_OPEN", "방장이 약속을 설정 중입니다.");
}

export function deadlinePassed(): Response {
  return apiError(409, "DEADLINE_PASSED", "응답 마감이 지났습니다.");
}

export function promiseFull(): Response {
  return apiError(409, "PROMISE_FULL", "참여 정원이 모두 찼습니다.");
}

// 남이 쓰는 닉네임과 본인이 이미 등록한 경우를 구분하지 않는다. 클라이언트는 로그인으로 가린다 (API_CONVENTIONS 6절)
export function nicknameTaken(): Response {
  return apiError(
    409,
    "NICKNAME_TAKEN",
    "이미 사용 중인 닉네임입니다. 본인이 등록했다면 로그인해 주세요.",
    { field: "nickname" },
  );
}

export function alreadyParticipant(): Response {
  return apiError(409, "ALREADY_PARTICIPANT", "이 브라우저는 이미 이 약속에 참여 중입니다.");
}

export function payloadTooLarge(): Response {
  return apiError(413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
}

// TIME-API-01 가능 시간 제출. 입력 화면이 구분해 안내해야 하는 TIME 고유 코드 (DECISION_CONFLICTS R-14)
export function votingClosed(): Response {
  return apiError(409, "VOTING_CLOSED", "응답이 마감되었습니다.");
}

export function availabilityVersionConflict(details: {
  currentVersion: number;
  submitted: boolean;
  slots: string[];
}): Response {
  return apiError(
    409,
    "AVAILABILITY_VERSION_CONFLICT",
    "다른 기기에서 먼저 저장했어요. 최신 내용을 확인해 주세요.",
    details,
  );
}

export function invalidSlotFormat(): Response {
  return apiError(422, "INVALID_SLOT_FORMAT", "시간 형식이 올바르지 않습니다.");
}

export function slotLimitExceeded(): Response {
  return apiError(422, "SLOT_LIMIT_EXCEEDED", "한 번에 저장할 수 있는 시간은 5,000칸까지입니다.");
}

// STATE-API-05 최종 일정 확정. 과거 시각·경계 위반·범위 초과·공통 가능 인원 2명 미만을 구분하지 않는다
export function invalidConfirmationCandidate(): Response {
  return apiError(
    422,
    "INVALID_CONFIRMATION_CANDIDATE",
    "후보가 변경되었거나 유효하지 않습니다. 최신 후보를 확인해 주세요.",
  );
}

export function internalError(): Response {
  return apiError(500, "INTERNAL_ERROR", "처리 중 오류가 발생했습니다.");
}
