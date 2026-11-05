// 설정 완료(STATE-API-02) 실패 응답을 화면 동작으로 바꾼다. 상태 코드가 아니라 에러 코드(API_CONVENTIONS 3절)로 분기한다
// 저장소(설정 진행 정보)를 지우는 것은 "방장 세션이 없거나 더 이상 설정할 수 없는 상태"뿐이다.
// 그 밖(INVALID_ORIGIN·INVALID_REQUEST·422·5xx·네트워크·알 수 없는 코드)은 저장소를 유지하고 다시 시도하게 한다

export type SetupField =
  "participantLimit" | "dateRange" | "dailyTimeRange" | "durationMinutes" | "votingDeadlineAt";

export const SETUP_FIELDS: readonly SetupField[] = [
  "participantLimit",
  "dateRange",
  "dailyTimeRange",
  "durationMinutes",
  "votingDeadlineAt",
];

export const DRAFT_EXPIRED_NOTICE = "설정 시간이 지났어요. 처음부터 다시 만들어 주세요";
export const SETUP_LOST_NOTICE = "설정을 이어갈 수 없어요. 링크 상태를 다시 확인했어요.";
export const RETRY_MESSAGE = "잠시 후 다시 시도해 주세요";
export const CHECK_INPUT_MESSAGE = "입력값을 다시 확인해 주세요.";

export type StartFailure = {
  code: string | null;
  field: string | null;
  message: string | null;
};

export type StartFailureAction =
  // 저장소를 지우고 링크를 다시 조회한다
  | { kind: "reset"; notice: string }
  // 해당 입력란에 오류를 표시한다 (저장소 유지)
  | { kind: "field"; field: SetupField; message: string }
  // 화면에 오류만 띄우고 다시 시도하게 한다 (저장소 유지)
  | { kind: "retry"; message: string };

// 방장 세션이 없거나(401·403 FORBIDDEN) 약속이 없거나 취소됐거나 이미 draft가 아님(설정 완료 재요청 포함)
const SETUP_LOST_CODES = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "PROMISE_NOT_FOUND",
  "PROMISE_CANCELLED",
  "INVALID_PROMISE_STATE",
]);

function isSetupField(field: string | null): field is SetupField {
  return field !== null && (SETUP_FIELDS as readonly string[]).includes(field);
}

export function classifyStartFailure(failure: StartFailure): StartFailureAction {
  const { code } = failure;
  if (code === "DRAFT_EXPIRED") return { kind: "reset", notice: DRAFT_EXPIRED_NOTICE };
  if (code !== null && SETUP_LOST_CODES.has(code)) {
    return { kind: "reset", notice: SETUP_LOST_NOTICE };
  }
  if (code === "VALIDATION_FAILED") {
    return isSetupField(failure.field)
      ? { kind: "field", field: failure.field, message: failure.message ?? CHECK_INPUT_MESSAGE }
      : { kind: "retry", message: failure.message ?? CHECK_INPUT_MESSAGE };
  }
  if (code === "INVALID_REQUEST") return { kind: "retry", message: CHECK_INPUT_MESSAGE };
  // INVALID_ORIGIN·INTERNAL_ERROR·네트워크 오류(code 없음)·알 수 없는 코드
  return { kind: "retry", message: RETRY_MESSAGE };
}
