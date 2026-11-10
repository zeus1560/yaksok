// 약속 나가기(STATE-API-08)·로그아웃(MEMBER-API-07) 실패 분기 (028). 브라우저에서도 import하는 순수 함수다
// HTTP 상태가 아니라 에러 코드로 분기한다 (CLAUDE.md 4절)

export type Failure = { status: number; code: string | null }; // status 0이면 네트워크 오류

export type LeaveAction =
  // 성공과 같다: 이 약속의 브라우저 저장값을 지우고 링크를 다시 조회한다
  | { kind: "done" }
  // 세션·약속이 화면과 맞지 않는다: 저장값은 두고 링크를 다시 조회한다
  | { kind: "relink" }
  // 네트워크·서버 일시 오류: 화면을 유지하고 다시 시도 안내
  | { kind: "retry"; message: string };

export const LEAVE_RETRY_MESSAGE = "나가지 못했어요. 잠시 후 다시 시도해 주세요.";
export const LOGOUT_RETRY_MESSAGE = "로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.";

// 나가기 요청 뒤 이 코드들은 "이미 나갔다"는 뜻이다(응답 유실 뒤 재요청)
// - 401: 일반 탈퇴·승계는 본인 세션을 즉시 만료한다
// - 409 PROMISE_CANCELLED: 혼자인 방장의 나가기는 약속 취소다(취소는 세션 인증보다 먼저 판정)
// - 404 PROMISE_NOT_FOUND: draft 방장의 나가기는 초안을 물리 삭제한다
const LEFT_CODES = new Set(["UNAUTHENTICATED", "PROMISE_CANCELLED", "PROMISE_NOT_FOUND"]);

// 화면이 이 약속에 맞지 않게 됐다(다른 약속 세션, draft 일반 참여자, 상태 변화)
const RELINK_CODES = new Set([
  "FORBIDDEN",
  "INVALID_PROMISE_STATE",
  "PROMISE_NOT_OPEN",
  "DRAFT_EXPIRED",
]);

export function classifyLeaveFailure(failure: Failure): LeaveAction {
  if (failure.code && LEFT_CODES.has(failure.code)) return { kind: "done" };
  if (failure.code && RELINK_CODES.has(failure.code)) return { kind: "relink" };
  // INVALID_ORIGIN·INVALID_REQUEST·INTERNAL_ERROR·네트워크 오류·알 수 없는 코드
  return { kind: "retry", message: LEAVE_RETRY_MESSAGE };
}

// 로그아웃은 만료·삭제된 세션도 204다(R-31). 401은 이 약속의 쿠키가 아예 없을 때 — 이미 로그아웃 상태다
export function classifyLogoutFailure(failure: Failure): LeaveAction {
  if (failure.code === "UNAUTHENTICATED") return { kind: "done" };
  if (failure.code === "FORBIDDEN" || failure.code === "PROMISE_NOT_FOUND") {
    return { kind: "relink" };
  }
  return { kind: "retry", message: LOGOUT_RETRY_MESSAGE };
}
