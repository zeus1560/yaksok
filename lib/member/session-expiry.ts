import type { Prisma } from "@/prisma/generated/client";
import { accessExpiresAt, type AccessExpiryLink } from "./link-status";

export type RefreshedSessions = { expiresAt: Date; sessionIds: string[] };

// 약속 상태가 바뀌어 링크 만료가 달라질 때 기존 세션 expires_at을 같은 값으로 맞춘다 (API_CONVENTIONS 5.2)
// - link: 바뀐 뒤 새 상태. 모집 시작이면 collecting + 새 마감, 확정이면 confirmed + confirmed_start_at
// - 이 약속의 active 참여자이고 now 기준 아직 유효한 세션만 갱신한다.
//   만료됐거나 cancelled 참여자(탈퇴·내보내기는 expires_at을 현재 시각으로 바꾼다)의 세션은 되살리지 않는다
// - now는 잠금 후 판정 시각. 호출자가 약속 행을 FOR UPDATE로 잡은 트랜잭션 안에서 부른다
// 반환한 sessionIds로 요청자 세션이 갱신됐는지 보고 쿠키 Max-Age를 정한다
export async function refreshActiveSessions(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  { promiseId, link, now }: { promiseId: string; link: AccessExpiryLink; now: Date },
): Promise<RefreshedSessions> {
  const expiresAt = accessExpiresAt(link);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE participant_sessions AS s SET expires_at = ${expiresAt}
    FROM participants AS p
    WHERE s.participant_id = p.id
      AND p.promise_id = ${promiseId}::uuid
      AND p.status = 'active'
      AND s.expires_at > ${now}
    RETURNING s.id`;
  return { expiresAt, sessionIds: rows.map((row) => row.id) };
}

// 약속 취소(STATE-API-07)처럼 이 약속의 세션을 모두 즉시 만료한다. 행은 지우지 않는다 (STATE-API-00 「세션·보존 공통 계약」)
// - refreshActiveSessions와 달리 참여자 상태를 보지 않는다. cancelled 참여자에게 남은 유효 세션도 함께 만료한다
// - now 기준 아직 유효한 세션만 expires_at = now로 바꾼다. 이미 만료된 세션은 그 시각을 그대로 둔다
//   (지난 만료 시각을 뒤로 미루지 않는다. 어느 쪽이든 now 이후에는 쓸 수 없다)
// - now는 잠금 후 판정 시각. 호출자가 약속 행을 FOR UPDATE로 잡은 트랜잭션 안에서 부른다
export async function expireAllSessions(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  { promiseId, now }: { promiseId: string; now: Date },
): Promise<{ sessionIds: string[] }> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE participant_sessions AS s SET expires_at = ${now}
    FROM participants AS p
    WHERE s.participant_id = p.id
      AND p.promise_id = ${promiseId}::uuid
      AND s.expires_at > ${now}
    RETURNING s.id`;
  return { sessionIds: rows.map((row) => row.id) };
}
