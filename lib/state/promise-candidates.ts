import { prisma } from "@/lib/prisma";
import { isDeadlinePassed } from "@/lib/member/me-permissions";
import type { PromiseSession } from "@/lib/member/session-auth";
import { computeCandidates, type Candidate } from "./candidates";

// session: 응답 시점의 요청자 세션 expires_at(행이 없으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type PromiseCandidatesResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  // promiseStatus: effectiveStatus (draft는 10분이 지났어도 draft)
  | ({ kind: "invalid_state"; promiseStatus: string } & SessionState)
  | ({ kind: "ok"; calculatedAt: Date; candidates: Candidate[] } & SessionState);

type PromiseRow = {
  status: string;
  voting_deadline_at: Date | null;
  date_range_start: string | null;
  date_range_end: string | null;
  daily_start_minute: number | null;
  daily_end_minute: number | null;
  duration_minutes: number | null;
};

// STATE-API-10 공식 시간 후보 조회. auth는 authenticatePromiseSession 성공 결과
// 약속·세션·참여자·슬롯을 한 시점 기준으로 읽도록 REPEATABLE READ 읽기 트랜잭션 하나에서 조회하고 잠그지 않는다
// 계산 시각은 이 트랜잭션의 now() 하나다 (TIME-API-02와 같은 방식). DB를 바꾸지 않는다
// 반환하는 candidates는 정렬된 전체 목록이다. 페이지 자르기는 호출자가 한다
export async function getPromiseCandidates(auth: PromiseSession): Promise<PromiseCandidatesResult> {
  return prisma.$transaction(
    async (tx): Promise<PromiseCandidatesResult> => {
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
      const [promise] = await tx.$queryRaw<PromiseRow[]>`
        SELECT status, voting_deadline_at,
               date_range_start::text AS date_range_start, date_range_end::text AS date_range_end,
               daily_start_minute, daily_end_minute, duration_minutes
        FROM promises WHERE id = ${auth.promise.id}::uuid`;
      const keep = { session: { expiresAt: auth.session.expiresAt, now } };

      // 인증 뒤 다른 요청이 만료 draft를 정리했다. 요청자 세션도 함께 지워졌다
      if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
      if (promise.status === "cancelled") return { kind: "cancelled", ...keep };

      // 세션·참여자를 같은 스냅샷에서 다시 확인한다. 탈퇴·내보내기는 세션을 즉시 만료시킨다 (ERD 11절, C-07)
      const session = await tx.participantSession.findUnique({
        where: { id: auth.session.id },
        select: {
          expiresAt: true,
          participant: { select: { id: true, promiseId: true, status: true } },
        },
      });
      if (!session) return { kind: "unauthenticated", session: { expiresAt: null, now } };
      const current = { session: { expiresAt: session.expiresAt, now } };
      if (
        session.expiresAt.getTime() <= now.getTime() ||
        session.participant.status !== "active" ||
        session.participant.promiseId !== auth.promise.id ||
        session.participant.id !== auth.participant.id
      ) {
        return { kind: "unauthenticated", ...current };
      }

      // GET이라 상태를 바꾸지 않는다. 마감이 지난 collecting은 closed로 계산만 한다 (STATE-API-00 effectiveStatus)
      const promiseStatus =
        promise.status === "collecting" && isDeadlinePassed(promise.voting_deadline_at, now)
          ? "closed"
          : promise.status;
      if (promiseStatus !== "closed") {
        return { kind: "invalid_state", promiseStatus, ...current };
      }

      if (
        promise.date_range_start === null ||
        promise.date_range_end === null ||
        promise.daily_start_minute === null ||
        promise.daily_end_minute === null ||
        promise.duration_minutes === null
      ) {
        throw new Error("설정 값이 없는 약속");
      }

      // 집계 대상만 읽는다. 계산 함수도 같은 조건으로 한 번 더 거른다
      const people = await tx.participant.findMany({
        where: {
          promiseId: auth.promise.id,
          status: "active",
          availabilitySubmittedAt: { not: null },
        },
        select: {
          status: true,
          availabilitySubmittedAt: true,
          availableSlots: { select: { slotStartAt: true } },
        },
      });

      const candidates = computeCandidates({
        settings: {
          dateRangeStart: promise.date_range_start,
          dateRangeEnd: promise.date_range_end,
          dailyStartMinute: promise.daily_start_minute,
          dailyEndMinute: promise.daily_end_minute,
          durationMinutes: promise.duration_minutes,
        },
        participants: people.map((person) => ({
          status: person.status,
          submittedAt: person.availabilitySubmittedAt,
          slots: person.availableSlots.map((slot) => slot.slotStartAt),
        })),
        now,
      });

      return { kind: "ok", calculatedAt: now, candidates, ...current };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
