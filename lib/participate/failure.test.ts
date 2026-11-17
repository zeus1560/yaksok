import { describe, expect, it } from "vitest";

import {
  INVALID_CREDENTIALS_MESSAGE,
  NICKNAME_TAKEN_MESSAGE,
  RETRY_MESSAGE,
  classifyLoginFailure,
  classifyRegisterFailure,
  resolveNicknameTaken,
  type Failure,
} from "./failure";

const fail = (status: number, code: string | null, extra: Partial<Failure> = {}): Failure => ({
  status,
  code,
  message: null,
  field: null,
  ...extra,
});

describe("classifyRegisterFailure (MEMBER-API-03)", () => {
  it("409 NICKNAME_TAKEN → 로그인 1회 판별", () => {
    expect(classifyRegisterFailure(fail(409, "NICKNAME_TAKEN", { field: "nickname" }))).toEqual({
      kind: "nickname_taken",
    });
  });

  it.each([
    ["PROMISE_FULL", "full"],
    ["DEADLINE_PASSED", "deadline_passed"],
  ])("409 %s → 안내 화면 %s", (code, reason) => {
    expect(classifyRegisterFailure(fail(409, code))).toEqual({ kind: "blocked", reason });
  });

  it.each([
    [409, "ALREADY_PARTICIPANT"],
    [409, "PROMISE_NOT_OPEN"],
    [409, "INVALID_PROMISE_STATE"],
    [409, "PROMISE_CANCELLED"],
    [410, "DRAFT_EXPIRED"],
    [404, "PROMISE_NOT_FOUND"],
  ])("%i %s → 링크 다시 조회", (status, code) => {
    expect(classifyRegisterFailure(fail(status, code))).toEqual({ kind: "reload" });
  });

  it("422 VALIDATION_FAILED → 서버 문구로 해당 입력란", () => {
    expect(
      classifyRegisterFailure(
        fail(422, "VALIDATION_FAILED", { field: "pin", message: "PIN은 숫자 4자리여야 합니다." }),
      ),
    ).toEqual({ kind: "field", field: "pin", message: "PIN은 숫자 4자리여야 합니다." });
  });

  it("422인데 알 수 없는 field → 폼 오류", () => {
    expect(classifyRegisterFailure(fail(422, "VALIDATION_FAILED", { field: "x" }))).toEqual({
      kind: "form",
      message: "입력값을 확인해 주세요.",
    });
  });

  it("400 INVALID_REQUEST → 입력 확인 안내", () => {
    expect(classifyRegisterFailure(fail(400, "INVALID_REQUEST"))).toEqual({
      kind: "form",
      message: "입력값을 확인해 주세요.",
    });
  });

  it.each([
    [403, "INVALID_ORIGIN"],
    [500, "INTERNAL_ERROR"],
    [0, null],
    [418, "SOMETHING_NEW"],
  ])("%i %s → 다시 시도 안내", (status, code) => {
    expect(classifyRegisterFailure(fail(status, code))).toEqual({
      kind: "form",
      message: RETRY_MESSAGE,
    });
  });

  it("로그인 전용 코드(INVALID_CREDENTIALS)는 등록에서 다시 시도 안내", () => {
    expect(classifyRegisterFailure(fail(401, "INVALID_CREDENTIALS")).kind).toBe("form");
  });
});

