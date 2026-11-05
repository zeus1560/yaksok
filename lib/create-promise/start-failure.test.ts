import { describe, expect, it } from "vitest";
import {
  CHECK_INPUT_MESSAGE,
  DRAFT_EXPIRED_NOTICE,
  RETRY_MESSAGE,
  SETUP_LOST_NOTICE,
  classifyStartFailure,
} from "@/lib/create-promise/start-failure";

const fail = (code: string | null, field: string | null = null, message: string | null = null) =>
  classifyStartFailure({ code, field, message });

describe("설정 완료 실패 분기 — 저장소를 지우고 재조회", () => {
  it("410 DRAFT_EXPIRED는 만료 안내", () => {
    expect(fail("DRAFT_EXPIRED")).toEqual({ kind: "reset", notice: DRAFT_EXPIRED_NOTICE });
  });

  it.each([
    "UNAUTHENTICATED", // 401 방장 세션 없음·만료
    "FORBIDDEN", // 403 다른 약속 세션·방장 아님
    "PROMISE_NOT_FOUND", // 404
    "PROMISE_CANCELLED", // 409
    "INVALID_PROMISE_STATE", // 409 이미 collecting 등
  ])("%s는 더 이상 설정할 수 없는 상태", (code) => {
    expect(fail(code)).toEqual({ kind: "reset", notice: SETUP_LOST_NOTICE });
  });
});

describe("설정 완료 실패 분기 — 저장소 유지", () => {
  it("403 INVALID_ORIGIN은 세션 문제가 아니므로 다시 시도", () => {
    expect(fail("INVALID_ORIGIN")).toEqual({ kind: "retry", message: RETRY_MESSAGE });
  });

  it("422 VALIDATION_FAILED는 details.field 입력란에 서버 메시지", () => {
    expect(
      fail("VALIDATION_FAILED", "votingDeadlineAt", "응답 마감은 현재보다 이후여야 합니다."),
    ).toEqual({
      kind: "field",
      field: "votingDeadlineAt",
      message: "응답 마감은 현재보다 이후여야 합니다.",
    });
    expect(fail("VALIDATION_FAILED", "dateRange")).toEqual({
      kind: "field",
      field: "dateRange",
      message: CHECK_INPUT_MESSAGE,
    });
  });

  it("422인데 알 수 없는 field면 화면 오류만", () => {
    expect(fail("VALIDATION_FAILED", "name", "x")).toEqual({ kind: "retry", message: "x" });
    expect(fail("VALIDATION_FAILED")).toEqual({ kind: "retry", message: CHECK_INPUT_MESSAGE });
  });

  it("400 INVALID_REQUEST는 입력 확인 안내", () => {
    expect(fail("INVALID_REQUEST")).toEqual({ kind: "retry", message: CHECK_INPUT_MESSAGE });
  });

  it("5xx·네트워크 오류·알 수 없는 코드는 다시 시도", () => {
    expect(fail("INTERNAL_ERROR")).toEqual({ kind: "retry", message: RETRY_MESSAGE });
    expect(fail(null)).toEqual({ kind: "retry", message: RETRY_MESSAGE });
    expect(fail("SOMETHING_NEW")).toEqual({ kind: "retry", message: RETRY_MESSAGE });
  });
});
