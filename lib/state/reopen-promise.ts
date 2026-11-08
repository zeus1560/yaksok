import { prisma } from "@/lib/prisma";
import type { PromiseSession } from "@/lib/member/session-auth";
import { refreshActiveSessions } from "@/lib/member/session-expiry";
import type { SlotRange } from "@/lib/time/slots";
import { planRangeChange } from "./range-change";
import { applySettingsPatch, type ReopenInput } from "./settings-patch";
import { validateStartSettings, type SettingsViolation, type StartSettingsInput } from "./start-settings";

// session: 응답 시점의 요청자 세션 expires_at(행이 지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type ChangeImpact = {
  hasAddedSelectableSlots: boolean;
  submissionsReset: boolean;
  removedSlotCount: number;
  versionChangedParticipantCount: number;
  confirmationCleared: boolean;
};

export type ReopenPromiseResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "forbidden" } & SessionState)
  | ({ kind: "invalid_state"; promiseStatus: string } & SessionState)
  | ({ kind: "validation_failed"; violation: SettingsViolation } & SessionState)
  | ({ kind: "ok"; changeImpact: ChangeImpact } & SessionState);

type LockedPromise = {
  status: string;
  participant_limit: number | null;
  date_range_start: string | null;
  date_range_end: string | null;
  daily_start_minute: number | null;
  daily_end_minute: number | null;
  duration_minutes: number | null;
  voting_deadline_at: Date | null;
  link_created_at: Date;
};

function slotRange(settings: StartSettingsInput | Omit<StartSettingsInput, "votingDeadlineAt">): SlotRange {
  return {
    startDate: settings.startDate,
    endDate: settings.endDate,
    dailyStartMinute: settings.startMinute,
    dailyEndMinute: settings.endMinute,
  };
}

