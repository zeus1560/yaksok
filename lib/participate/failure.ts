// 참여 경로(MEMBER-API-03 등록, MEMBER-API-04 로그인) 실패 분기. 브라우저에서도 import하는 순수 함수다
// HTTP 상태가 아니라 에러 코드로 분기한다 (CLAUDE.md 4절, 009 start-failure와 같은 방식)

export type Failure = {
  status: number; // 0이면 네트워크 오류
  code: string | null;
  message: string | null;
  field: string | null;
};

export type AuthField = "nickname" | "pin";

// 안내 화면으로 바꾸는 종료 사유. 문구는 notices에 있다
export type BlockedReason =
  | "full"
  | "deadline_passed"
  | "access_period_expired"
  | "participant_cancelled";

export type FailureAction =
  // 입력란 오류
  | { kind: "field"; field: AuthField; message: string }
  // 폼 아래 오류(재시도 가능)
  | { kind: "form"; message: string }
  // 등록: 같은 값으로 로그인 1회 판별 (API_CONVENTIONS 6절)
  | { kind: "nickname_taken" }
  // 약속 상태가 바뀌었다. 링크를 다시 조회해 그 결과 화면으로 간다
  | { kind: "reload" }
  // 더 진행할 수 없는 안내 화면
  | { kind: "blocked"; reason: BlockedReason };

export const RETRY_MESSAGE = "잠시 후 다시 시도해 주세요.";
export const INVALID_CREDENTIALS_MESSAGE = "닉네임 또는 PIN이 맞지 않아요.";
export const NICKNAME_TAKEN_MESSAGE =
  "이미 사용 중인 닉네임입니다. 본인이라면 PIN을 확인해 로그인하고, 아니라면 다른 닉네임을 써 주세요.";

export const BLOCKED_NOTICES: Record<BlockedReason, { title: string; body: string }> = {
  full: {
    title: "참여 정원이 모두 찼어요",
    body: "이 약속에는 더 참여할 수 없어요. 방장에게 문의해 주세요.",
  },
  deadline_passed: {
    title: "응답 마감이 지났어요",
    body: "마감 뒤에는 새로 참여할 수 없어요. 이미 참여했다면 로그인해 주세요.",
  },
  access_period_expired: {
    title: "참여 기간이 끝난 약속이에요",
    body: "이 약속은 더 이상 열어 볼 수 없어요.",
  },
  participant_cancelled: {
    title: "참여가 끝난 닉네임이에요",
    body: "탈퇴했거나 내보내진 참여자는 이 약속에 다시 참여할 수 없어요.",
  },
};

function fieldOf(failure: Failure): AuthField | null {
  return failure.field === "nickname" || failure.field === "pin" ? failure.field : null;
}

// 공통: 입력 검증, Origin·서버·네트워크 오류
function common(failure: Failure): FailureAction {
  if (failure.code === "VALIDATION_FAILED") {
    const field = fieldOf(failure);
    if (field) return { kind: "field", field, message: failure.message ?? "입력값을 확인해 주세요." };
    return { kind: "form", message: "입력값을 확인해 주세요." };
  }
  if (failure.code === "INVALID_REQUEST") return { kind: "form", message: "입력값을 확인해 주세요." };
  // INVALID_ORIGIN·INTERNAL_ERROR·네트워크 오류·알 수 없는 코드
  return { kind: "form", message: RETRY_MESSAGE };
}

// 상태가 바뀌어 지금 화면이 맞지 않는 경우. 링크 조회가 다음 화면(대기·마감·취소·잘못된 링크)을 정한다
const RELOAD_CODES = new Set([
  "PROMISE_NOT_FOUND",
  "PROMISE_CANCELLED",
  "PROMISE_NOT_OPEN",
  "INVALID_PROMISE_STATE",
  "DRAFT_EXPIRED",
]);

// MEMBER-API-03 참여자 등록
export function classifyRegisterFailure(failure: Failure): FailureAction {
  switch (failure.code) {
    case "NICKNAME_TAKEN":
      return { kind: "nickname_taken" };
    case "PROMISE_FULL":
      return { kind: "blocked", reason: "full" };
    case "DEADLINE_PASSED":
      return { kind: "blocked", reason: "deadline_passed" };
    // 이 브라우저에 이미 유효한 세션이 있다. 다시 조회하면 /me로 도착 화면이 열린다
    case "ALREADY_PARTICIPANT":
      return { kind: "reload" };
  }
  if (failure.code && RELOAD_CODES.has(failure.code)) return { kind: "reload" };
  return common(failure);
}

// MEMBER-API-04 로그인
export function classifyLoginFailure(failure: Failure): FailureAction {
  switch (failure.code) {
    // 닉네임 없음과 PIN 불일치를 구분하지 않는다 (API_CONVENTIONS 7절)
    case "INVALID_CREDENTIALS":
      return { kind: "form", message: INVALID_CREDENTIALS_MESSAGE };
    case "PARTICIPANT_CANCELLED":
      return { kind: "blocked", reason: "participant_cancelled" };
    case "ACCESS_PERIOD_EXPIRED":
      return { kind: "blocked", reason: "access_period_expired" };
  }
  if (failure.code && RELOAD_CODES.has(failure.code)) return { kind: "reload" };
  return common(failure);
}

// 등록 409 NICKNAME_TAKEN 뒤 같은 값으로 한 로그인의 결과
// 200은 응답 유실 복구(호출자가 처리), 401은 남이 쓰는 닉네임이거나 PIN이 다르다
export type NicknameTakenAction =
  | { kind: "taken"; message: string } // 안내 + 닉네임을 채운 로그인 화면으로 전환 가능
  | FailureAction;

export function resolveNicknameTaken(loginFailure: Failure): NicknameTakenAction {
  if (loginFailure.code === "INVALID_CREDENTIALS") {
    return { kind: "taken", message: NICKNAME_TAKEN_MESSAGE };
  }
  // PARTICIPANT_CANCELLED: 같은 닉네임·PIN이 맞은 탈퇴자 본인이다. 재참여가 허용되지 않으므로(MEMBER-11-01·02)
  // 다른 닉네임을 권하지 않고 안내 화면으로 보낸다. 나머지는 로그인 실패 분기와 같다
  return classifyLoginFailure(loginFailure);
}
