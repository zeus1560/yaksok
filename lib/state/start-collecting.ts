import { prisma } from "@/lib/prisma";
import { DRAFT_EXPIRY_MS } from "@/lib/member/link-status";
import type { PromiseSession } from "@/lib/member/session-auth";
import {
  validateStartSettings,
  type SettingsViolation,
  type StartSettingsInput,
} from "./start-settings";

const SESSION_AFTER_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000; // collecting 세션 = 마감 + 7일 (STATE-API-00)

// session: 응답 시점의 요청자 세션 expires_at(지워졌으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type StartCollectingResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
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
    await tx.$queryRaw`
      SELECT id FROM promise_links WHERE id = ${auth.promise.promiseLinkId}::uuid FOR UPDATE`;
    const [promise] = await tx.$queryRaw<PromiseRow[]>`
      SELECT id, status, created_at FROM promises WHERE id = ${auth.promise.id}::uuid FOR UPDATE`;
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const keep = { session: { expiresAt: auth.session.expiresAt, now } };

    // 인증 뒤 잠금 사이에 다른 요청이 만료 draft를 정리했다. 요청자 세션도 함께 지워졌다
    if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
    if (promise.status === "cancelled") return { kind: "cancelled", ...keep };

    const participant = await tx.participant.findUnique({
      where: { id: auth.participant.id },
      select: { role: true, status: true },
    });
    if (participant?.role !== "host" || participant.status !== "active") {
      return { kind: "forbidden", ...keep };
    }

    // 이미 collecting인 재요청도 409. 성공 여부는 조회 API로 확인한다
    if (promise.status !== "draft") {
      return { kind: "invalid_state", promiseStatus: promise.status, ...keep };
    }

    if (promise.created_at.getTime() + DRAFT_EXPIRY_MS <= now.getTime()) {
      // 만료 draft 물리 삭제: 세션 → 방장 참여자 → promise. 링크는 남긴다 (STATE-02-02, ERD 10절)
      await tx.participantSession.deleteMany({ where: { participant: { promiseId: promise.id } } });
      await tx.participant.deleteMany({ where: { promiseId: promise.id } });
      await tx.promise.delete({ where: { id: promise.id } });
      return { kind: "draft_expired", session: { expiresAt: null, now } };
    }

    const activeCount = await tx.participant.count({
      where: { promiseId: promise.id, status: "active" },
    });
    const violation = validateStartSettings(input, { now, activeCount });
    if (violation) return { kind: "validation_failed", violation, ...keep };

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

    // active 참여자의 아직 유효한 세션만 연장한다. 만료됐거나 cancelled 참여자의 세션은 되살리지 않는다
    const sessionExpiresAt = new Date(input.votingDeadlineAt.getTime() + SESSION_AFTER_DEADLINE_MS);
    const extended = await tx.$queryRaw<{ id: string }[]>`
      UPDATE participant_sessions AS s SET expires_at = ${sessionExpiresAt}
      FROM participants AS p
      WHERE s.participant_id = p.id
        AND p.promise_id = ${promise.id}::uuid
        AND p.status = 'active'
        AND s.expires_at > ${now}
      RETURNING s.id`;
    const requesterExtended = extended.some((row) => row.id === auth.session.id);

    return {
      kind: "ok",
      settings: input,
      session: {
        expiresAt: requesterExtended ? sessionExpiresAt : auth.session.expiresAt,
        now,
      },
    };
  });
}
