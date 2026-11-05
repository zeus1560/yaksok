import { parseSetupRecord } from "./countdown";

// /p/[inviteToken] 화면 결정 (MEMBER-API-01 「화면 분기」 표)
// nextAction은 비참여자 기준 기본값이고, 최종 화면은 /me(MEMBER-API-05) 결과로 정한다
// /me의 role은 화면 선택에만 쓴다. 설정 권한은 설정 완료 API가 세션으로 다시 확인한다

export type NextAction = "register_host" | "wait_setup" | "join" | "view_result" | "cancelled";

// /me 결과. 실패(401·403·404·5xx·네트워크)는 모두 "본인 정보 없음"으로 보고 nextAction을 따른다
export type MeOutcome = { ok: true; role: string; promiseStatus: string } | { ok: false };

export type InviteViewKind = "register" | "waiting" | "setup" | "join";

export function decideInviteView(nextAction: NextAction, me: MeOutcome | null): InviteViewKind {
  if (me?.ok && me.promiseStatus === "draft" && me.role === "host") return "setup";
  switch (nextAction) {
    case "register_host":
      return "register";
    case "wait_setup":
      return "waiting";
    default:
      // 참여·로그인·결과·취소 화면은 PR 2 이후에 교체한다
      return "join";
  }
}

// 설정 카운트다운의 기준값(로컬 만료 시각). 이 기기에서 방장 등록한 같은 약속의 저장값이 있을 때만 쓴다
// 없으면 null — 다른 기기·저장소 삭제. 화면은 카운트다운 대신 10분 안내만 보이고 만료 판정은 서버 410에 맡긴다
export function setupCountdownBase(
  raw: string | null,
  promiseId: string,
  nowMs: number,
): number | null {
  const record = parseSetupRecord(raw, nowMs);
  return record && record.promiseId === promiseId ? record.localExpiresAt : null;
}
