import { parseSlotList } from "./sync";

// 가능 시간 조회(TIME-API-02)·제출(TIME-API-01) 실패 분기. 브라우저에서도 import하는 순수 함수다
// HTTP 상태가 아니라 에러 코드로 분기한다 (CLAUDE.md 4절). 코드는 실제 구현 기준(R-14)

export type Failure = {
  status: number; // 0이면 네트워크 오류
  code: string | null;
  details?: unknown;
};

// 약속 상태·세션이 바뀌어 이 화면이 맞지 않는다. 링크를 다시 조회해 그 결과 화면으로 간다(011 흐름)
const RELINK_CODES = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "PROMISE_NOT_FOUND",
  "PROMISE_CANCELLED",
  "PROMISE_NOT_OPEN",
  "DRAFT_EXPIRED",
  "INVALID_REQUEST", // promiseId 형식 오류. 화면이 보낸 본문은 항상 형식이 맞다
]);

export type PollAction =
  | { kind: "relink" }
  // 네트워크·서버 일시 오류: 마지막 화면을 유지하고 다음 폴링을 기다린다
  | { kind: "transient" };

export function classifyPollFailure(failure: Failure): PollAction {
  if (failure.code && RELINK_CODES.has(failure.code)) return { kind: "relink" };
  return { kind: "transient" };
}

export const SUBMIT_RETRY_MESSAGE = "저장하지 못했어요. 잠시 후 다시 제출해 주세요.";
export const SUBMIT_INVALID_MESSAGE =
  "선택한 시간을 저장할 수 없어요. 새로고침한 뒤 다시 선택해 주세요.";
export const SUBMIT_LIMIT_MESSAGE = "선택한 칸이 너무 많아요. 칸을 줄여서 다시 제출해 주세요.";

export type SubmitAction =
  // 409 AVAILABILITY_VERSION_CONFLICT: 다시 조회하지 않고 details로 다시 그린다
  | { kind: "conflict"; version: number; submitted: boolean; slots: number[] }
  // details 형식이 맞지 않는 충돌. 이때만 다시 조회한다
  | { kind: "refetch" }
  // 409 VOTING_CLOSED: 읽기 전용으로 바꾼다
  | { kind: "closed" }
  | { kind: "relink" }
  // 로컬 입력을 유지하고 다시 제출할 수 있다
  | { kind: "retry"; message: string };

function parseConflict(details: unknown): SubmitAction {
  if (typeof details !== "object" || details === null) return { kind: "refetch" };
  const { currentVersion, submitted, slots } = details as {
    currentVersion?: unknown;
    submitted?: unknown;
    slots?: unknown;
  };
  if (
    typeof currentVersion !== "number" ||
    !Number.isSafeInteger(currentVersion) ||
    currentVersion < 0 ||
    typeof submitted !== "boolean" ||
    !Array.isArray(slots)
  ) {
    return { kind: "refetch" };
  }
  return { kind: "conflict", version: currentVersion, submitted, slots: parseSlotList(slots) };
}

export function classifySubmitFailure(failure: Failure): SubmitAction {
  switch (failure.code) {
    case "AVAILABILITY_VERSION_CONFLICT":
      return parseConflict(failure.details);
    case "VOTING_CLOSED":
      return { kind: "closed" };
    case "SLOT_LIMIT_EXCEEDED":
    case "PAYLOAD_TOO_LARGE":
      return { kind: "retry", message: SUBMIT_LIMIT_MESSAGE };
    case "INVALID_SLOT_FORMAT":
      return { kind: "retry", message: SUBMIT_INVALID_MESSAGE };
  }
  if (failure.code && RELINK_CODES.has(failure.code)) return { kind: "relink" };
  // INVALID_ORIGIN·INTERNAL_ERROR·네트워크 오류(응답 유실 포함)·알 수 없는 코드
  // 응답이 유실됐어도 같은 요청을 다시 보내면 서버가 재시도로 판정해 200을 준다
  return { kind: "retry", message: SUBMIT_RETRY_MESSAGE };
}

// 안내 문구
export const NOTICES = {
  changedElsewhere: "다른 곳에서 내용이 바뀌었어요. 최신 내용으로 다시 그렸어요.",
  conflict:
    "다른 기기에서 먼저 저장한 내용이 있어요. 최신 내용으로 바꿨으니 확인 후 다시 제출해 주세요.",
  dropped: "범위 밖 시간은 제외하고 저장했어요.",
  submitted: "제출했어요.",
  closedUnsaved: "응답이 마감되어 제출하지 않은 입력은 저장되지 않았어요.",
} as const;
