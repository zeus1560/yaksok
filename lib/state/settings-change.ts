import type { PromiseSession } from "@/lib/member/session-auth";
import type { SlotRange } from "@/lib/time/slots";
import type { Prisma } from "@/prisma/generated/client";
import { planRangeChange, type RangeChangePlan } from "./range-change";
import type { CurrentSettings } from "./settings-patch";
import type { StartSettingsInput } from "./start-settings";

// 재조율(STATE-API-06)과 모집 중 설정 변경(STATE-API-03)이 같은 트랜잭션 안에서 쓰는 단계들
// 잠금·재확인 → (허용 상태는 각 API) → 설정 합치기·검증 → 범위 밖 슬롯 정리 → 설정 저장 순서다

type Tx = Prisma.TransactionClient;

// session: 응답 시점의 요청자 세션 expires_at(행이 지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
export type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type LockedSettingsPromise = {
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

export type HostLockResult =
  | ({ kind: "not_found" | "cancelled" | "unauthenticated" | "forbidden" } & SessionState)
  | ({ kind: "locked"; promise: LockedSettingsPromise; now: Date } & SessionState);

// draft를 지우지 않으므로 promises 행만 잠근다 (API_CONVENTIONS 4.1-3). 판정 시각은 잠금 후 clock_timestamp() (4.2)
// 잠금 후 취소·세션·참여자·최신 role을 다시 확인한다 (close-voting.ts·cancel-promise.ts와 같은 기준, C-07)
export async function lockPromiseAsHost(tx: Tx, auth: PromiseSession): Promise<HostLockResult> {
  // 링크 행은 잠그지 않고 created_at만 같이 읽는다(세션 만료 계산 인자. collecting이면 기준으로 쓰이지 않는다)
  const [promise] = await tx.$queryRaw<LockedSettingsPromise[]>`
    SELECT p.status, p.participant_limit,
           p.date_range_start::text AS date_range_start, p.date_range_end::text AS date_range_end,
           p.daily_start_minute, p.daily_end_minute, p.duration_minutes, p.voting_deadline_at,
           l.created_at AS link_created_at
    FROM promises AS p JOIN promise_links AS l ON l.id = p.promise_link_id
    WHERE p.id = ${auth.promise.id}::uuid
    FOR UPDATE OF p`;
  const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;

  // 인증 뒤 잠금 사이에 만료 draft가 정리됐다. 요청자 세션도 함께 지워졌다
  if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
  if (promise.status === "cancelled") {
    return { kind: "cancelled", session: { expiresAt: auth.session.expiresAt, now } };
  }

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
  return { kind: "locked", promise, now, ...current };
}

// 마감 지난 collecting은 closed로 먼저 저장한다 (STATE-API-00, confirm-schedule.ts와 같음). 경계값: 판정 시각 = 마감이면 지난 것
// 바뀐 뒤 상태를 돌려준다. 호출자는 뒤에서 거절해도 이 저장을 되돌리지 않는다
export async function closeIfDeadlinePassed(
  tx: Tx,
  promiseId: string,
  promise: Pick<LockedSettingsPromise, "status" | "voting_deadline_at">,
  now: Date,
): Promise<string> {
  if (
    promise.status === "collecting" &&
    promise.voting_deadline_at &&
    promise.voting_deadline_at.getTime() <= now.getTime()
  ) {
    await tx.$executeRaw`
      UPDATE promises SET status = 'closed' WHERE id = ${promiseId}::uuid AND status = 'collecting'`;
    return "closed";
  }
  return promise.status;
}

// 모집 시작 뒤 상태(collecting·closed·confirmed)는 설정 값이 모두 채워져 있다
export function currentSettingsOf(promise: LockedSettingsPromise): CurrentSettings {
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
  return {
    participantLimit: promise.participant_limit,
    startDate: promise.date_range_start,
    endDate: promise.date_range_end,
    startMinute: promise.daily_start_minute,
    endMinute: promise.daily_end_minute,
    durationMinutes: promise.duration_minutes,
  };
}

export function slotRangeOf(settings: CurrentSettings): SlotRange {
  return {
    startDate: settings.startDate,
    endDate: settings.endDate,
    dailyStartMinute: settings.startMinute,
    dailyEndMinute: settings.endMinute,
  };
}

export type ActivePerson = { id: string; availableSlots: { id: string; slotStartAt: Date }[] };

// 정리 대상과 정원 검증용 인원. 잠금 중이라 그사이 참여·탈퇴·제출이 끼어들지 않는다
export function loadActivePeople(tx: Tx, promiseId: string): Promise<ActivePerson[]> {
  return tx.participant.findMany({
    where: { promiseId, status: "active" },
    select: { id: true, availableSlots: { select: { id: true, slotStartAt: true } } },
  });
}

// 범위 밖 슬롯 삭제·제출 해제·버전 (ERD 6.3 4~7, range-change.ts). 탈퇴자 기록은 건드리지 않는다
export async function applyRangeChange(
  tx: Tx,
  { before, after, now, people }: {
    before: CurrentSettings;
    after: CurrentSettings;
    now: Date;
    people: ActivePerson[];
  },
): Promise<RangeChangePlan> {
  const plan = planRangeChange({
    before: slotRangeOf(before),
    after: slotRangeOf(after),
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
  return plan;
}

// promises 설정 컬럼 저장 값. 날짜는 DATE 컬럼이라 UTC 자정 Date로 넘긴다
export function settingsColumns(settings: StartSettingsInput) {
  return {
    participantLimit: settings.participantLimit,
    dateRangeStart: new Date(`${settings.startDate}T00:00:00Z`),
    dateRangeEnd: new Date(`${settings.endDate}T00:00:00Z`),
    dailyStartMinute: settings.startMinute,
    dailyEndMinute: settings.endMinute,
    durationMinutes: settings.durationMinutes,
    votingDeadlineAt: settings.votingDeadlineAt,
  };
}
