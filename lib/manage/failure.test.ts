import { describe, expect, it } from "vitest";
import {
  CANCEL_RETRY_MESSAGE,
  CAPACITY_BELOW_ACTIVE_MESSAGE,
  CAPACITY_DECREASE_MESSAGE,
  CHECK_INPUT_MESSAGE,
  classifyCancelFailure,
  classifyListFailure,
  classifyReopenFailure,
  classifyRemoveFailure,
  classifySettingsFailure,
  DEADLINE_SHORTEN_MESSAGE,
  LIST_RETRY_MESSAGE,
  REMOVE_DEADLINE_NOTICE,
  REMOVE_NOT_FOUND_NOTICE,
  REMOVE_RETRY_MESSAGE,
  REMOVE_SELF_NOTICE,
  REMOVE_STATE_NOTICE,
  REOPEN_RETRY_MESSAGE,
  SETTINGS_RETRY_MESSAGE,
  STATE_CHANGED_NOTICE,
} from "./failure";

const fail = (
  status: number,
  code: string | null,
  extra: { field?: string; message?: string } = {},
) => ({
  status,
  code,
  ...extra,
});

const RELINK = ["UNAUTHENTICATED", "PROMISE_NOT_FOUND", "PROMISE_NOT_OPEN", "DRAFT_EXPIRED"];

describe("classifyCancelFailure", () => {
  it("취소 요청 뒤 409 PROMISE_CANCELLED는 성공으로 처리한다", () => {
    expect(classifyCancelFailure({ status: 409, code: "PROMISE_CANCELLED" })).toEqual({
      kind: "done",
    });
  });

  it("409 INVALID_PROMISE_STATE는 상태 다시 조회", () => {
    expect(classifyCancelFailure(fail(409, "INVALID_PROMISE_STATE"))).toEqual({
      kind: "refetch",
      notice: STATE_CHANGED_NOTICE,
    });
  });

  it("403 FORBIDDEN은 /me 다시 조회, INVALID_ORIGIN은 다시 시도", () => {
    expect(classifyCancelFailure(fail(403, "FORBIDDEN"))).toEqual({ kind: "refetch_me" });
    expect(classifyCancelFailure(fail(403, "INVALID_ORIGIN"))).toEqual({
      kind: "retry",
      message: CANCEL_RETRY_MESSAGE,
    });
  });

  it.each(RELINK)("%s는 링크 재조회", (code) => {
    expect(classifyCancelFailure(fail(400, code))).toEqual({ kind: "relink" });
  });

  it("네트워크 오류(응답 유실)·500·알 수 없는 코드는 다시 시도", () => {
    for (const failure of [fail(0, null), fail(500, "INTERNAL_ERROR"), fail(418, "WHAT")]) {
      expect(classifyCancelFailure(failure)).toEqual({
        kind: "retry",
        message: CANCEL_RETRY_MESSAGE,
      });
    }
  });
});

describe("classifySettingsFailure", () => {
  it("422 VALIDATION_FAILED는 서버가 준 입력란에 서버 메시지", () => {
    expect(
      classifySettingsFailure(
        fail(422, "VALIDATION_FAILED", { field: "dateRange", message: "범위 오류" }),
      ),
    ).toEqual({ kind: "field", field: "dateRange", message: "범위 오류" });
  });

  it("알 수 없는 field의 VALIDATION_FAILED는 폼 오류", () => {
    expect(classifySettingsFailure(fail(422, "VALIDATION_FAILED", { field: "x" }))).toEqual({
      kind: "retry",
      message: CHECK_INPUT_MESSAGE,
    });
  });

  it("정원 감소·마감 단축 422는 해당 입력란 + 상태 다시 조회", () => {
    expect(classifySettingsFailure(fail(422, "CAPACITY_DECREASE_NOT_ALLOWED"))).toEqual({
      kind: "field",
      field: "participantLimit",
      message: CAPACITY_DECREASE_MESSAGE,
      refetch: "status",
    });
    expect(classifySettingsFailure(fail(422, "DEADLINE_SHORTEN_NOT_ALLOWED"))).toEqual({
      kind: "field",
      field: "votingDeadlineAt",
      message: DEADLINE_SHORTEN_MESSAGE,
      refetch: "status",
    });
  });

  it("CAPACITY_BELOW_ACTIVE_COUNT는 정원 입력란 + 명단 다시 조회", () => {
    expect(classifySettingsFailure(fail(422, "CAPACITY_BELOW_ACTIVE_COUNT"))).toEqual({
      kind: "field",
      field: "participantLimit",
      message: CAPACITY_BELOW_ACTIVE_MESSAGE,
      refetch: "list",
    });
  });

  it("409 INVALID_PROMISE_STATE(마감 경과 포함)는 상태 다시 조회", () => {
    expect(classifySettingsFailure(fail(409, "INVALID_PROMISE_STATE"))).toEqual({
      kind: "refetch",
      notice: STATE_CHANGED_NOTICE,
    });
  });

  it("400 INVALID_REQUEST는 입력 확인 안내(링크 재조회 아님)", () => {
    expect(classifySettingsFailure(fail(400, "INVALID_REQUEST"))).toEqual({
      kind: "retry",
      message: CHECK_INPUT_MESSAGE,
    });
  });

  it("FORBIDDEN·취소·401", () => {
    expect(classifySettingsFailure(fail(403, "FORBIDDEN"))).toEqual({ kind: "refetch_me" });
    expect(classifySettingsFailure(fail(409, "PROMISE_CANCELLED"))).toEqual({ kind: "relink" });
    expect(classifySettingsFailure(fail(401, "UNAUTHENTICATED"))).toEqual({ kind: "relink" });
  });

  it("INVALID_ORIGIN·네트워크는 다시 시도", () => {
    expect(classifySettingsFailure(fail(403, "INVALID_ORIGIN"))).toEqual({
      kind: "retry",
      message: SETTINGS_RETRY_MESSAGE,
    });
    expect(classifySettingsFailure(fail(0, null))).toEqual({
      kind: "retry",
      message: SETTINGS_RETRY_MESSAGE,
    });
  });
});

