import { prisma } from "@/lib/prisma";
import { deleteDraftPromise } from "@/lib/member/draft-discard";
import { cancelParticipant } from "@/lib/member/participant-cancel";
import type { PromiseSession } from "@/lib/member/session-auth";
import { expireParticipantSessions } from "@/lib/member/session-expiry";
import { markPromiseCancelled } from "./cancel-promise";
import { closeIfDeadlinePassed } from "./settings-change";

// session: 응답 시점의 요청자 세션 expires_at(행이 지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type WithdrawResult =
  | ({ kind: "not_found" | "cancelled" | "unauthenticated" | "forbidden" } & SessionState)
  | ({ kind: "draft_discarded" } & SessionState)
  | ({
      kind: "ok";
      promiseStatus: string;
      participantStatus: "active" | "cancelled";
      participantCancelledAt: Date | null;
      hostTransferred: boolean;
      newHostParticipantId: string | null;
      promiseCancelledAt: Date | null;
    } & SessionState);

type LockedPromise = { status: string; voting_deadline_at: Date | null };

// STATE-API-08 본인 탈퇴와 자동 승계. auth는 authenticatePromiseSession 성공 결과(promise_link_id를 잠금 없이 함께 읽었다)
// draft를 물리 삭제할 수 있으므로 모든 분기에서 promise_links → promises 순서로 잠근다 (처리 순서 2, API_CONVENTIONS 4.1-3)
// 판정 시각은 잠금 후 clock_timestamp() (4.2). 잠금 후 약속 존재·취소·세션·active·최신 role을 다시 확인한다
// 모든 분기는 정상 반환해 트랜잭션을 커밋한다 — 마감 지난 collecting의 closed 저장도 탈퇴와 함께 커밋된다
export async function withdrawParticipant(auth: PromiseSession): Promise<WithdrawResult> {
  return prisma.$transaction(async (tx): Promise<WithdrawResult> => {
    // 링크 행이 없을 수는 없다(RESTRICT). 잠금 대상만 고정하면 되므로 결과는 쓰지 않는다
    await tx.$queryRaw`
      SELECT id FROM promise_links WHERE id = ${auth.promise.promiseLinkId}::uuid FOR UPDATE`;
    const [promise] = await tx.$queryRaw<LockedPromise[]>`
      SELECT status, voting_deadline_at FROM promises WHERE id = ${auth.promise.id}::uuid FOR UPDATE`;
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;

    // 인증 뒤 잠금 사이에 draft가 폐기·정리됐다. 같은 링크에 새로 생긴 약속은 대신 처리하지 않는다. 요청자 세션도 지워졌다
    if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
    if (promise.status === "cancelled") {
      return { kind: "cancelled", session: { expiresAt: auth.session.expiresAt, now } };
    }

    // 잠금 후 세션·참여자 재확인 (cancel-promise.ts·settings-change.ts와 같은 기준, C-07)
    const session = await tx.participantSession.findUnique({
      where: { id: auth.session.id },
      select: {
        expiresAt: true,
        participant: { select: { id: true, promiseId: true, role: true, status: true } },
      },
    });
    if (!session) return { kind: "unauthenticated", session: { expiresAt: null, now } };
    const me = session.participant;
    if (
      session.expiresAt.getTime() <= now.getTime() ||
      me.status !== "active" ||
      me.promiseId !== auth.promise.id ||
      me.id !== auth.participant.id
    ) {
      return { kind: "unauthenticated", session: { expiresAt: session.expiresAt, now } };
    }

    // 1. draft: 현재 active host만 초안을 폐기한다. 10분이 지난 draft도 같은 삭제다(방장 등록·설정 완료의 만료 정리와 같은 함수)
    if (promise.status === "draft") {
      if (me.role !== "host") {
        return { kind: "forbidden", session: { expiresAt: session.expiresAt, now } };
      }
      await deleteDraftPromise(tx, auth.promise.id);
      return { kind: "draft_discarded", session: { expiresAt: null, now } };
    }

    // 2. 공통 마감 규약: 마감 지난 collecting은 closed로 먼저 저장한다
    const promiseStatus = await closeIfDeadlinePassed(tx, auth.promise.id, promise, now);
    const left = { session: { expiresAt: now, now } };

    // 3. 일반 참여자: 본인만 cancelled + 탈퇴 시각, 본인 세션만 만료 (참여자 내보내기와 같은 함수)
    if (me.role !== "host") {
      await cancelParticipant(tx, { participantId: me.id, now });
      return {
        kind: "ok",
        promiseStatus,
        participantStatus: "cancelled",
        participantCancelledAt: now,
        hostTransferred: false,
        newHostParticipantId: null,
        promiseCancelledAt: null,
        ...left,
      };
    }

    // 4. 방장: 본인을 뺀 active 참여자 중 먼저 들어온 사람(제출 여부 무관). 약속 행 잠금 중이라 그사이 참여·탈퇴가 끼어들지 않는다
    const successor = await tx.participant.findFirst({
      where: { promiseId: auth.promise.id, status: "active", id: { not: me.id } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    if (successor) {
      // 기존 방장을 먼저 한 UPDATE로 member + cancelled + 탈퇴 시각으로 바꿔 방장 UNIQUE·host이면 active CHECK를 지킨다
      await tx.participant.update({
        where: { id: me.id },
        data: { role: "member", status: "cancelled", cancelledAt: now },
        select: { id: true },
      });
      await tx.participant.update({
        where: { id: successor.id },
        data: { role: "host" },
        select: { id: true },
      });
      await expireParticipantSessions(tx, { participantId: me.id, now });
      return {
        kind: "ok",
        promiseStatus,
        participantStatus: "cancelled",
        participantCancelledAt: now,
        hostTransferred: true,
        newHostParticipantId: successor.id,
        promiseCancelledAt: null,
        ...left,
      };
    }

    // 5. 후임자 없음: 참여자는 그대로(host·active) 두고 약속 취소(STATE-API-07)와 같은 저장·세션 만료
    await markPromiseCancelled(tx, { promiseId: auth.promise.id, now });
    return {
      kind: "ok",
      promiseStatus: "cancelled",
      participantStatus: "active",
      participantCancelledAt: null,
      hostTransferred: false,
      newHostParticipantId: null,
      promiseCancelledAt: now,
      ...left,
    };
  });
}
