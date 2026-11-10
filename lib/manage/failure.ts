// 방장 관리(027) 실패 분기 — 설정 변경(STATE-API-03)·재조율(STATE-API-06)·취소(STATE-API-07)·
// 명단 조회(MEMBER-API-06)·내보내기(MEMBER-API-08). 브라우저에서도 import하는 순수 함수다
// HTTP 상태가 아니라 에러 코드로 분기한다 (CLAUDE.md 4절)

import type { StartSettingsField } from "@/lib/state/start-settings";

export type Failure = {
  status: number; // 0이면 네트워크 오류
  code: string | null;
  field?: string | null; // details.field
  message?: string | null;
};

export type ManageAction =
  // 성공과 같다(취소 409 PROMISE_CANCELLED — 응답 유실 뒤 재요청, R-25). 링크 재조회로 취소 안내에 간다
  | { kind: "done" }
  // 입력란에 안내. refetch가 있으면 그 값도 다시 조회한다(다른 기기·참여자 변화로 현재 값이 낡았을 수 있음)
  | { kind: "field"; field: StartSettingsField; message: string; refetch?: "status" | "list" }
  // 약속 상태가 바뀌었다. 안내 후 상태(와 명단)를 다시 조회한다
  | { kind: "refetch"; notice: string }
  // 방장 권한이 없다(승계 등). /me를 다시 조회해 버튼을 맞춘다
  | { kind: "refetch_me" }
  // 세션·약속이 화면과 맞지 않는다. 링크를 다시 조회한다(011 흐름)
  | { kind: "relink" }
  // 네트워크·서버 일시 오류: 화면을 유지하고 다시 시도 안내
  | { kind: "retry"; message: string };

export const STATE_CHANGED_NOTICE =
  "약속 상태가 바뀌어 처리하지 못했어요. 최신 상태로 다시 불러왔어요.";
export const SETTINGS_RETRY_MESSAGE = "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
export const REOPEN_RETRY_MESSAGE = "다시 열지 못했어요. 잠시 후 다시 시도해 주세요.";
export const CANCEL_RETRY_MESSAGE = "취소하지 못했어요. 잠시 후 다시 시도해 주세요.";
export const REMOVE_RETRY_MESSAGE = "내보내지 못했어요. 잠시 후 다시 시도해 주세요.";
export const LIST_RETRY_MESSAGE = "명단을 불러오지 못했어요.";
export const CHECK_INPUT_MESSAGE = "입력값을 다시 확인해 주세요.";

export const CAPACITY_DECREASE_MESSAGE = "모집 중에는 정원을 줄일 수 없어요.";
export const DEADLINE_SHORTEN_MESSAGE = "모집 중에는 응답 마감을 앞당길 수 없어요.";
export const CAPACITY_BELOW_ACTIVE_MESSAGE = "정원은 현재 참여 인원보다 적을 수 없어요.";

export const REMOVE_SELF_NOTICE = "본인은 내보낼 수 없어요.";
export const REMOVE_DEADLINE_NOTICE = "응답이 마감되어 내보낼 수 없어요.";
export const REMOVE_STATE_NOTICE = "모집 중일 때만 내보낼 수 있어요.";
export const REMOVE_NOT_FOUND_NOTICE = "이미 나간 참여자예요.";

// 화면이 보낸 promiseId·본문은 형식이 맞으므로 아래는 세션·약속이 화면과 맞지 않는 경우다
const RELINK_CODES = new Set([
  "UNAUTHENTICATED",
  "PROMISE_CANCELLED",
  "PROMISE_NOT_FOUND",
  "PROMISE_NOT_OPEN",
  "DRAFT_EXPIRED",
]);

const SETTINGS_FIELDS: readonly string[] = [
  "participantLimit",
  "dateRange",
  "dailyTimeRange",
  "durationMinutes",
  "votingDeadlineAt",
];

function isSettingsField(field: string | null | undefined): field is StartSettingsField {
  return typeof field === "string" && SETTINGS_FIELDS.includes(field);
}

// 방장 전용 쓰기의 공통 분기
function hostWrite(failure: Failure, retryMessage: string): ManageAction {
  if (failure.code === "INVALID_PROMISE_STATE")
    return { kind: "refetch", notice: STATE_CHANGED_NOTICE };
  if (failure.code === "FORBIDDEN") return { kind: "refetch_me" };
  if (failure.code && RELINK_CODES.has(failure.code)) return { kind: "relink" };
  // INVALID_ORIGIN·INTERNAL_ERROR·네트워크 오류(응답 유실 포함)·알 수 없는 코드
  return { kind: "retry", message: retryMessage };
}

