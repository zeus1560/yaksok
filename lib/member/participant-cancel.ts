import type { Prisma } from "@/prisma/generated/client";
import { expireParticipantSessions } from "./session-expiry";

// 참여자 한 명을 약속에서 뺀다: status='cancelled' + cancelled_at, 그 참여자의 유효 세션만 즉시 만료
// 슬롯·제출 시각·버전·닉네임·PIN 해시·role은 건드리지 않는다. 물리 삭제하지 않는다 (MEMBER-10-03, ERD 6.2)
// 쓰는 곳: 일반 참여자 본인 탈퇴(STATE-API-08), 방장의 참여자 내보내기(MEMBER-API-08) — 두 API의 끝 상태가 같다
// role='host'인 참여자에게 쓰지 않는다(host이면 active CHECK). 방장 승계는 withdraw-participant.ts가 따로 처리한다
// 호출자는 약속 행을 FOR UPDATE로 잡고 잠금 후 판정 시각 now를 넘긴다
export async function cancelParticipant(
  tx: Pick<Prisma.TransactionClient, "participant" | "$queryRaw">,
  { participantId, now }: { participantId: string; now: Date },
): Promise<void> {
  await tx.participant.update({
    where: { id: participantId },
    data: { status: "cancelled", cancelledAt: now },
    select: { id: true },
  });
  await expireParticipantSessions(tx, { participantId, now });
}
