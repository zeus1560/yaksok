import { prisma } from "@/lib/prisma";
import type { PromiseSession } from "@/lib/member/session-auth";
import { refreshActiveSessions } from "@/lib/member/session-expiry";
import { validateCandidateStart, type CandidateRejection } from "./candidates";

// session: 응답 시점의 요청자 세션 expires_at(행이 지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type ConfirmScheduleResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "forbidden" } & SessionState)
  | ({ kind: "invalid_state"; promiseStatus: string } & SessionState)
  | ({ kind: "invalid_candidate"; reason: CandidateRejection } & SessionState)
  | ({ kind: "ok"; startAt: Date; endAt: Date } & SessionState);

type LockedPromise = {
  status: string;
  voting_deadline_at: Date | null;
  date_range_start: string | null;
  date_range_end: string | null;
  daily_start_minute: number | null;
  daily_end_minute: number | null;
  duration_minutes: number | null;
  link_created_at: Date;
};

// STATE-API-05 최종 일정 확정. auth는 authenticatePromiseSession 성공 결과, startAt은 파싱한 절대 시각
// draft를 지우지 않으므로 promises 행만 잠근다 (API_CONVENTIONS 4.1-3). 판정 시각은 잠금 후 clock_timestamp() (4.2)
// 모든 분기는 정상 반환해 트랜잭션을 커밋한다 — 마감 지난 collecting의 closed 저장은 뒤에서 409·422가 나도
// 커밋되어야 하므로(TIME-API-01과 같은 방식) 오류 분기에서 예외를 던지지 않는다
export async function confirmSchedule(
  auth: PromiseSession,
  startAt: Date,
): Promise<ConfirmScheduleResult> {
  return prisma.$transaction(async (tx): Promise<ConfirmScheduleResult> => {
    // 링크 행은 잠그지 않고 created_at만 같이 읽는다(세션 만료 계산 인자. 확정이면 기준으로 쓰이지 않는다)
    const [promise] = await tx.$queryRaw<LockedPromise[]>`
      SELECT p.status, p.voting_deadline_at,
             p.date_range_start::text AS date_range_start, p.date_range_end::text AS date_range_end,
             p.daily_start_minute, p.daily_end_minute, p.duration_minutes,
             l.created_at AS link_created_at
      FROM promises AS p JOIN promise_links AS l ON l.id = p.promise_link_id
      WHERE p.id = ${auth.promise.id}::uuid
      FOR UPDATE OF p`;
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

    // 마감 지난 collecting은 실제 status를 closed로 먼저 저장하고 계속 검사한다 (처리 순서 2, ERD 8.2)
    // 경계값: 판정 시각 = 마감이면 지난 것. 뒤에서 후보가 무효여도 이 저장은 커밋된다
    let status = promise.status;
    if (
      status === "collecting" &&
      promise.voting_deadline_at &&
      promise.voting_deadline_at.getTime() <= now.getTime()
    ) {
      await tx.$executeRaw`
        UPDATE promises SET status = 'closed' WHERE id = ${auth.promise.id}::uuid AND status = 'collecting'`;
      status = "closed";
    }
    // 마감 전 collecting·draft·이미 confirmed(재요청 포함, 일정 교체 없음)
    if (status !== "closed") return { kind: "invalid_state", promiseStatus: status, ...current };

    if (
      promise.date_range_start === null ||
      promise.date_range_end === null ||
      promise.daily_start_minute === null ||
      promise.daily_end_minute === null ||
      promise.duration_minutes === null
    ) {
      throw new Error("설정 값이 없는 약속");
    }

    // 후보 조회(STATE-API-10)와 같은 판정 함수로 다시 검사한다. 잠금 중이라 그사이 제출·탈퇴가 끼어들지 않는다
    // 집계 대상만 읽는다. 판정 함수도 같은 조건으로 한 번 더 거른다
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
    const verdict = validateCandidateStart({
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
      startAt,
    });
    if (!verdict.ok) return { kind: "invalid_candidate", reason: verdict.reason, ...current };

    // 확정 시각과 상태를 함께 저장한다. 제출 상태·슬롯은 건드리지 않는다 (처리 순서 7)
    const confirmedStartAt = verdict.candidate.startAt;
    await tx.$executeRaw`
      UPDATE promises SET status = 'confirmed', confirmed_start_at = ${confirmedStartAt}
      WHERE id = ${auth.promise.id}::uuid AND status = 'closed'`;

    // C-10 잠정 A안: 링크 만료가 confirmed_start_at + 7일로 바뀌므로 세션도 같은 값으로 맞춘다.
    // active 참여자의 아직 유효한 세션만. 만료됐거나 cancelled 참여자의 세션은 되살리지 않는다
    const refreshed = await refreshActiveSessions(tx, {
      promiseId: auth.promise.id,
      link: {
        createdAt: promise.link_created_at,
        promise: {
          status: "confirmed",
          votingDeadlineAt: promise.voting_deadline_at,
          confirmedStartAt,
        },
      },
      now,
    });
    const requesterRefreshed = refreshed.sessionIds.includes(auth.session.id);

    return {
      kind: "ok",
      startAt: confirmedStartAt,
      endAt: verdict.candidate.endAt,
      session: { expiresAt: requesterRefreshed ? refreshed.expiresAt : session.expiresAt, now },
    };
  });
}
