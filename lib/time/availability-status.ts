import { prisma } from "@/lib/prisma";
import { DRAFT_EXPIRY_MS } from "@/lib/member/link-status";
import type { PromiseSession } from "@/lib/member/session-auth";

// session: 응답 시점의 요청자 세션 expires_at(행이 없으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type AvailabilityParticipant = {
  participantId: string;
  nickname: string;
  isHost: boolean;
  availableSlots: Date[]; // 제출 시각이 있는 참여자만 저장 슬롯, 나머지 [] (TIME-12-02)
};

export type AvailabilityStatus = {
  status: "collecting" | "closed" | "confirmed"; // effectiveStatus
  serverTime: Date; // 판정 시각 = 읽기 트랜잭션의 now()
  settings: {
    dateRangeStart: string; // YYYY-MM-DD (한국 날짜)
    dateRangeEnd: string;
    dailyStartMinute: number;
    dailyEndMinute: number; // 24:00 = 1440
    durationMinutes: number;
    votingDeadlineAt: Date;
  };
  participants: AvailabilityParticipant[]; // active만, 등록순
  me: { participantId: string; version: number; submitted: boolean; slots: Date[] };
};

export type AvailabilityStatusResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "draft_expired" } & SessionState)
  | ({ kind: "not_open" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "ok" } & AvailabilityStatus & SessionState);

type PromiseRow = {
  status: string;
  created_at: Date;
  voting_deadline_at: Date | null;
  date_range_start: string | null;
  date_range_end: string | null;
  daily_start_minute: number | null;
  daily_end_minute: number | null;
  duration_minutes: number | null;
};

// TIME-API-02 가능 시간 현황 조회. auth는 authenticatePromiseSession 성공 결과
// 약속·참여자·슬롯을 한 시점 기준으로 읽도록 REPEATABLE READ 읽기 트랜잭션 하나에서 조회하고 잠그지 않는다
// DB를 바꾸지 않는다 — 마감이 지난 collecting도 응답 status만 closed로 계산한다 (ERD 11절)
export async function getAvailabilityStatus(
  auth: PromiseSession,
): Promise<AvailabilityStatusResult> {
  return prisma.$transaction(
    async (tx): Promise<AvailabilityStatusResult> => {
      // 판정 시각은 이 트랜잭션의 now()다. 스냅샷과 같은 시점이라 읽은 데이터와 판정이 어긋나지 않는다
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
      const [promise] = await tx.$queryRaw<PromiseRow[]>`
        SELECT status, created_at, voting_deadline_at,
               date_range_start::text AS date_range_start, date_range_end::text AS date_range_end,
               daily_start_minute, daily_end_minute, duration_minutes
        FROM promises WHERE id = ${auth.promise.id}::uuid`;
      const keep = { session: { expiresAt: auth.session.expiresAt, now } };

      // 인증 뒤 다른 요청이 만료 draft를 정리했다. 요청자 세션도 함께 지워졌다
      if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
      if (promise.status === "cancelled") return { kind: "cancelled", ...keep };
      if (promise.status === "draft") {
        // 조회는 링크를 잠그지 않으므로 삭제하지 않는다 (R-12·R-13)
        return promise.created_at.getTime() + DRAFT_EXPIRY_MS <= now.getTime()
          ? { kind: "draft_expired", ...keep }
          : { kind: "not_open", ...keep };
      }

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

      if (
        promise.voting_deadline_at === null ||
        promise.date_range_start === null ||
        promise.date_range_end === null ||
        promise.daily_start_minute === null ||
        promise.daily_end_minute === null ||
        promise.duration_minutes === null
      ) {
        throw new Error("설정 값이 없는 약속");
      }
      const status = effectiveStatus(promise.status, promise.voting_deadline_at, now);

      const people = await tx.participant.findMany({
        where: { promiseId: auth.promise.id, status: "active" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          nickname: true,
          role: true,
          availabilityVersion: true,
          availabilitySubmittedAt: true,
          availableSlots: { select: { slotStartAt: true }, orderBy: { slotStartAt: "asc" } },
        },
      });
      const me = people.find((person) => person.id === auth.participant.id);
      if (!me) return { kind: "unauthenticated", ...current };

      return {
        kind: "ok",
        status,
        serverTime: now,
        settings: {
          dateRangeStart: promise.date_range_start,
          dateRangeEnd: promise.date_range_end,
          dailyStartMinute: promise.daily_start_minute,
          dailyEndMinute: promise.daily_end_minute,
          durationMinutes: promise.duration_minutes,
          votingDeadlineAt: promise.voting_deadline_at,
        },
        // 다른 참여자의 제출 여부·제출 시각·version은 담지 않는다.
        // 미제출·제출 해제·빈 선택 제출이 모두 []로 보여 서로 구분되지 않는다 (TIME-12-02)
        participants: people.map((person) => ({
          participantId: person.id,
          nickname: person.nickname,
          isHost: person.role === "host",
          availableSlots:
            person.availabilitySubmittedAt !== null
              ? person.availableSlots.map((slot) => slot.slotStartAt)
              : [],
        })),
        // 제출 해제 상태여도 저장 슬롯을 그대로 보여 확인 후 다시 제출하게 한다. 지난 슬롯도 그대로 (TIME-10-03)
        me: {
          participantId: me.id,
          version: me.availabilityVersion,
          submitted: me.availabilitySubmittedAt !== null,
          slots: me.availableSlots.map((slot) => slot.slotStartAt),
        },
        ...current,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

// 경계값: 판정 시각 = 마감이면 마감. 조회는 계산만 하고 실제 전환은 쓰기 요청이 한다 (TIME-15-01~04)
function effectiveStatus(
  status: string,
  votingDeadlineAt: Date,
  now: Date,
): AvailabilityStatus["status"] {
  if (status === "collecting") {
    return votingDeadlineAt.getTime() <= now.getTime() ? "closed" : "collecting";
  }
  if (status === "closed" || status === "confirmed") return status;
  throw new Error(`알 수 없는 약속 상태: ${status}`);
}