// 설정 폼 공통: 422 VALIDATION_FAILED는 입력란, INVALID_REQUEST는 입력 확인
function settingsWrite(failure: Failure, retryMessage: string): ManageAction {
  if (failure.code === "VALIDATION_FAILED") {
    const message = failure.message ?? CHECK_INPUT_MESSAGE;
    return isSettingsField(failure.field)
      ? { kind: "field", field: failure.field, message }
      : { kind: "retry", message };
  }
  if (failure.code === "INVALID_REQUEST") return { kind: "retry", message: CHECK_INPUT_MESSAGE };
  return hostWrite(failure, retryMessage);
}

// STATE-API-03 모집 중 설정 변경
// 정원 감소·마감 단축은 화면이 막지만, 다른 기기에서 먼저 바꿨으면 서버가 422로 막는다 → 현재 값을 다시 조회
export function classifySettingsFailure(failure: Failure): ManageAction {
  switch (failure.code) {
    case "CAPACITY_DECREASE_NOT_ALLOWED":
      return {
        kind: "field",
        field: "participantLimit",
        message: CAPACITY_DECREASE_MESSAGE,
        refetch: "status",
      };
    case "DEADLINE_SHORTEN_NOT_ALLOWED":
      return {
        kind: "field",
        field: "votingDeadlineAt",
        message: DEADLINE_SHORTEN_MESSAGE,
        refetch: "status",
      };
    case "CAPACITY_BELOW_ACTIVE_COUNT":
      return {
        kind: "field",
        field: "participantLimit",
        message: CAPACITY_BELOW_ACTIVE_MESSAGE,
        refetch: "list",
      };
  }
  return settingsWrite(failure, SETTINGS_RETRY_MESSAGE);
}

// STATE-API-06 재조율 시작. 응답 유실 뒤 다시 누르면 이미 collecting이라 409 → 상태 조회로 시간 입력 화면
export function classifyReopenFailure(failure: Failure): ManageAction {
  if (failure.code === "CAPACITY_BELOW_ACTIVE_COUNT") {
    return {
      kind: "field",
      field: "participantLimit",
      message: CAPACITY_BELOW_ACTIVE_MESSAGE,
      refetch: "list",
    };
  }
  return settingsWrite(failure, REOPEN_RETRY_MESSAGE);
}

// STATE-API-07 약속 취소. 이미 취소됐으면(응답 유실 뒤 재요청 포함) 성공과 같다 (R-25)
export function classifyCancelFailure(failure: Failure): ManageAction {
  if (failure.code === "PROMISE_CANCELLED") return { kind: "done" };
  return hostWrite(failure, CANCEL_RETRY_MESSAGE);
}

// MEMBER-API-08 참여자 내보내기. 200(이미 내보낸 대상 포함)은 호출자가 명단을 다시 조회한다
// 상태·대상이 화면과 달라진 경우는 안내 후 명단·상태를 다시 조회한다
export function classifyRemoveFailure(failure: Failure): ManageAction {
  switch (failure.code) {
    case "CANNOT_REMOVE_SELF":
      return { kind: "refetch", notice: REMOVE_SELF_NOTICE };
    case "DEADLINE_PASSED":
      return { kind: "refetch", notice: REMOVE_DEADLINE_NOTICE };
    case "INVALID_PROMISE_STATE":
      return { kind: "refetch", notice: REMOVE_STATE_NOTICE };
    case "PARTICIPANT_NOT_FOUND":
      return { kind: "refetch", notice: REMOVE_NOT_FOUND_NOTICE };
  }
  return hostWrite(failure, REMOVE_RETRY_MESSAGE);
}

// MEMBER-API-06 명단 조회. 이 약속의 active 참여자면 누구나 조회하므로 FORBIDDEN은 다른 약속 세션·draft다
export function classifyListFailure(failure: Failure): ManageAction {
  if (failure.code === "FORBIDDEN" || failure.code === "INVALID_REQUEST") return { kind: "relink" };
  if (failure.code && RELINK_CODES.has(failure.code)) return { kind: "relink" };
  return { kind: "retry", message: LIST_RETRY_MESSAGE };
}
