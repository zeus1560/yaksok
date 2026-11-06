import { prisma } from "@/lib/prisma";
import type { PromiseSession } from "@/lib/member/session-auth";
import { countAvailableParticipants } from "./candidates";
import type { PromiseViewRow, PromiseViewStatus } from "./promise-view";

// session: 응답 시점의 요청자 세션 expires_at(행이 없으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type PromiseDetailResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "forbidden" } & SessionState)
  | ({
      kind: "ok";
      now: Date; // 판정 시각 = 읽기 트랜잭션의 now()
      promise: PromiseViewRow;
      requesterRole: string;
      availableParticipantCount: number | null; // confirmed일 때만
    } & SessionState);

type PromiseRow = {
  status: string;
  created_at: Date;
  participant_limit: number | null;
  date_range_start: string | null;
  date_range_end: string | null;
  daily_start_minute: number | null;
  daily_end_minute: number | null;
  duration_minutes: number | null;
  voting_deadline_at: Date | null;
  confirmed_start_at: Date | null;
};

const VIEW_STATUSES: readonly string[] = ["draft", "collecting", "closed", "confirmed"];
const MINUTE_MS = 60_000;

// STATE-API-01 약속 상태와 설정 조회. auth는 authenticatePromiseSession 성공 결과
// 약속·세션·참여자·슬롯을 한 시점 기준으로 읽도록 REPEATABLE READ 읽기 트랜잭션 하나에서 조회하고 잠그지 않는다
// 판정 시각은 이 트랜잭션의 now() 하나다 (TIME-API-02·STATE-API-10과 같은 방식, R-14·R-20). DB를 바꾸지 않는다
export async function getPromiseDetail(auth: PromiseSession): Promise<PromiseDetailResult> {
  return prisma.$transaction(
    async (tx): Promise<PromiseDetailResult> => {
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
      const [promise] = await tx.$queryRaw<PromiseRow[]>`
        SELECT status, created_at, participant_limit,
               date_range_start::text AS date_range_start, date_range_end::text AS date_range_end,
               daily_start_minute, daily_end_minute, duration_minutes,
               voting_deadline_at, confirmed_start_at
        FROM promises WHERE id = ${auth.promise.id}::uuid`;
      const keep = { session: { expiresAt: auth.session.expiresAt, now } };

      // 인증 뒤 다른 요청이 만료 draft를 정리했다. 요청자 세션도 함께 지워졌다
      if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
      if (promise.status === "cancelled") return { kind: "cancelled", ...keep };
      if (!VIEW_STATUSES.includes(promise.status)) {
        throw new Error(`알 수 없는 약속 상태: ${promise.status}`);
      }

      // 세션·참여자를 같은 스냅샷에서 다시 확인한다. 탈퇴·내보내기는 세션을 즉시 만료시킨다 (ERD 11절, C-07)
      // role도 여기서 읽는다. 방장 승계가 인증 뒤에 일어났으면 최신 역할을 쓴다
      const session = await tx.participantSession.findUnique({
        where: { id: auth.session.id },
        select: {
          expiresAt: true,
          participant: { select: { id: true, promiseId: true, status: true, role: true } },
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

      // draft는 현재 host만 (STATE-API-01 권한). 10분이 지난 draft도 방장에게는 200 + draftExpired
      const requesterRole = session.participant.role;
      if (promise.status === "draft" && requesterRole !== "host") {
        return { kind: "forbidden", ...current };
      }

      const view: PromiseViewRow = {
        id: auth.promise.id,
        status: promise.status as PromiseViewStatus,
        createdAt: promise.created_at,
        participantLimit: promise.participant_limit,
        dateRangeStart: promise.date_range_start,
        dateRangeEnd: promise.date_range_end,
        dailyStartMinute: promise.daily_start_minute,
        dailyEndMinute: promise.daily_end_minute,
        durationMinutes: promise.duration_minutes,
        votingDeadlineAt: promise.voting_deadline_at,
        confirmedStartAt: promise.confirmed_start_at,
      };

      let availableParticipantCount: number | null = null;
      if (promise.status === "confirmed") {
        const startAt = promise.confirmed_start_at;
        const duration = promise.duration_minutes;
        if (startAt === null || duration === null) {
          throw new Error("확정 일정 값이 없는 confirmed 약속");
        }
        // 확정 구간의 슬롯만 읽는다. 지난 시각이어도, 현재 날짜·하루 범위 밖이어도 그대로 센다
        const endAt = new Date(startAt.getTime() + duration * MINUTE_MS);
        const people = await tx.participant.findMany({
          where: {
            promiseId: auth.promise.id,
            status: "active",
            availabilitySubmittedAt: { not: null },
          },
          select: {
            status: true,
            availabilitySubmittedAt: true,
            availableSlots: {
              where: { slotStartAt: { gte: startAt, lt: endAt } },
              select: { slotStartAt: true },
            },
          },
        });
        availableParticipantCount = countAvailableParticipants({
          participants: people.map((person) => ({
            status: person.status,
            submittedAt: person.availabilitySubmittedAt,
            slots: person.availableSlots.map((slot) => slot.slotStartAt),
          })),
          startAt,
          durationMinutes: duration,
        });
      }

      return {
        kind: "ok",
        now,
        promise: view,
        requesterRole,
        availableParticipantCount,
        ...current,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
