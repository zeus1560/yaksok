// 약속 나가기(STATE-API-08)·로그아웃(MEMBER-API-07) 확인 창 문구. 브라우저에서도 import하는 순수 함수다 (028)
// 나가기는 다시 참여할 수 없고(MEMBER-11-01), 로그아웃은 다시 로그인할 수 있다(MEMBER-04-02). 문구로 둘을 구분한다
// 방장 승계 대상은 서버와 같은 기준(본인을 뺀 active 참여자 등록순 첫 사람, MEMBER-12-03)이며
// 명단(MEMBER-API-06)이 같은 순서(created_at, id)로 준다. 최종 판정은 서버가 잠금 후 다시 한다

export type LeaveRow = { nickname: string; isMe: boolean };

export type LeaveSituation =
  // draft 설정 화면의 방장: 초안 삭제(링크는 남아 다시 만들 수 있다)
  | { kind: "draft_host" }
  // 참여 뒤 화면. participants가 null이면 명단을 아직 모른다
  | { kind: "joined"; role: "host" | "member"; participants: readonly LeaveRow[] | null };

export type LeaveConfirm = { title: string; body: string; confirmLabel: string };

export const NO_REJOIN = "나가면 같은 닉네임으로 다시 참여하거나 로그인할 수 없어요.";

export function leaveConfirm(situation: LeaveSituation): LeaveConfirm {
  if (situation.kind === "draft_host") {
    return {
      title: "만들던 약속이 삭제돼요",
      body: "지금까지 입력한 설정이 사라져요. 이 링크로 처음부터 다시 만들 수 있어요.",
      confirmLabel: "삭제하고 나가기",
    };
  }
  if (situation.role === "member") {
    return {
      title: "약속에서 나가면 다시 참여할 수 없어요",
      body: `${NO_REJOIN} 제출한 시간은 모두의 시간과 후보에서 빠져요.`,
      confirmLabel: "약속 나가기",
    };
  }
  if (!situation.participants) {
    return {
      title: "방장이 약속에서 나가요",
      body: `다음 참여자가 방장이 되고, 혼자라면 약속이 취소돼요. ${NO_REJOIN}`,
      confirmLabel: "약속 나가기",
    };
  }
  const next = situation.participants.find((row) => !row.isMe);
  if (next) {
    return {
      title: `${next.nickname}님이 방장이 돼요`,
      body: `먼저 들어온 순서대로 ${next.nickname}님에게 방장을 넘기고 나가요. ${NO_REJOIN}`,
      confirmLabel: "방장 넘기고 나가기",
    };
  }
  return {
    title: "약속이 취소돼요",
    body: "다른 참여자가 없어서 나가면 약속이 취소되고 되돌릴 수 없어요.",
    confirmLabel: "약속 취소하고 나가기",
  };
}

export const LOGOUT_ALL_CONFIRM: LeaveConfirm = {
  title: "모든 기기에서 로그아웃할까요?",
  body: "다른 기기도 다음 요청부터 로그인이 풀려요. 참여와 제출한 시간은 그대로이고, 닉네임과 PIN으로 다시 로그인할 수 있어요.",
  confirmLabel: "모든 기기에서 로그아웃",
};

// 나간 뒤·로그아웃 뒤 링크 재조회 화면에 보여 줄 안내
export const LEFT_NOTICE = "약속에서 나갔어요. 나간 닉네임으로는 다시 참여할 수 없어요.";
export const LEFT_CANCELLED_NOTICE = "다른 참여자가 없어 약속을 취소하고 나왔어요.";
export const DRAFT_DISCARDED_NOTICE =
  "만들던 약속을 삭제했어요. 이 링크로 새 약속을 만들 수 있어요.";
export const RELINK_NOTICE = "약속 상태가 바뀌어 다시 불러왔어요.";
export const LOGGED_OUT_NOTICE = "로그아웃했어요. 닉네임과 PIN으로 다시 로그인할 수 있어요.";

// 나간 뒤 안내. 혼자인 방장의 나가기는 약속 취소다(200 promiseStatus cancelled, 재요청이면 409 PROMISE_CANCELLED)
export function leftNotice(promiseCancelled: boolean): string {
  return promiseCancelled ? LEFT_CANCELLED_NOTICE : LEFT_NOTICE;
}
