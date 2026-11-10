// 마감·후보·확정·결과 화면 선택 (018). 브라우저에서도 import하는 순수 함수다
// 화면은 상태 조회(STATE-API-01)의 promiseStatus(마감 경과 collecting도 closed로 계산됨)와 /me의 role·permissions로 정한다
// /me의 deadlinePassed는 쓰지 않는다 — 조기 마감(DB closed, 마감 시각은 미래)에서는 false다(R-22)
// role·permissions는 버튼 표시용 힌트이고 권한은 각 쓰기 API가 잠금 후 다시 판정한다

export type Confirmation = {
  startAt: string;
  endAt: string;
  availableParticipantCount: number;
  hostActionRequired: boolean;
};

export type RoomDetail = { promiseStatus: string; currentConfirmation: Confirmation | null };

export type RoomMe = {
  role: string;
  status: string;
  permissions: { canManagePromise: boolean };
};

export type RoomView =
  // 첫 상태 조회 전(또는 확정 값이 아직 없는 응답)
  | { kind: "loading" }
  // collecting: 시간 입력 화면. 방장 마감 버튼은 방장 메뉴(027)가 canManage로 따로 판단한다
  | { kind: "input" }
  // closed: 후보 화면. canConfirm이면 후보마다 확정 버튼
  | { kind: "candidates"; canConfirm: boolean }
  // confirmed: 결과 화면
  | { kind: "result"; confirmation: Confirmation; showHostWarning: boolean }
  // draft·cancelled 등 이 화면이 맞지 않는 상태: 링크 재조회(011 흐름)
  | { kind: "relink" };

export function canManage(me: RoomMe): boolean {
  return me.role === "host" && me.status === "active" && me.permissions.canManagePromise;
}

export function decideRoomView(detail: RoomDetail | null, me: RoomMe): RoomView {
  if (!detail) return { kind: "loading" };
  const manager = canManage(me);
  switch (detail.promiseStatus) {
    case "collecting":
      return { kind: "input" };
    case "closed":
      return { kind: "candidates", canConfirm: manager };
    case "confirmed": {
      const confirmation = detail.currentConfirmation;
      // DB CHECK가 보장하는 값이다. 없으면 다음 조회를 기다린다
      if (!confirmation) return { kind: "loading" };
      // 서버는 요청자가 host일 때만 true를 준다. 화면도 방장에게만 보인다
      return {
        kind: "result",
        confirmation,
        showHostWarning: me.role === "host" && confirmation.hostActionRequired,
      };
    }
    default:
      return { kind: "relink" };
  }
}

export const PROMOTED_NOTICE =
  "이전 방장이 약속에서 나가 이제 내가 방장이에요. 위쪽 방장 메뉴를 쓸 수 있어요.";

// 명단(MEMBER-API-06)의 내 행 역할이 화면이 가진 /me 역할과 다르면 /me를 다시 불러야 한다 (028)
// 방장이 나가 자동 승계되면(MEMBER-12-03) 후임자의 열린 화면은 명단 폴링에서 먼저 알게 된다
// 내 행이 없으면(탈퇴·내보내짐) 판단하지 않는다 — 다른 요청의 401이 링크 재조회로 보낸다
export function roleChanged(
  me: Pick<RoomMe, "role">,
  rows: readonly { isMe: boolean; role: string }[] | null,
): boolean {
  const mine = rows?.find((row) => row.isMe);
  return mine !== undefined && mine.role !== me.role;
}
