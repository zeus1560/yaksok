"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/common/modal";
import { callApi } from "@/components/create-promise/api";
import { classifyCloseFailure, type RoomAction } from "@/lib/result/failure";
import { promisePath } from "./api-types";

// 방장 마감 확인 (STATE-API-04). collecting이고 현재 방장일 때 방장 메뉴(027 host-menu.tsx)가 연다
// 확인 창(029 공통 모달)을 한 번 받고, 요청 중에는 닫기·버튼을 막는다. 성공·실패 처리는 상위(PromiseRoom)가 상태 조회로 맞춘다
export function CloseVotingConfirm({
  open,
  promiseId,
  onClosed,
  onAction,
  onBack,
}: {
  open: boolean;
  promiseId: string;
  onClosed: () => void;
  onAction: (action: RoomAction) => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await callApi<{ promiseStatus: string }>(promisePath(promiseId, "/close"), {
      method: "POST",
    });
    setBusy(false);
    if (result.ok) {
      onClosed();
      return;
    }
    const action = classifyCloseFailure(result);
    if (action.kind === "retry") {
      setError(action.message);
      return;
    }
    onAction(action);
  }

  return (
    <ConfirmDialog
      open={open}
      title="지금 응답을 마감할까요?"
      confirmLabel="마감하기"
      busyLabel="마감하는 중…"
      busy={busy}
      error={error}
      onConfirm={() => void close()}
      onClose={() => {
        setError(null);
        onBack();
      }}
    >
      <p>마감하면 참여자 모두 더 이상 시간을 바꿀 수 없고, 후보 중에서 일정을 확정할 수 있어요.</p>
    </ConfirmDialog>
  );
}
