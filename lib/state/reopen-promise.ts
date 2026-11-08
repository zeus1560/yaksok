import { prisma } from "@/lib/prisma";
import type { PromiseSession } from "@/lib/member/session-auth";
import { refreshActiveSessions } from "@/lib/member/session-expiry";
import {
  applyRangeChange,
  closeIfDeadlinePassed,
  currentSettingsOf,
  loadActivePeople,
  lockPromiseAsHost,
  settingsColumns,
  type SessionState,
} from "./settings-change";
import { applySettingsPatch, type ReopenInput } from "./settings-patch";
import { validateStartSettings, type SettingsViolation } from "./start-settings";

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

// STATE-API-06 재조율 시작. auth는 authenticatePromiseSession 성공 결과, input은 형식 검사를 마친 요청
// 잠금·재확인·범위 정리 단계는 STATE-API-03과 같은 settings-change.ts를 쓴다
// 확정 해제·슬롯 정리·제출·버전·설정·상태·세션 갱신을 한 트랜잭션으로 처리한다 (ERD 6.3-8).
// 모든 분기는 정상 반환해 트랜잭션을 커밋한다 — 마감 지난 collecting의 closed 저장은 뒤에서 422가 나도 남는다
export async function reopenPromise(
  auth: PromiseSession,
  input: ReopenInput,
): Promise<ReopenPromiseResult> {
  return prisma.$transaction(async (tx): Promise<ReopenPromiseResult> => {
    const locked = await lockPromiseAsHost(tx, auth);
    if (locked.kind !== "locked") return locked;
    const { promise, now } = locked;
    const current = { session: locked.session };

    // 마감 지난 collecting은 closed로 먼저 저장하고 재조율 대상으로 본다
    const status = await closeIfDeadlinePassed(tx, auth.promise.id, promise, now);
    // draft(10분 경과 여부와 관계없이)·마감 전 collecting(병렬 재조율의 두 번째 포함)
    if (status !== "closed" && status !== "confirmed") {
      return { kind: "invalid_state", promiseStatus: status, ...current };
    }

    const before = currentSettingsOf(promise);
    const people = await loadActivePeople(tx, auth.promise.id);

    // STATE-API-02와 같은 규칙. 시작 날짜 하한은 dateRange를 새로 보낸 경우만 본다 (R-26)
    const settings = applySettingsPatch(before, input);
    const violation = validateStartSettings(settings, {
      now,
      activeCount: people.length,
      checkStartDateFloor: input.dateRange !== undefined,
    });
    if (violation) return { kind: "validation_failed", violation, ...current };

    // 범위 밖 슬롯 삭제·제출 해제·버전 (처리 순서 4~7)
    const plan = await applyRangeChange(tx, { before, after: settings, now, people });

    // 새 설정·마감·collecting 저장, 확정 해제 (처리 순서 3·8)
    await tx.promise.update({
      where: { id: auth.promise.id },
      data: { ...settingsColumns(settings), status: "collecting", confirmedStartAt: null },
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
      session: {
        expiresAt: requesterRefreshed ? refreshed.expiresAt : locked.session.expiresAt,
        now,
      },
    };
  });
}
