import { describe, expect, it } from "vitest";
import { decideRoomView, type Confirmation, type RoomMe } from "./view";

const host: RoomMe = { role: "host", status: "active", permissions: { canManagePromise: true } };
const member: RoomMe = {
  role: "member",
  status: "active",
  permissions: { canManagePromise: false },
};
const confirmation = (count: number, hostActionRequired: boolean): Confirmation => ({
  startAt: "2026-11-10T14:00:00+09:00",
  endAt: "2026-11-10T16:00:00+09:00",
  availableParticipantCount: count,
  hostActionRequired,
});
const detail = (promiseStatus: string, currentConfirmation: Confirmation | null = null) => ({
  promiseStatus,
  currentConfirmation,
});

describe("decideRoomView", () => {
  it("closed이고 방장이면 확정 버튼이 있는 후보 화면", () => {
    expect(decideRoomView({ promiseStatus: "closed", currentConfirmation: null }, host)).toEqual({
      kind: "candidates",
      canConfirm: true,
    });
  });

  it("closed이고 일반 참여자면 확정 버튼 없는 후보 화면", () => {
    expect(decideRoomView(detail("closed"), member)).toEqual({
      kind: "candidates",
      canConfirm: false,
    });
  });

  it("collecting: 방장만 마감 버튼", () => {
    expect(decideRoomView(detail("collecting"), host)).toEqual({ kind: "input", canClose: true });
    expect(decideRoomView(detail("collecting"), member)).toEqual({
      kind: "input",
      canClose: false,
    });
  });

  it("role이 host여도 canManagePromise가 false면 방장 버튼을 숨긴다", () => {
    const stale = { ...host, permissions: { canManagePromise: false } };
    expect(decideRoomView(detail("collecting"), stale)).toEqual({ kind: "input", canClose: false });
    expect(decideRoomView(detail("closed"), stale)).toEqual({
      kind: "candidates",
      canConfirm: false,
    });
  });

  it("탈퇴(cancelled) 참여자 정보면 방장 버튼을 숨긴다", () => {
    expect(decideRoomView(detail("closed"), { ...host, status: "cancelled" })).toEqual({
      kind: "candidates",
      canConfirm: false,
    });
  });

  it("confirmed: 결과 화면, 방장에게 hostActionRequired 경고", () => {
    expect(decideRoomView(detail("confirmed", confirmation(1, true)), host)).toEqual({
      kind: "result",
      confirmation: confirmation(1, true),
      showHostWarning: true,
    });
    expect(decideRoomView(detail("confirmed", confirmation(3, false)), host)).toEqual({
      kind: "result",
      confirmation: confirmation(3, false),
      showHostWarning: false,
    });
  });

  it("confirmed: 일반 참여자에게는 경고를 보이지 않는다", () => {
    const view = decideRoomView(detail("confirmed", confirmation(1, true)), member);
    expect(view).toMatchObject({ kind: "result", showHostWarning: false });
  });

  it("confirmed인데 확정 값이 없으면 다음 조회를 기다린다", () => {
    expect(decideRoomView(detail("confirmed"), host)).toEqual({ kind: "loading" });
  });

  it("첫 상태 조회 전에는 불러오는 중", () => {
    expect(decideRoomView(null, host)).toEqual({ kind: "loading" });
  });

  it.each(["draft", "cancelled", "unknown"])("%s → 링크 재조회", (status) => {
    expect(decideRoomView(detail(status), host)).toEqual({ kind: "relink" });
  });
});