// STATE-API-06 재조율 시작. auth는 authenticatePromiseSession 성공 결과, input은 형식 검사를 마친 요청
// draft를 지우지 않으므로 promises 행만 잠근다 (API_CONVENTIONS 4.1-3). 판정 시각은 잠금 후 clock_timestamp() (4.2)
// 확정 해제·슬롯 정리·제출·버전·설정·상태·세션 갱신을 한 트랜잭션으로 처리한다 (ERD 6.3-8).
// 모든 분기는 정상 반환해 트랜잭션을 커밋한다 — 마감 지난 collecting의 closed 저장은 뒤에서 422가 나도 남는다
export async function reopenPromise(
  auth: PromiseSession,
  input: ReopenInput,
): Promise<ReopenPromiseResult> {
  return prisma.$transaction(async (tx): Promise<ReopenPromiseResult> => {
    // 링크 행은 잠그지 않고 created_at만 같이 읽는다(세션 만료 계산 인자. collecting이면 기준으로 쓰이지 않는다)
    const [promise] = await tx.$queryRaw<LockedPromise[]>`
      SELECT p.status, p.participant_limit,
             p.date_range_start::text AS date_range_start, p.date_range_end::text AS date_range_end,
             p.daily_start_minute, p.daily_end_minute, p.duration_minutes, p.voting_deadline_at,
             l.created_at AS link_created_at
      FROM promises AS p JOIN promise_links AS l ON l.id = p.promise_link_id
      WHERE p.id = ${auth.promise.id}::uuid
      FOR UPDATE OF p`;
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const keep = { session: { expiresAt: auth.session.expiresAt, now } };

    // 인증 뒤 잠금 사이에 만료 draft가 정리됐다. 요청자 세션도 함께 지워졌다
    if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
    if (promise.status === "cancelled") return { kind: "cancelled", ...keep };

    // 잠금 후 세션·참여자·역할 재확인 (close-voting.ts·cancel-promise.ts와 같은 기준, C-07)
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

    // 마감 지난 collecting은 closed로 먼저 저장하고 재조율 대상으로 본다 (STATE-API-00, confirm-schedule.ts와 같음)
    // 경계값: 판정 시각 = 마감이면 지난 것
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
    // draft(10분 경과 여부와 관계없이)·마감 전 collecting(병렬 재조율의 두 번째 포함)
    if (status !== "closed" && status !== "confirmed") {
      return { kind: "invalid_state", promiseStatus: status, ...current };
    }

    if (
      promise.participant_limit === null ||
      promise.date_range_start === null ||
      promise.date_range_end === null ||
      promise.daily_start_minute === null ||
      promise.daily_end_minute === null ||
      promise.duration_minutes === null
    ) {
      throw new Error("설정 값이 없는 약속");
    }
    const before = {
      participantLimit: promise.participant_limit,
      startDate: promise.date_range_start,
      endDate: promise.date_range_end,
      startMinute: promise.daily_start_minute,
      endMinute: promise.daily_end_minute,
      durationMinutes: promise.duration_minutes,
    };

    // 잠금 중이라 그사이 참여·탈퇴·제출이 끼어들지 않는다
    const people = await tx.participant.findMany({
      where: { promiseId: auth.promise.id, status: "active" },
      select: { id: true, availableSlots: { select: { id: true, slotStartAt: true } } },
    });

    // STATE-API-02와 같은 규칙. 시작 날짜 하한은 dateRange를 새로 보낸 경우만 본다 (R-26)
    const settings = applySettingsPatch(before, input);
    const violation = validateStartSettings(settings, {
      now,
      activeCount: people.length,
      checkStartDateFloor: input.dateRange !== undefined,
    });
    if (violation) return { kind: "validation_failed", violation, ...current };

    // 범위 밖 슬롯 삭제·제출 해제·버전 (처리 순서 4~7). 탈퇴자 기록은 건드리지 않는다
    const plan = planRangeChange({
      before: slotRange(before),
      after: slotRange(settings),
      now,
      participants: people.map((person) => ({
        id: person.id,
        slots: person.availableSlots.map((slot) => ({ id: slot.id, startAt: slot.slotStartAt })),
      })),
    });
    if (plan.removedSlotIds.length > 0) {
      await tx.participantAvailableSlot.deleteMany({ where: { id: { in: plan.removedSlotIds } } });
    }
    if (plan.versionChangedParticipantIds.length > 0) {
      await tx.participant.updateMany({
        where: { id: { in: plan.versionChangedParticipantIds } },
        data: plan.submissionsReset
          ? { availabilityVersion: { increment: 1 }, availabilitySubmittedAt: null }
          : { availabilityVersion: { increment: 1 } },
      });
    }

    // 새 설정·마감·collecting 저장, 확정 해제 (처리 순서 3·8)
    await tx.promise.update({
      where: { id: auth.promise.id },
      data: {
        participantLimit: settings.participantLimit,
        dateRangeStart: new Date(`${settings.startDate}T00:00:00Z`),
        dateRangeEnd: new Date(`${settings.endDate}T00:00:00Z`),
        dailyStartMinute: settings.startMinute,
        dailyEndMinute: settings.endMinute,
        durationMinutes: settings.durationMinutes,
        votingDeadlineAt: settings.votingDeadlineAt,
        status: "collecting",
        confirmedStartAt: null,
      },
      select: { id: true },
    });

    // 링크 만료가 새 마감 + 7일이 되므로 세션도 맞춘다 (처리 순서 9). 확정에서 왔다면 확정 + 7일보다 짧아질 수 있다(C-10).
    // active 참여자의 아직 유효한 세션만. 만료됐거나 탈퇴한 참여자의 세션은 되살리지 않는다
    const refreshed = await refreshActiveSessions(tx, {
      promiseId: auth.promise.id,
      link: {
        createdAt: promise.link_created_at,
        promise: {
          status: "collecting",
          votingDeadlineAt: settings.votingDeadlineAt,
          confirmedStartAt: null,
        },
      },
      now,
    });
    const requesterRefreshed = refreshed.sessionIds.includes(auth.session.id);

    return {
      kind: "ok",
      changeImpact: {
        hasAddedSelectableSlots: plan.hasAddedSelectableSlots,
        submissionsReset: plan.submissionsReset,
        removedSlotCount: plan.removedSlotIds.length,
        versionChangedParticipantCount: plan.versionChangedParticipantIds.length,
        confirmationCleared: status === "confirmed",
      },
      session: { expiresAt: requesterRefreshed ? refreshed.expiresAt : session.expiresAt, now },
    };
  });
}