describe("classifyLoginFailure (MEMBER-API-04)", () => {
  it("401 INVALID_CREDENTIALS → 닉네임·PIN을 구분하지 않는 폼 오류", () => {
    expect(classifyLoginFailure(fail(401, "INVALID_CREDENTIALS"))).toEqual({
      kind: "form",
      message: INVALID_CREDENTIALS_MESSAGE,
    });
  });

  it.each([
    [403, "PARTICIPANT_CANCELLED", "participant_cancelled"],
    [410, "ACCESS_PERIOD_EXPIRED", "access_period_expired"],
  ])("%i %s → 안내 화면", (status, code, reason) => {
    expect(classifyLoginFailure(fail(status, code))).toEqual({ kind: "blocked", reason });
  });

  it.each([
    [409, "PROMISE_CANCELLED"],
    [409, "INVALID_PROMISE_STATE"],
    [410, "DRAFT_EXPIRED"],
    [404, "PROMISE_NOT_FOUND"],
  ])("%i %s → 링크 다시 조회", (status, code) => {
    expect(classifyLoginFailure(fail(status, code))).toEqual({ kind: "reload" });
  });

  it("422 VALIDATION_FAILED nickname → 입력란", () => {
    expect(
      classifyLoginFailure(fail(422, "VALIDATION_FAILED", { field: "nickname", message: "m" })),
    ).toEqual({ kind: "field", field: "nickname", message: "m" });
  });

  it.each([
    [403, "INVALID_ORIGIN"],
    [500, "INTERNAL_ERROR"],
    [0, null],
  ])("%i %s → 다시 시도 안내", (status, code) => {
    expect(classifyLoginFailure(fail(status, code))).toEqual({
      kind: "form",
      message: RETRY_MESSAGE,
    });
  });

  it("등록 전용 코드(PROMISE_FULL)는 로그인에서 다시 시도 안내", () => {
    expect(classifyLoginFailure(fail(409, "PROMISE_FULL")).kind).toBe("form");
  });
});

describe("resolveNicknameTaken (등록 409 뒤 같은 값으로 한 로그인 결과)", () => {
  it("401 → 중복 안내 + 로그인 전환", () => {
    expect(resolveNicknameTaken(fail(401, "INVALID_CREDENTIALS"))).toEqual({
      kind: "taken",
      message: NICKNAME_TAKEN_MESSAGE,
    });
  });

  it("403 PARTICIPANT_CANCELLED → 재참여 불가 안내 화면(다른 닉네임을 권하지 않음)", () => {
    expect(resolveNicknameTaken(fail(403, "PARTICIPANT_CANCELLED"))).toEqual({
      kind: "blocked",
      reason: "participant_cancelled",
    });
  });

  it("409 PROMISE_CANCELLED → 링크 다시 조회", () => {
    expect(resolveNicknameTaken(fail(409, "PROMISE_CANCELLED"))).toEqual({ kind: "reload" });
  });

  it("네트워크 오류 → 다시 시도 안내", () => {
    expect(resolveNicknameTaken(fail(0, null))).toEqual({ kind: "form", message: RETRY_MESSAGE });
  });
});

describe("429 (035, R-41)", () => {
  const locked = (details?: unknown): Failure => ({ ...fail(429, "TOO_MANY_ATTEMPTS"), details });

  it("로그인 TOO_MANY_ATTEMPTS → 남은 분을 담은 폼 오류(입력란 오류·화면 전환 없음)", () => {
    expect(classifyLoginFailure(locked({ retryAfterSeconds: 754 }))).toEqual({
      kind: "form",
      message: "PIN을 여러 번 틀려 잠시 막혔어요. 13분 뒤에 다시 시도해 주세요.",
    });
    expect(classifyLoginFailure(locked())).toEqual({
      kind: "form",
      message: "PIN을 여러 번 틀려 잠시 막혔어요. 잠시 뒤에 다시 시도해 주세요.",
    });
  });

  it("등록 409 NICKNAME_TAKEN 뒤의 로그인이 잠겨 있어도 같은 잠금 안내", () => {
    expect(resolveNicknameTaken(locked({ retryAfterSeconds: 60 }))).toEqual({
      kind: "form",
      message: "PIN을 여러 번 틀려 잠시 막혔어요. 1분 뒤에 다시 시도해 주세요.",
    });
  });

  it("RATE_LIMITED → 등록·로그인 모두 요청이 너무 많다는 폼 오류", () => {
    const limited = { ...fail(429, "RATE_LIMITED"), details: { retryAfterSeconds: 30 } };
    const expected = { kind: "form", message: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." };
    expect(classifyLoginFailure(limited)).toEqual(expected);
    expect(classifyRegisterFailure(limited)).toEqual(expected);
  });
});
