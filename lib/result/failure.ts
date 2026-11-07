// 마감(STATE-API-04)·확정(STATE-API-05)·후보 조회(STATE-API-10) 실패 분기 (018). 브라우저에서도 import하는 순수 함수다
// HTTP 상태가 아니라 에러 코드로 분기한다 (CLAUDE.md 4절). 같은 403이라도 FORBIDDEN과 INVALID_ORIGIN은 다르다

export type Failure = { status: number; code: string | null }; // status 0이면 네트워크 오류

export type RoomAction =
  // 약속 상태가 바뀌었다(이미 마감·확정, 재조율 등). 상태 조회를 다시 해 그 상태의 화면으로 간다
  | { kind: "refetch_status" }
  // 방장 권한이 없다(승계 등). /me를 다시 조회해 버튼을 맞춘다
  | { kind: "refetch_me" }
  // 확정하려던 후보가 무효가 됐다. 안내 후 후보를 처음부터 다시 조회한다
  | { kind: "refetch_candidates"; notice: string }
  // 세션·약속이 화면과 맞지 않는다. 링크를 다시 조회한다(011 흐름)
  | { kind: "relink" }
  // 네트워크·서버 일시 오류: 화면을 유지하고 다시 시도 안내
  | { kind: "retry"; message: string };

export const CANDIDATE_CHANGED_NOTICE = "후보가 바뀌었어요. 최신 후보를 다시 불러왔어요.";
export const CLOSE_RETRY_MESSAGE = "마감하지 못했어요. 잠시 후 다시 시도해 주세요.";
export const CONFIRM_RETRY_MESSAGE = "확정하지 못했어요. 잠시 후 다시 시도해 주세요.";
export const CANDIDATES_RETRY_MESSAGE = "후보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";

// cancelled·401·없는 약속·형식 오류·draft 관련 코드. 화면이 보낸 promiseId·본문은 항상 형식이 맞다
const RELINK_CODES = new Set([
  "UNAUTHENTICATED",
  "PROMISE_CANCELLED",
  "PROMISE_NOT_FOUND",
  "PROMISE_NOT_OPEN",
  "DRAFT_EXPIRED",
  "INVALID_REQUEST",
]);

// 방장 전용 쓰기(마감·확정)의 공통 분기
function hostWrite(failure: Failure, retryMessage: string): RoomAction {
  if (failure.code === "INVALID_PROMISE_STATE") return { kind: "refetch_status" };
  // 다른 약속 세션도 FORBIDDEN이지만 /me가 401·403이면 그때 링크를 다시 조회한다
  if (failure.code === "FORBIDDEN") return { kind: "refetch_me" };
  if (failure.code && RELINK_CODES.has(failure.code)) return { kind: "relink" };
  // INVALID_ORIGIN·INTERNAL_ERROR·네트워크 오류(응답 유실 포함)·알 수 없는 코드
  return { kind: "retry", message: retryMessage };
}

// STATE-API-04 방장 마감. 200은 호출자가 후보 화면으로 바꾼다
export function classifyCloseFailure(failure: Failure): RoomAction {
  return hostWrite(failure, CLOSE_RETRY_MESSAGE);
}

// STATE-API-05 최종 일정 확정
// 응답이 유실돼 다시 누르면 이미 confirmed라 409 INVALID_PROMISE_STATE → 상태 조회로 결과 화면에 도착한다
export function classifyConfirmFailure(failure: Failure): RoomAction {
  // VALIDATION_FAILED: 화면은 후보 조회가 준 startAt을 그대로 보내므로 후보 목록이 낡은 경우로 본다
  if (failure.code === "INVALID_CONFIRMATION_CANDIDATE" || failure.code === "VALIDATION_FAILED") {
    return { kind: "refetch_candidates", notice: CANDIDATE_CHANGED_NOTICE };
  }
  return hostWrite(failure, CONFIRM_RETRY_MESSAGE);
}

// STATE-API-10 후보 조회. 이 약속의 active 참여자면 누구나 조회하므로 FORBIDDEN은 다른 약속 세션이다
export function classifyCandidatesFailure(failure: Failure): RoomAction {
  if (failure.code === "INVALID_PROMISE_STATE") return { kind: "refetch_status" };
  if (failure.code === "FORBIDDEN") return { kind: "relink" };
  if (failure.code && RELINK_CODES.has(failure.code)) return { kind: "relink" };
  return { kind: "retry", message: CANDIDATES_RETRY_MESSAGE };
}
