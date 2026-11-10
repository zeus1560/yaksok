"use client";

import { useState } from "react";
import { Button } from "@/components/common/ui";
import { callApi } from "@/components/create-promise/api";
import { promisePath } from "@/components/result/api-types";
import { classifyCancelFailure, type ManageAction } from "@/lib/manage/failure";

// 약속 취소 (STATE-API-07). 확인을 한 번 받고, 요청 중에는 버튼을 막는다
// 성공과 409 PROMISE_CANCELLED(응답 유실 뒤 재요청, R-25)는 모두 done — 상위가 링크를 다시 조회해 취소 안내로 간다
// 요청자 쿠키는 서버가 Max-Age=0으로 지운다
export function CancelPanel({
  promiseId,
  onAction,
  onBack,
}: {
  promiseId: string;
  onAction: (action: ManageAction) => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await callApi<{ promiseStatus: string }>(promisePath(promiseId, "/cancel"), {
      method: "POST",
    });
    if (result.ok) {
      onAction({ kind: "done" });
      return;
    }
    const action = classifyCancelFailure(result);
    if (action.kind === "retry") {
      setBusy(false);
      setError(action.message);
      return;
    }
    if (action.kind !== "done") setBusy(false);
    onAction(action);
  }

  return (
    <div role="alertdialog" aria-labelledby="cancel-confirm" className="space-y-3">
      <p id="cancel-confirm" className="text-sm">
        <span className="font-medium">약속을 취소할까요?</span>{" "}
        <span className="text-sub">
          취소하면 되돌릴 수 없어요. 참여자 모두 이 약속에 더 이상 들어오거나 시간을 고를 수 없어요.
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={busy} onClick={onBack}>
          돌아가기
        </Button>
        <Button
          disabled={busy}
          className="!bg-danger hover:!bg-danger/90 disabled:!bg-line"
          onClick={() => void cancel()}
        >
          {busy ? "취소하는 중…" : "약속 취소하기"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
