"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/common/modal";
import { callApi } from "@/components/create-promise/api";
import { promisePath } from "@/components/result/api-types";
import { classifyCancelFailure, type ManageAction } from "@/lib/manage/failure";

// 약속 취소 (STATE-API-07). 확인 창(029 공통 모달, 위험 색)을 한 번 받고, 요청 중에는 닫기·버튼을 막는다
// 성공과 409 PROMISE_CANCELLED(응답 유실 뒤 재요청, R-25)는 모두 done — 상위가 링크를 다시 조회해 취소 안내로 간다
// 요청자 쿠키는 서버가 Max-Age=0으로 지운다
export function CancelPanel({
  open,
  promiseId,
  onAction,
  onBack,
}: {
  open: boolean;
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
    <ConfirmDialog
      open={open}
      tone="danger"
      title="약속을 취소할까요?"
      confirmLabel="약속 취소하기"
      busyLabel="취소하는 중…"
      busy={busy}
      error={error}
      onConfirm={() => void cancel()}
      onClose={() => {
        setError(null);
        onBack();
      }}
    >
      <p>
        취소하면 되돌릴 수 없어요. 참여자 모두 이 약속에 더 이상 들어오거나 시간을 고를 수 없어요.
      </p>
    </ConfirmDialog>
  );
}
