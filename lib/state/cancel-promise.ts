import { prisma } from "@/lib/prisma";
import { DRAFT_EXPIRY_MS } from "@/lib/member/link-status";
import type { PromiseSession } from "@/lib/member/session-auth";
import { expireAllSessions } from "@/lib/member/session-expiry";
import type { Prisma } from "@/prisma/generated/client";

// session: 응답 시점의 요청자 세션 expires_at(행이 지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type CancelPromiseResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "forbidden" } & SessionState)
  | ({ kind: "draft_expired" } & SessionState)
  | ({ kind: "ok"; promiseStatus: "cancelled"; cancelledAt: Date } & SessionState);

type LockedPromise = { status: string; created_at: Date };

// 약속 취소 저장: status·cancelled_at만 한 문장으로 바꾸고 이 약속의 유효 세션을 모두 만료한다 (DECISION_CONFLICTS R-25)
// 참여자(role·status·cancelled_at)·설정·슬롯·확정 일정은 건드리지 않는다
// 쓰는 곳: 약속 취소(STATE-API-07), 후임자 없는 방장 탈퇴(STATE-API-08 처리 순서 8 — 취소와 같은 결과)
// 호출자는 약속 행을 FOR UPDATE로 잡고 잠금 후 판정 시각 now를 넘긴다
export async function markPromiseCancelled(
  tx: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  { promiseId, now }: { promiseId: string; now: Date },
): Promise<void> {
  await tx.$executeRaw`
    UPDATE promises SET status = 'cancelled', cancelled_at = ${now}
    WHERE id = ${promiseId}::uuid AND status <> 'cancelled'`;
  await expireAllSessions(tx, { promiseId, now });
}

// STATE-API-07 약속 취소. auth는 authenticatePromiseSession 성공 결과
// draft를 지우지 않으므로 promises 행만 잠근다 (API_CONVENTIONS 4.1-3). 판정 시각은 잠금 후 clock_timestamp() (4.2)
// 약속의 status·cancelled_at만 바꾸고 설정·참여자(role·status·cancelled_at)·슬롯·제출 기록·confirmed_start_at은 보존한다.
// 약속 취소는 참여자 탈퇴가 아니다 (STATE-API-07 처리 순서 3·4). 같은 트랜잭션에서 이 약속의 세션을 모두 만료한다
export async function cancelPromise(auth: PromiseSession): Promise<CancelPromiseResult> {
  return prisma.$transaction(async (tx): Promise<CancelPromiseResult> => {
    const [promise] = await tx.$queryRaw<LockedPromise[]>`
      SELECT status, created_at FROM promises WHERE id = ${auth.promise.id}::uuid FOR UPDATE`;
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const keep = { session: { expiresAt: auth.session.expiresAt, now } };

    // 인증 뒤 잠금 사이에 만료 draft가 정리됐다. 요청자 세션도 함께 지워졌다
    if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
    // 먼저 잠금을 잡은 취소가 이겼다. 첫 성공 요청만 200 (처리 순서 8)
    if (promise.status === "cancelled") return { kind: "cancelled", ...keep };

    // 잠금 후 세션·참여자·역할 재확인 (close-voting.ts와 같은 기준, C-07)
    const session = await tx.participantSession.findUnique({
      where: { id: auth.session.id },
      select: {
        expiresAt: true,
        participant: { select: { id: true, promiseId: true, role: true, status: true } },
      },
    });
    if (!session) return { kind: "unauthenticated", session: { expiresAt: null, now } };
    const current = { session: { expiresAt: session.expiresAt, now } };
    const me = session.participant;
    if (
      session.expiresAt.getTime() <= now.getTime() ||
      me.status !== "active" ||
      me.promiseId !== auth.promise.id ||
      me.id !== auth.participant.id
    ) {
      return { kind: "unauthenticated", ...current };
    }
    if (me.role !== "host") return { kind: "forbidden", ...current };

    // 10분 지난 draft는 취소하지 않는다. 취소를 저장하면 다시 방장 등록이 가능해야 할 링크가 영구히 cancelled가 된다.
    // STATE-API-02와 같은 410으로 거절하되, 링크를 잠그지 않으므로 삭제는 하지 않는다 (DECISION_CONFLICTS R-25)
    if (
      promise.status === "draft" &&
      promise.created_at.getTime() + DRAFT_EXPIRY_MS <= now.getTime()
    ) {
      return { kind: "draft_expired", ...current };
    }

    // 허용 상태 draft·collecting·closed·confirmed는 모두 그대로 cancelled로 바꾼다.
    // 마감 지난 collecting도 closed를 거치지 않는다 — 최종 상태가 같고 closed 저장은 남지 않는다
    await markPromiseCancelled(tx, { promiseId: auth.promise.id, now });

    // 요청자 세션도 위에서 만료됐다(잠금 후 유효함을 확인했다). 쿠키 Max-Age=0
    return {
      kind: "ok",
      promiseStatus: "cancelled",
      cancelledAt: now,
      session: { expiresAt: now, now },
    };
  });
}
