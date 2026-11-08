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
import { applySettingsPatch, validateCollectingChange, type SettingsPatch } from "./settings-patch";
import {
  validateStartSettings,
  type SettingsViolation,
  type StartSettingsInput,
} from "./start-settings";

export type SettingsChangeImpact = {
  rangeChanged: boolean;
  hasAddedSelectableSlots: boolean;
  submissionsReset: boolean;
  removedSlotCount: number;
  versionChangedParticipantCount: number;
  candidateRecalculationRequired: boolean;
};

export type UpdateSettingsResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "forbidden" } & SessionState)
  | ({ kind: "invalid_state"; promiseStatus: string } & SessionState)
  | ({ kind: "validation_failed"; violation: SettingsViolation } & SessionState)
  | ({
      kind: "ok";
      settings: StartSettingsInput;
      changeImpact: SettingsChangeImpact;
    } & SessionState);

// STATE-API-03 모집 중 설정 변경. auth는 authenticatePromiseSession 성공 결과, input은 한 필드 이상 있는 부분 요청
// 재조율(reopen-promise.ts)과 같은 잠금·재확인·검증·범위 정리 단계를 쓰고, 달라지는 점만 여기서 처리한다
// - 허용 상태: collecting이며 마감 전. 상태는 collecting 그대로
// - 정원은 증가만, 마감은 연장만(validateCollectingChange)
// - 세션은 마감을 연장할 때만 새 마감 + 7일로 갱신
// 모든 분기는 정상 반환해 트랜잭션을 커밋한다 — 마감 지난 collecting의 closed 저장은 409로 거절해도 남는다
export async function updateSettings(
  auth: PromiseSession,
  input: SettingsPatch,
): Promise<UpdateSettingsResult> {
  return prisma.$transaction(async (tx): Promise<UpdateSettingsResult> => {
    const locked = await lockPromiseAsHost(tx, auth);
    if (locked.kind !== "locked") return locked;
    const { promise, now } = locked;
    const current = { session: locked.session };

    // 처리 순서 1: 잠금 후 마감 시각 이상이면 closed를 먼저 저장하고 409. draft·closed·confirmed도 409
    const status = await closeIfDeadlinePassed(tx, auth.promise.id, promise, now);
    if (status !== "collecting" || !promise.voting_deadline_at) {
      return { kind: "invalid_state", promiseStatus: status, ...current };
    }
    const oldDeadline = promise.voting_deadline_at;

    const before = currentSettingsOf(promise);
    const people = await loadActivePeople(tx, auth.promise.id);

    // 공통 규칙(STATE-API-02·06과 같은 함수) → 모집 중 규칙 순서. 시작 날짜 하한은 dateRange를 보낸 경우만 (R-26)
    const settings = applySettingsPatch(before, {
      ...input,
      votingDeadlineAt: input.votingDeadlineAt ?? oldDeadline,
    });
    const violation =
      validateStartSettings(settings, {
        now,
        activeCount: people.length,
        checkStartDateFloor: input.dateRange !== undefined,
      }) ??
      validateCollectingChange(
        { participantLimit: before.participantLimit, votingDeadlineAt: oldDeadline },
        input,
      );
    if (violation) return { kind: "validation_failed", violation, ...current };

    // 처리 순서 2~7: 범위 밖 슬롯 삭제·제출 해제·버전. 범위가 그대로면 아무것도 바꾸지 않는다
    const plan = await applyRangeChange(tx, { before, after: settings, now, people });

    await tx.promise.update({
      where: { id: auth.promise.id },
      data: settingsColumns(settings),
      select: { id: true },
    });

    // 처리 순서 8: 마감을 연장할 때만 active 참여자의 유효 세션을 새 마감 + 7일로. 만료·탈퇴 세션은 되살리지 않는다
    let sessionExpiresAt = locked.session.expiresAt;
    if (settings.votingDeadlineAt.getTime() > oldDeadline.getTime()) {
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
      if (refreshed.sessionIds.includes(auth.session.id)) sessionExpiresAt = refreshed.expiresAt;
    }

    const rangeChanged =
      settings.startDate !== before.startDate ||
      settings.endDate !== before.endDate ||
      settings.startMinute !== before.startMinute ||
      settings.endMinute !== before.endMinute;
    return {
      kind: "ok",
      settings,
      changeImpact: {
        rangeChanged,
        hasAddedSelectableSlots: plan.hasAddedSelectableSlots,
        submissionsReset: plan.submissionsReset,
        removedSlotCount: plan.removedSlotIds.length,
        versionChangedParticipantCount: plan.versionChangedParticipantIds.length,
        // 후보는 저장하지 않고 조회 때 계산한다. 계산 입력(범위·소요 시간)이 바뀌었는지만 알린다
        candidateRecalculationRequired:
          rangeChanged || settings.durationMinutes !== before.durationMinutes,
      },
      session: { expiresAt: sessionExpiresAt, now },
    };
  });
}
