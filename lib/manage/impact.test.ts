import { describe, expect, it } from "vitest";
import { describeReopenImpact, describeSettingsImpact } from "./impact";

describe("describeSettingsImpact", () => {
  it("영향이 없으면 저장 안내만", () => {
    expect(describeSettingsImpact({ removedSlotCount: 0, submissionsReset: false })).toBe(
      "설정을 저장했어요.",
    );
  });

  it("삭제된 칸 수와 제출 해제를 알린다", () => {
    expect(describeSettingsImpact({ removedSlotCount: 3, submissionsReset: true })).toBe(
      "설정을 저장했어요. 범위 밖 입력 3칸을 지웠어요. 모든 참여자의 제출이 해제되어 다시 제출해야 해요.",
    );
  });
});

describe("describeReopenImpact", () => {
  it("확정 해제를 알린다", () => {
    expect(
      describeReopenImpact({
        removedSlotCount: 0,
        submissionsReset: false,
        confirmationCleared: true,
      }),
    ).toBe("다시 열었어요. 참여자들이 시간을 다시 고를 수 있어요. 확정된 일정을 해제했어요.");
  });

  it("closed 재조율·범위 축소", () => {
    expect(
      describeReopenImpact({
        removedSlotCount: 2,
        submissionsReset: false,
        confirmationCleared: false,
      }),
    ).toBe("다시 열었어요. 참여자들이 시간을 다시 고를 수 있어요. 범위 밖 입력 2칸을 지웠어요.");
  });
});