describe("classifyReopenFailure", () => {
  it("응답 유실 뒤 재요청의 409 INVALID_PROMISE_STATE는 상태 다시 조회(시간 입력 화면)", () => {
    expect(classifyReopenFailure(fail(409, "INVALID_PROMISE_STATE"))).toEqual({
      kind: "refetch",
      notice: STATE_CHANGED_NOTICE,
    });
  });

  it("CAPACITY_BELOW_ACTIVE_COUNT는 정원 입력란 + 명단 다시 조회", () => {
    expect(classifyReopenFailure(fail(422, "CAPACITY_BELOW_ACTIVE_COUNT"))).toEqual({
      kind: "field",
      field: "participantLimit",
      message: CAPACITY_BELOW_ACTIVE_MESSAGE,
      refetch: "list",
    });
  });

  it("VALIDATION_FAILED는 입력란", () => {
    expect(
      classifyReopenFailure(
        fail(422, "VALIDATION_FAILED", { field: "votingDeadlineAt", message: "m" }),
      ),
    ).toEqual({ kind: "field", field: "votingDeadlineAt", message: "m" });
  });

  it("FORBIDDEN·취소·네트워크", () => {
    expect(classifyReopenFailure(fail(403, "FORBIDDEN"))).toEqual({ kind: "refetch_me" });
    expect(classifyReopenFailure(fail(409, "PROMISE_CANCELLED"))).toEqual({ kind: "relink" });
    expect(classifyReopenFailure(fail(0, null))).toEqual({
      kind: "retry",
      message: REOPEN_RETRY_MESSAGE,
    });
  });
});

describe("classifyRemoveFailure", () => {
  it.each([
    ["CANNOT_REMOVE_SELF", 409, REMOVE_SELF_NOTICE],
    ["DEADLINE_PASSED", 409, REMOVE_DEADLINE_NOTICE],
    ["INVALID_PROMISE_STATE", 409, REMOVE_STATE_NOTICE],
    ["PARTICIPANT_NOT_FOUND", 404, REMOVE_NOT_FOUND_NOTICE],
  ])("%s는 안내 후 명단·상태 다시 조회", (code, status, notice) => {
    expect(classifyRemoveFailure(fail(status, code))).toEqual({ kind: "refetch", notice });
  });

  it("404 PROMISE_NOT_FOUND·취소·401은 링크 재조회", () => {
    for (const code of ["PROMISE_NOT_FOUND", "PROMISE_CANCELLED", "UNAUTHENTICATED"]) {
      expect(classifyRemoveFailure(fail(404, code))).toEqual({ kind: "relink" });
    }
  });

  it("FORBIDDEN은 /me 다시 조회, 네트워크는 다시 시도", () => {
    expect(classifyRemoveFailure(fail(403, "FORBIDDEN"))).toEqual({ kind: "refetch_me" });
    expect(classifyRemoveFailure(fail(0, null))).toEqual({
      kind: "retry",
      message: REMOVE_RETRY_MESSAGE,
    });
  });
});

describe("classifyListFailure", () => {
  it("FORBIDDEN(다른 약속 세션)·취소·401·404는 링크 재조회", () => {
    for (const code of [
      "FORBIDDEN",
      "PROMISE_CANCELLED",
      "UNAUTHENTICATED",
      "PROMISE_NOT_FOUND",
      "INVALID_REQUEST",
    ]) {
      expect(classifyListFailure(fail(403, code))).toEqual({ kind: "relink" });
    }
  });

  it("500·네트워크는 마지막 명단 유지(다시 시도)", () => {
    expect(classifyListFailure(fail(500, "INTERNAL_ERROR"))).toEqual({
      kind: "retry",
      message: LIST_RETRY_MESSAGE,
    });
    expect(classifyListFailure(fail(0, null))).toEqual({
      kind: "retry",
      message: LIST_RETRY_MESSAGE,
    });
  });
});
