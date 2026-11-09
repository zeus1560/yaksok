import { prisma } from "@/lib/prisma";
import { DRAFT_EXPIRY_MS } from "@/lib/member/link-status";
import type { PromiseSession } from "@/lib/member/session-auth";
import { filterSlots } from "./slots";

// session: 응답 시점의 요청자 세션 expires_at(행이 지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type SubmitAvailabilityResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "draft_expired" } & SessionState)
  | ({ kind: "not_open" } & SessionState)
  | ({ kind: "voting_closed" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({
      kind: "version_conflict";
      currentVersion: number;
      submitted: boolean;
      slots: Date[]; // 서버에 저장된 내 슬롯 전체, 오름차순
    } & SessionState)
  | ({
      kind: "ok";
      version: number;
      submittedAt: Date;
      slots: Date[]; // 저장 후 내 슬롯 전체(지난 슬롯 포함), 오름차순
      droppedSlotCount: number;
    } & SessionState);

type LockedPromise = {
  status: string;
  created_at: Date;
  voting_deadline_at: Date | null;
  date_range_start: string | null;
  date_range_end: string | null;
  daily_start_minute: number | null;
  daily_end_minute: number | null;
};

// TIME-API-01 가능 시간 제출. auth는 authenticatePromiseSession 성공 결과, slots는 parseSlotStrings 결과
// 약속(promiseId) 기준이고 draft를 삭제하지 않으므로 promises 행만 잠근다 (API_CONVENTIONS 4.1-3)
// 모든 분기는 정상 반환해 트랜잭션을 커밋한다 — 마감 경과 closed 전환은 409 응답이어도 커밋되어야 한다
export async function submitAvailability(
  auth: PromiseSession,
  input: { baseVersion: number; slots: number[] },
): Promise<SubmitAvailabilityResult> {
  return prisma.$transaction(async (tx): Promise<SubmitAvailabilityResult> => {
    const [promise] = await tx.$queryRaw<LockedPromise[]>`
      SELECT status, created_at, voting_deadline_at,
             date_range_start::text AS date_range_start, date_range_end::text AS date_range_end,
             daily_start_minute, daily_end_minute
      FROM promises WHERE id = ${auth.promise.id}::uuid FOR UPDATE`;
    // 잠금을 얻은 "뒤"의 시각. now()는 트랜잭션 시작 시각이라 쓰지 않는다 (API_CONVENTIONS 4.2)
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;

    // 인증 뒤 잠금 사이에 만료 draft가 정리됐다. 요청자 세션도 함께 지워졌다
    if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
    if (promise.status === "cancelled") {
      return { kind: "cancelled", session: { expiresAt: auth.session.expiresAt, now } };
    }

    // 잠금 후 세션·참여자 재확인을 상태·마감 판정보다 먼저 한다 (설정 완료와 같은 순서, R-32 N-2).
    // 탈퇴·내보내기는 세션을 즉시 만료시키므로 만료도 본다 (ERD 11절, C-07). 로그아웃으로 행이 없으면 쿠키를 지운다(R-31).
    // 재확인에 실패한 요청은 마감이 지났어도 closed를 저장하지 않는다 (STATE-API-09 공통 처리 4)
    const session = await tx.participantSession.findUnique({
      where: { id: auth.session.id },
      select: {
        expiresAt: true,
        participant: {
          select: {
            id: true,
            promiseId: true,
            status: true,
            availabilityVersion: true,
            availabilitySubmittedAt: true,
          },
        },
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

    if (promise.status === "draft") {
      // 링크를 잠그지 않으므로 삭제하지 않는다 (R-12·R-13)
      return promise.created_at.getTime() + DRAFT_EXPIRY_MS <= now.getTime()
        ? { kind: "draft_expired", ...current }
        : { kind: "not_open", ...current };
    }
    if (promise.status !== "collecting") return { kind: "voting_closed", ...current };
    if (!promise.voting_deadline_at) throw new Error("마감 시각이 없는 collecting 약속");
    // 경계값: 판정 시각 = 마감이면 마감. 쓰기 요청이 실제 status를 closed로 바꾸고 커밋한다 (ERD 8.2·11절)
    if (promise.voting_deadline_at.getTime() <= now.getTime()) {
      await tx.$executeRaw`
        UPDATE promises SET status = 'closed' WHERE id = ${auth.promise.id}::uuid AND status = 'collecting'`;
      return { kind: "voting_closed", ...current };
    }

    if (
      promise.date_range_start === null ||
      promise.date_range_end === null ||
      promise.daily_start_minute === null ||
      promise.daily_end_minute === null
    ) {
      throw new Error("설정 값이 없는 collecting 약속");
    }
    const { kept, droppedSlotCount } = filterSlots(
      input.slots,
      {
        startDate: promise.date_range_start,
        endDate: promise.date_range_end,
        dailyStartMinute: promise.daily_start_minute,
        dailyEndMinute: promise.daily_end_minute,
      },
      now,
    );

    const stored = await tx.participantAvailableSlot.findMany({
      where: { participantId: me.id },
      orderBy: { slotStartAt: "asc" },
      select: { slotStartAt: true },
    });
    const storedMs = stored.map((row) => row.slotStartAt.getTime());
    const pastMs = storedMs.filter((ms) => ms <= now.getTime());

    if (me.availabilityVersion !== input.baseVersion) {
      // 버전이 달라도 남긴 슬롯이 서버의 내 미래 슬롯과 같고 이미 제출 상태면 응답 유실 후 재시도다 (ERD 8.2)
      const futureMs = storedMs.filter((ms) => ms > now.getTime());
      const sameAsStored =
        futureMs.length === kept.length && futureMs.every((ms, i) => ms === kept[i]);
      if (sameAsStored && me.availabilitySubmittedAt !== null) {
        return {
          kind: "ok",
          version: me.availabilityVersion,
          submittedAt: me.availabilitySubmittedAt,
          slots: stored.map((row) => row.slotStartAt),
          droppedSlotCount,
          ...current,
        };
      }
      return {
        kind: "version_conflict",
        currentVersion: me.availabilityVersion,
        submitted: me.availabilitySubmittedAt !== null,
        slots: stored.map((row) => row.slotStartAt),
        ...current,
      };
    }

    // 미래 칸만 덮어쓰고 지난 칸은 고정한다 (TIME-08-01). 빈 배열도 "가능한 시간 없음" 제출이다 (TIME-12-01)
    await tx.participantAvailableSlot.deleteMany({
      where: { participantId: me.id, slotStartAt: { gt: now } },
    });
    if (kept.length > 0) {
      await tx.participantAvailableSlot.createMany({
        data: kept.map((ms) => ({ participantId: me.id, slotStartAt: new Date(ms) })),
      });
    }
    const updated = await tx.participant.update({
      where: { id: me.id },
      data: { availabilitySubmittedAt: now, availabilityVersion: { increment: 1 } },
      select: { availabilityVersion: true },
    });

    return {
      kind: "ok",
      version: updated.availabilityVersion,
      submittedAt: now,
      slots: [...pastMs, ...kept].map((ms) => new Date(ms)),
      droppedSlotCount,
      ...current,
    };
  });
}
