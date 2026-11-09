import type { Prisma } from "@/prisma/generated/client";

// draft 약속 물리 삭제: 세션 → 방장 참여자 → promise 순서로 명시적으로 지운다. 링크는 남겨 재사용한다
// (STATE-02-02, ERD 10절, STATE-API-08 처리 순서 3). 모든 FK가 ON DELETE RESTRICT라 자식부터 지운다
// 쓰는 곳: 10분 지난 draft 정리(방장 등록 MEMBER-API-02·설정 완료 STATE-API-02), draft 방장 나가기(STATE-API-08)
// 호출자는 promise_links → promises 순서로 두 행을 FOR UPDATE로 잡은 트랜잭션 안에서 부른다
export async function deleteDraftPromise(
  tx: Pick<Prisma.TransactionClient, "participantSession" | "participant" | "promise">,
  promiseId: string,
): Promise<void> {
  await tx.participantSession.deleteMany({ where: { participant: { promiseId } } });
  await tx.participant.deleteMany({ where: { promiseId } });
  await tx.promise.delete({ where: { id: promiseId } });
}
