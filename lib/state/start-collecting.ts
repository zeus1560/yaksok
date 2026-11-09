import { prisma } from "@/lib/prisma";
import { deleteDraftPromise } from "@/lib/member/draft-discard";
import { DRAFT_EXPIRY_MS } from "@/lib/member/link-status";
import type { PromiseSession } from "@/lib/member/session-auth";
import { refreshActiveSessions } from "@/lib/member/session-expiry";
import {
  validateStartSettings,
  type SettingsViolation,
  type StartSettingsInput,
} from "./start-settings";

// session: 응답 시점의 요청자 세션 expires_at(지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type StartCollectingResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "forbidden" } & SessionState)
  | ({ kind: "invalid_state"; promiseStatus: string } & SessionState)
  | ({ kind: "draft_expired" } & SessionState)
  | ({ kind: "validation_failed"; violation: SettingsViolation } & SessionState)
  | ({ kind: "ok"; settings: StartSettingsInput } & SessionState);

type PromiseRow = { id: string; status: string; created_at: Date };

// STATE-API-02 설정 완료와 모집 시작. auth는 authenticatePromiseSession 성공 결과
// 잠금 순서는 promise_links → promises (API_CONVENTIONS 4.1-3: draft를 물리 삭제할 수 있는 요청)
// 판정 시각은 잠금 후 clock_timestamp() (4.2). 모든 분기는 정상 반환해 트랜잭션을 커밋한다
// — 410의 만료 draft 삭제도 커밋되어야 하므로 오류 응답 분기에서 예외를 던지지 않는다
export async function startCollecting(
  auth: PromiseSession,
  input: StartSettingsInput,
): Promise<StartCollectingResult> {
  return prisma.$transaction(async (tx) => {
    const [link] = await tx.$queryRaw<{ id: string; created_at: Date }[]>`
      SELECT id, created_at FROM promise_links WHERE id = ${auth.promise.promiseLinkId}::uuid FOR UPDATE`;
    const [promise] = await tx.$queryRaw<PromiseRow[]>`
      SELECT id, status, created_at FROM promises WHERE id = ${auth.promise.id}::uuid FOR UPDATE`;
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;

    // 인증 뒤 잠금 사이에 다른 요청이 만료 draft를 정리했다. 요청자 세션도 함께 지워졌다
    if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
    if (promise.status === "cancelled") {
      return { kind: "cancelled", session: { expiresAt: auth.session.expiresAt, now } };
    }

    // 잠금 후 세션·참여자·역할 재확인 (close-voting.ts·settings-change.ts와 같은 기준, C-07)
    // 로그아웃으로 세션 행이 지워졌으면 401 + 쿠키 삭제 — 지워진 토큰으로 쿠키를 다시 심지 않는다 (R-31)
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

    // 이미 collecting인 재요청도 409. 성공 여부는 조회 API로 확인한다
    if (promise.status !== "draft") {
      return { kind: "invalid_state", promiseStatus: promise.status, ...current };
    }

    if (promise.created_at.getTime() + DRAFT_EXPIRY_MS <= now.getTime()) {
      // 만료 draft 물리 삭제: 세션 → 방장 참여자 → promise. 링크는 남긴다 (STATE-02-02, ERD 10절)
      await deleteDraftPromise(tx, promise.id);
      return { kind: "draft_expired", session: { expiresAt: null, now } };
    }

    const activeCount = await tx.participant.count({
      where: { promiseId: promise.id, status: "active" },
    });
    const violation = validateStartSettings(input, { now, activeCount });
    if (violation) return { kind: "validation_failed", violation, ...current };

    await tx.promise.update({
      where: { id: promise.id },
      data: {
        participantLimit: input.participantLimit,
        dateRangeStart: new Date(`${input.startDate}T00:00:00Z`),
        dateRangeEnd: new Date(`${input.endDate}T00:00:00Z`),
        dailyStartMinute: input.startMinute,
        dailyEndMinute: input.endMinute,
        durationMinutes: input.durationMinutes,
        votingDeadlineAt: input.votingDeadlineAt,
        status: "collecting",
      },
      select: { id: true },
    });

    // draft 세션(발급 + 24시간)을 새 상태의 링크 만료(collecting이므로 마감 + 7일)로 바꾼다.
    // active 참여자의 아직 유효한 세션만. 만료됐거나 cancelled 참여자의 세션은 되살리지 않는다
    const refreshed = await refreshActiveSessions(tx, {
      promiseId: promise.id,
      link: {
        createdAt: link.created_at, // 약속이 있으면 링크도 있다(FK). 마감이 있어 기준으로 쓰이지는 않는다
        promise: {
          status: "collecting",
          votingDeadlineAt: input.votingDeadlineAt,
          confirmedStartAt: null,
        },
      },
      now,
    });
    const requesterRefreshed = refreshed.sessionIds.includes(auth.session.id);

    return {
      kind: "ok",
      settings: input,
      session: {
        expiresAt: requesterRefreshed ? refreshed.expiresAt : session.expiresAt,
        now,
      },
    };
  });
}
