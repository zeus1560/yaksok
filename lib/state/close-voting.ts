import { prisma } from "@/lib/prisma";
import type { PromiseSession } from "@/lib/member/session-auth";

// session: 응답 시점의 요청자 세션 expires_at(행이 지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type CloseVotingResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "forbidden" } & SessionState)
  | ({ kind: "invalid_state"; promiseStatus: string } & SessionState)
  | ({
      kind: "ok";
      promiseStatus: "closed";
      changed: boolean; // 이번 요청이 collecting → closed로 바꿨는지. 이미 closed면 false
      deadlineReached: boolean; // 잠금 후 판정에서 마감 시각이 이미 지났는지(공통 마감). false면 조기 마감
    } & SessionState);

type LockedPromise = { status: string; voting_deadline_at: Date | null };

// STATE-API-04 방장 마감. auth는 authenticatePromiseSession 성공 결과
// draft를 지우지 않으므로 promises 행만 잠근다 (API_CONVENTIONS 4.1-3). 판정 시각은 잠금 후 clock_timestamp() (4.2)
// 조기 마감이어도 voting_deadline_at과 세션 expires_at은 바꾸지 않는다 — 세션·링크 만료는 voting_deadline_at + 7일 유지
// (DECISION_CONFLICTS C-11 잠정 B안). 확정 시각·가능 시간·제출 기록도 건드리지 않고 후보도 저장하지 않는다
export async function closeVoting(auth: PromiseSession): Promise<CloseVotingResult> {
  return prisma.$transaction(async (tx): Promise<CloseVotingResult> => {
    const [promise] = await tx.$queryRaw<LockedPromise[]>`
      SELECT status, voting_deadline_at FROM promises WHERE id = ${auth.promise.id}::uuid FOR UPDATE`;
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const keep = { session: { expiresAt: auth.session.expiresAt, now } };

    // 인증 뒤 잠금 사이에 만료 draft가 정리됐다. 요청자 세션도 함께 지워졌다
    if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
    if (promise.status === "cancelled") return { kind: "cancelled", ...keep };

    // 잠금 후 세션·참여자·역할 재확인. 탈퇴·내보내기는 세션을 즉시 만료시키므로 만료도 본다 (ERD 11절, C-07)
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

    // 같은 closed 상태에서의 재시도는 데이터를 바꾸지 않고 성공으로 돌려준다 (STATE-API-04 처리 순서 2)
    if (promise.status === "closed") {
      return {
        kind: "ok",
        promiseStatus: "closed",
        changed: false,
        deadlineReached: false,
        ...current,
      };
    }
    // draft(10분 지난 draft 포함 — 삭제는 링크를 잠그는 API 몫)·confirmed
    if (promise.status !== "collecting") {
      return { kind: "invalid_state", promiseStatus: promise.status, ...current };
    }
    if (!promise.voting_deadline_at) throw new Error("마감 시각이 없는 collecting 약속");

    // 기한이 지났으면 공통 마감, 아니면 조기 마감. 저장하는 값은 같다 (경계: 판정 시각 = 마감이면 지난 것)
    const deadlineReached = promise.voting_deadline_at.getTime() <= now.getTime();
    await tx.$executeRaw`
      UPDATE promises SET status = 'closed' WHERE id = ${auth.promise.id}::uuid AND status = 'collecting'`;

    return { kind: "ok", promiseStatus: "closed", changed: true, deadlineReached, ...current };
  });
}
