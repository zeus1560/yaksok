import { describe, expect, it } from "vitest";
import { canManage, decideRoomView, roleChanged, type Confirmation, type RoomMe } from "./view";

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

  it("collecting: 방장·참여자 모두 시간 입력 화면(마감 버튼은 방장 메뉴가 canManage로 판단)", () => {
    expect(decideRoomView(detail("collecting"), host)).toEqual({ kind: "input" });
    expect(decideRoomView(detail("collecting"), member)).toEqual({ kind: "input" });
    expect(canManage(host)).toBe(true);
    expect(canManage(member)).toBe(false);
  });

  it("role이 host여도 canManagePromise가 false면 방장 버튼을 숨긴다", () => {
    const stale = { ...host, permissions: { canManagePromise: false } };
    expect(canManage(stale)).toBe(false);
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

describe("roleChanged", () => {
  const rows = (role: string) => [
    { isMe: false, role: role === "host" ? "member" : "host" },
    { isMe: true, role },
  ];

  it("방장이 나가 내가 승계되면(명단 role host, /me role member) /me를 다시 부른다", () => {
    expect(roleChanged({ role: "member" }, rows("host"))).toBe(true);
  });

  it("역할이 같으면 다시 부르지 않는다", () => {
    expect(roleChanged({ role: "member" }, rows("member"))).toBe(false);
    expect(roleChanged({ role: "host" }, rows("host"))).toBe(false);
  });

  it("명단이 없거나 내 행이 없으면(탈퇴·내보내짐) 판단하지 않는다", () => {
    expect(roleChanged({ role: "member" }, null)).toBe(false);
    expect(roleChanged({ role: "member" }, [{ isMe: false, role: "host" }])).toBe(false);
  });
});
