import { describe, expect, it } from "vitest";
import {
  classifyPollFailure,
  classifySubmitFailure,
  SUBMIT_INVALID_MESSAGE,
  SUBMIT_LIMIT_MESSAGE,
  SUBMIT_RETRY_MESSAGE,
} from "./failure";

const f = (status: number, code: string | null, details?: unknown) => ({ status, code, details });

describe("classifyPollFailure (TIME-API-02)", () => {
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [404, "PROMISE_NOT_FOUND"],
    [409, "PROMISE_CANCELLED"],
    [409, "PROMISE_NOT_OPEN"],
    [410, "DRAFT_EXPIRED"],
    [400, "INVALID_REQUEST"],
  ])("%s %s → 링크 재조회", (status, code) => {
    expect(classifyPollFailure(f(status, code))).toEqual({ kind: "relink" });
  });
  it.each([
    [0, null],
    [500, "INTERNAL_ERROR"],
    [502, null],
    [418, "UNKNOWN_CODE"],
  ])("%s %s → 일시 오류(화면 유지)", (status, code) => {
    expect(classifyPollFailure(f(status, code))).toEqual({ kind: "transient" });
  });
});

describe("classifySubmitFailure (TIME-API-01)", () => {
  it("버전 충돌은 details로 다시 그린다 (밀리초 표기 포함)", () => {
    expect(
      classifySubmitFailure(
        f(409, "AVAILABILITY_VERSION_CONFLICT", {
          currentVersion: 5,
          submitted: true,
          slots: ["2026-11-10T14:00:00+09:00", "2026-11-10T14:30:00.000+09:00"],
        }),
      ),
    ).toEqual({
      kind: "conflict",
      version: 5,
      submitted: true,
      slots: [Date.parse("2026-11-10T14:00:00+09:00"), Date.parse("2026-11-10T14:30:00+09:00")],
    });
  });
  it.each([
    [undefined],
    [null],
    [{ currentVersion: "5", submitted: true, slots: [] }],
    [{ currentVersion: 5, submitted: "y", slots: [] }],
    [{ currentVersion: 5, submitted: true }],
    [{ currentVersion: -1, submitted: true, slots: [] }],
  ])("details 형식이 틀린 충돌은 다시 조회 (%j)", (details) => {
    expect(classifySubmitFailure(f(409, "AVAILABILITY_VERSION_CONFLICT", details))).toEqual({
      kind: "refetch",
    });
  });
  it("VOTING_CLOSED → 읽기 전용", () => {
    expect(classifySubmitFailure(f(409, "VOTING_CLOSED"))).toEqual({ kind: "closed" });
  });
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [404, "PROMISE_NOT_FOUND"],
    [409, "PROMISE_CANCELLED"],
    [409, "PROMISE_NOT_OPEN"],
    [410, "DRAFT_EXPIRED"],
    [400, "INVALID_REQUEST"],
  ])("%s %s → 링크 재조회", (status, code) => {
    expect(classifySubmitFailure(f(status, code))).toEqual({ kind: "relink" });
  });
  it.each([
    [422, "SLOT_LIMIT_EXCEEDED", SUBMIT_LIMIT_MESSAGE],
    [413, "PAYLOAD_TOO_LARGE", SUBMIT_LIMIT_MESSAGE],
    [422, "INVALID_SLOT_FORMAT", SUBMIT_INVALID_MESSAGE],
    [403, "INVALID_ORIGIN", SUBMIT_RETRY_MESSAGE],
    [500, "INTERNAL_ERROR", SUBMIT_RETRY_MESSAGE],
    [0, null, SUBMIT_RETRY_MESSAGE],
    [418, "UNKNOWN_CODE", SUBMIT_RETRY_MESSAGE],
  ])("%s %s → 로컬 유지 + 다시 시도", (status, code, message) => {
    expect(classifySubmitFailure(f(status, code))).toEqual({ kind: "retry", message });
  });
});
