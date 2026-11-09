import { prisma } from "@/lib/prisma";
import { lockPromiseAsHost, type SessionState } from "@/lib/state/settings-change";
import { cancelParticipant } from "./participant-cancel";
import type { PromiseSession } from "./session-auth";

export type RemoveParticipantResult =
  | ({ kind: "not_found" | "cancelled" | "unauthenticated" | "forbidden" } & SessionState)
  | ({ kind: "invalid_state"; promiseStatus: string } & SessionState)
  | ({ kind: "deadline_passed" | "participant_not_found" | "cannot_remove_self" } & SessionState)
  | ({
      kind: "ok";
      participantId: string;
      currentParticipantCount: number;
      participantLimit: number;
    } & SessionState);

// MEMBER-API-08 방장의 참여자 내보내기. auth는 authenticatePromiseSession 성공 결과, participantId는 형식 검사를 통과한 값
// draft를 지우지 않으므로 promises 행만 잠근다 (API_CONVENTIONS 4.1-3). 판정 시각은 잠금 후 clock_timestamp() (4.2)
// 잠금·재확인은 설정 변경·재조율과 같은 lockPromiseAsHost: 사라짐 404 → cancelled 409 → 세션·active 401 → 최신 role 403
// 이후 처리 순서 3~9: collecting 아니면 409 → 마감 지났으면 409(상태 변경 없음, 참여자 등록과 같음 — R-13·R-30)
// → 대상 소속 404 → 본인 409 → 이미 cancelled면 변경 없이 200 → 대상 cancelled + 대상 세션만 만료
export async function removeParticipant(
  auth: PromiseSession,
  participantId: string,
): Promise<RemoveParticipantResult> {
  return prisma.$transaction(async (tx): Promise<RemoveParticipantResult> => {
    const lock = await lockPromiseAsHost(tx, auth);
    if (lock.kind !== "locked") return lock;
    const { promise, now, session } = lock;

    // draft(10분 지난 draft도, 삭제 없음)·closed·confirmed. closed·confirmed는 재조율 후 처리한다
    if (promise.status !== "collecting") {
      return { kind: "invalid_state", promiseStatus: promise.status, session };
    }
    if (!promise.voting_deadline_at || promise.participant_limit === null) {
      throw new Error("마감 시각·정원이 없는 collecting 약속");
    }
    // 경계값: 판정 시각 = 마감이면 지난 것. closed로 저장하지 않는다 (참여자 등록 MEMBER-API-03과 같음)
    if (promise.voting_deadline_at.getTime() <= now.getTime()) {
      return { kind: "deadline_passed", session };
    }

    const target = await tx.participant.findUnique({
      where: { id: participantId },
      select: { id: true, promiseId: true, status: true },
    });
    if (!target || target.promiseId !== auth.promise.id) {
      return { kind: "participant_not_found", session };
    }
    // 요청자는 잠금 후 다시 확인한 이 약속의 유일한 active host다. 대상이 host면 곧 본인이다
    if (target.id === auth.participant.id) return { kind: "cannot_remove_self", session };

    // 이미 탈퇴했거나 먼저 내보냈다면 cancelled_at·세션을 다시 쓰지 않는다 (멱등)
    if (target.status !== "cancelled") {
      await cancelParticipant(tx, { participantId: target.id, now });
    }

    const currentParticipantCount = await tx.participant.count({
      where: { promiseId: auth.promise.id, status: "active" },
    });
    return {
      kind: "ok",
      participantId: target.id,
      currentParticipantCount,
      participantLimit: promise.participant_limit,
      session,
    };
  });
}
