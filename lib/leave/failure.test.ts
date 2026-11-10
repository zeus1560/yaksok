import { describe, expect, it } from "vitest";
import {
  classifyLeaveFailure,
  classifyLogoutFailure,
  LEAVE_RETRY_MESSAGE,
  LOGOUT_RETRY_MESSAGE,
} from "./failure";

const fail = (status: number, code: string | null) => ({ status, code });

describe("classifyLeaveFailure", () => {
  it("나가기 요청 뒤 401 UNAUTHENTICATED는 성공으로 처리한다(응답 유실 뒤 재요청)", () => {
    expect(classifyLeaveFailure(fail(401, "UNAUTHENTICATED"))).toEqual({ kind: "done" });
  });

  it("혼자인 방장 재요청의 409 PROMISE_CANCELLED, draft 방장 재요청의 404 PROMISE_NOT_FOUND도 성공", () => {
    expect(classifyLeaveFailure(fail(409, "PROMISE_CANCELLED"))).toEqual({ kind: "done" });
    expect(classifyLeaveFailure(fail(404, "PROMISE_NOT_FOUND"))).toEqual({ kind: "done" });
  });

  it.each(["FORBIDDEN", "INVALID_PROMISE_STATE", "PROMISE_NOT_OPEN", "DRAFT_EXPIRED"])(
    "%s는 저장값을 두고 링크 재조회",
    (code) => {
      expect(classifyLeaveFailure(fail(409, code))).toEqual({ kind: "relink" });
    },
  );

  it("403 INVALID_ORIGIN·400·500·네트워크 오류·알 수 없는 코드는 다시 시도", () => {
    for (const failure of [
      fail(403, "INVALID_ORIGIN"),
      fail(400, "INVALID_REQUEST"),
      fail(500, "INTERNAL_ERROR"),
      fail(0, null),
      fail(418, "WHAT"),
    ]) {
      expect(classifyLeaveFailure(failure)).toEqual({
        kind: "retry",
        message: LEAVE_RETRY_MESSAGE,
      });
    }
  });
});

describe("classifyLogoutFailure", () => {
  it("401 UNAUTHENTICATED(쿠키 없음)는 이미 로그아웃 상태라 성공으로 처리한다", () => {
    expect(classifyLogoutFailure(fail(401, "UNAUTHENTICATED"))).toEqual({ kind: "done" });
  });

  it("403 FORBIDDEN(다른 약속 세션)·404 PROMISE_NOT_FOUND는 링크 재조회", () => {
    expect(classifyLogoutFailure(fail(403, "FORBIDDEN"))).toEqual({ kind: "relink" });
    expect(classifyLogoutFailure(fail(404, "PROMISE_NOT_FOUND"))).toEqual({ kind: "relink" });
  });

  it("403 INVALID_ORIGIN·400·500·네트워크 오류·알 수 없는 코드는 다시 시도", () => {
    for (const failure of [
      fail(403, "INVALID_ORIGIN"),
      fail(400, "INVALID_REQUEST"),
      fail(500, "INTERNAL_ERROR"),
      fail(0, null),
      fail(409, "PROMISE_CANCELLED"), // 로그아웃은 취소된 약속도 204라 오지 않는 코드
    ]) {
      expect(classifyLogoutFailure(failure)).toEqual({
        kind: "retry",
        message: LOGOUT_RETRY_MESSAGE,
      });
    }
  });
});
