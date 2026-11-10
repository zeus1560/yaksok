import { describe, expect, it } from "vitest";
import {
  LEFT_CANCELLED_NOTICE,
  LEFT_NOTICE,
  leaveConfirm,
  leftNotice,
  LOGOUT_ALL_CONFIRM,
  NO_REJOIN,
} from "./confirm";

const me = { nickname: "방장", isMe: true };

describe("leaveConfirm", () => {
  it("방장이 나가기 전 확인 창은 명단의 다음 사람 이름으로 승계를 안내한다", () => {
    const confirm = leaveConfirm({
      kind: "joined",
      role: "host",
      participants: [me, { nickname: "철수", isMe: false }, { nickname: "영희", isMe: false }],
    });
    expect(confirm.title).toBe("철수님이 방장이 돼요");
    expect(confirm.body).toContain(NO_REJOIN);
    expect(confirm.confirmLabel).toBe("방장 넘기고 나가기");
  });

  it("승계 대상은 본인을 뺀 등록순 첫 사람이다(방장이 명단 맨 앞이 아니어도)", () => {
    const confirm = leaveConfirm({
      kind: "joined",
      role: "host",
      participants: [{ nickname: "영희", isMe: false }, me, { nickname: "철수", isMe: false }],
    });
    expect(confirm.title).toBe("영희님이 방장이 돼요");
  });

  it("방장 혼자면 약속이 취소된다고 안내한다", () => {
    expect(leaveConfirm({ kind: "joined", role: "host", participants: [me] })).toEqual({
      title: "약속이 취소돼요",
      body: "다른 참여자가 없어서 나가면 약속이 취소되고 되돌릴 수 없어요.",
      confirmLabel: "약속 취소하고 나가기",
    });
  });

  it("명단을 모르는 방장은 승계·취소 둘 다 안내한다", () => {
    const confirm = leaveConfirm({ kind: "joined", role: "host", participants: null });
    expect(confirm.title).toBe("방장이 약속에서 나가요");
    expect(confirm.body).toContain("다음 참여자가 방장이 되고, 혼자라면 약속이 취소돼요");
  });

  it("일반 참여자는 다시 참여할 수 없다고 안내한다(명단과 무관)", () => {
    for (const participants of [null, [me, { nickname: "철수", isMe: false }]]) {
      const confirm = leaveConfirm({ kind: "joined", role: "member", participants });
      expect(confirm.title).toBe("약속에서 나가면 다시 참여할 수 없어요");
      expect(confirm.body).toContain(NO_REJOIN);
      expect(confirm.confirmLabel).toBe("약속 나가기");
    }
  });

  it("draft 방장은 만들던 약속이 삭제된다고 안내한다", () => {
    const confirm = leaveConfirm({ kind: "draft_host" });
    expect(confirm.title).toBe("만들던 약속이 삭제돼요");
    expect(confirm.body).toContain("다시 만들 수 있어요");
  });

  it("로그아웃 문구는 다시 로그인할 수 있다고 알리고 재참여 불가 문구를 쓰지 않는다", () => {
    expect(LOGOUT_ALL_CONFIRM.body).toContain("다시 로그인할 수 있어요");
    expect(LOGOUT_ALL_CONFIRM.body).not.toContain("다시 참여할 수 없어요");
  });
});

describe("leftNotice", () => {
  it("약속이 취소됐으면(혼자인 방장) 취소 안내, 아니면 재참여 불가 안내", () => {
    expect(leftNotice(true)).toBe(LEFT_CANCELLED_NOTICE);
    expect(leftNotice(false)).toBe(LEFT_NOTICE);
  });
});
