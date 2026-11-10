// 설정 변경(STATE-API-03)·재조율(STATE-API-06) 저장 뒤 changeImpact 안내 (027). 브라우저에서도 import하는 순수 함수다
// 응답 필드는 lib/state/update-settings.ts SettingsChangeImpact·lib/state/reopen-promise.ts ChangeImpact

export type SettingsImpact = {
  removedSlotCount: number;
  submissionsReset: boolean;
};

export type ReopenImpact = SettingsImpact & { confirmationCleared: boolean };

function slotParts(impact: SettingsImpact): string[] {
  const parts: string[] = [];
  if (impact.removedSlotCount > 0)
    parts.push(`범위 밖 입력 ${impact.removedSlotCount}칸을 지웠어요.`);
  if (impact.submissionsReset) parts.push("모든 참여자의 제출이 해제되어 다시 제출해야 해요.");
  return parts;
}

export function describeSettingsImpact(impact: SettingsImpact): string {
  return ["설정을 저장했어요.", ...slotParts(impact)].join(" ");
}

export function describeReopenImpact(impact: ReopenImpact): string {
  const parts = ["다시 열었어요. 참여자들이 시간을 다시 고를 수 있어요."];
  if (impact.confirmationCleared) parts.push("확정된 일정을 해제했어요.");
  return [...parts, ...slotParts(impact)].join(" ");
}
