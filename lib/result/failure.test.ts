import { describe, expect, it } from "vitest";
import {
  CANDIDATE_CHANGED_NOTICE,
  CANDIDATES_RETRY_MESSAGE,
  CLOSE_RETRY_MESSAGE,
  CONFIRM_RETRY_MESSAGE,
  classifyCandidatesFailure,
  classifyCloseFailure,
  classifyConfirmFailure,
} from "./failure";

const relinkCases: [number, string][] = [
  [401, "UNAUTHENTICATED"],
  [409, "PROMISE_CANCELLED"],
  [404, "PROMISE_NOT_FOUND"],
  [400, "INVALID_REQUEST"],
  [409, "PROMISE_NOT_OPEN"],
  [410, "DRAFT_EXPIRED"],
];
const transientCases: [number, string | null][] = [
  [403, "INVALID_ORIGIN"],
  [500, "INTERNAL_ERROR"],
  [502, null],
  [0, null],
  [418, "UNKNOWN_CODE"],
];

describe("classifyConfirmFailure", () => {
  it("확정 422 INVALID_CONFIRMATION_CANDIDATE면 안내 후 후보를 다시 조회", () => {
    expect(classifyConfirmFailure({ status: 422, code: "INVALID_CONFIRMATION_CANDIDATE" })).toEqual(
      { kind: "refetch_candidates", notice: CANDIDATE_CHANGED_NOTICE },
    );
  });
  it("422 VALIDATION_FAILED도 후보 목록이 낡은 것으로 보고 다시 조회", () => {
    expect(classifyConfirmFailure({ status: 422, code: "VALIDATION_FAILED" })).toEqual({
      kind: "refetch_candidates",
      notice: CANDIDATE_CHANGED_NOTICE,
    });
  });
  it("409 INVALID_PROMISE_STATE(이미 확정·응답 유실 뒤 재시도)면 상태 다시 조회", () => {
    expect(classifyConfirmFailure({ status: 409, code: "INVALID_PROMISE_STATE" })).toEqual({
      kind: "refetch_status",
    });
  });
  it("403 FORBIDDEN이면 /me 다시 조회", () => {
    expect(classifyConfirmFailure({ status: 403, code: "FORBIDDEN" })).toEqual({
      kind: "refetch_me",
    });
  });
  it.each(relinkCases)("%s %s → 링크 재조회", (status, code) => {
    expect(classifyConfirmFailure({ status, code })).toEqual({ kind: "relink" });
  });
  it.each(transientCases)("%s %s → 화면 유지·다시 시도", (status, code) => {
    expect(classifyConfirmFailure({ status, code })).toEqual({
      kind: "retry",
      message: CONFIRM_RETRY_MESSAGE,
    });
  });
});

describe("classifyCloseFailure", () => {
  it("409 INVALID_PROMISE_STATE면 상태 다시 조회", () => {
    expect(classifyCloseFailure({ status: 409, code: "INVALID_PROMISE_STATE" })).toEqual({
      kind: "refetch_status",
    });
  });
  it("403 FORBIDDEN이면 /me 다시 조회", () => {
    expect(classifyCloseFailure({ status: 403, code: "FORBIDDEN" })).toEqual({
      kind: "refetch_me",
    });
  });
  it.each(relinkCases)("%s %s → 링크 재조회", (status, code) => {
    expect(classifyCloseFailure({ status, code })).toEqual({ kind: "relink" });
  });
  it.each(transientCases)("%s %s → 화면 유지·다시 시도", (status, code) => {
    expect(classifyCloseFailure({ status, code })).toEqual({
      kind: "retry",
      message: CLOSE_RETRY_MESSAGE,
    });
  });
});

describe("classifyCandidatesFailure", () => {
  it("409 INVALID_PROMISE_STATE(확정·재조율 등)면 상태 다시 조회", () => {
    expect(classifyCandidatesFailure({ status: 409, code: "INVALID_PROMISE_STATE" })).toEqual({
      kind: "refetch_status",
    });
  });
  it("403 FORBIDDEN은 다른 약속 세션이므로 링크 재조회", () => {
    expect(classifyCandidatesFailure({ status: 403, code: "FORBIDDEN" })).toEqual({
      kind: "relink",
    });
  });
  it.each(relinkCases)("%s %s → 링크 재조회", (status, code) => {
    expect(classifyCandidatesFailure({ status, code })).toEqual({ kind: "relink" });
  });
  it.each([...transientCases, [422, "VALIDATION_FAILED"] as [number, string]])(
    "%s %s → 화면 유지·다시 시도",
    (status, code) => {
      expect(classifyCandidatesFailure({ status, code })).toEqual({
        kind: "retry",
        message: CANDIDATES_RETRY_MESSAGE,
      });
    },
  );
});
