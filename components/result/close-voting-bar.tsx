"use client";

import { useState } from "react";
import { Button } from "@/components/common/ui";
import { callApi } from "@/components/create-promise/api";
import { classifyCloseFailure, type RoomAction } from "@/lib/result/failure";
import { promisePath } from "./api-types";

// 방장 마감 (STATE-API-04). collecting이고 현재 방장일 때만 그린다(state.md STATE-API-04 처리 순서 7)
// 확인을 한 번 받고, 요청 중에는 버튼을 막는다. 성공·실패 처리는 상위(PromiseRoom)가 상태 조회로 맞춘다
export function CloseVotingBar({
  promiseId,
  onClosed,
  onAction,
}: {
  promiseId: string;
  onClosed: () => void;
  onAction: (action: RoomAction) => void;
}) {
  const [asking, setAsking] = useState(false);
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
      setAsking(false);
      onClosed();
      return;
    }
    const action = classifyCloseFailure(result);
    if (action.kind === "retry") {
      setError(action.message);
      return;
    }
    setAsking(false);
    onAction(action);
  }

  return (
    <section className="mx-auto mb-4 max-w-5xl rounded-xl border border-line bg-paper p-4 sm:p-5">
      {asking ? (
        <div role="alertdialog" aria-labelledby="close-confirm" className="space-y-3">
          <p id="close-confirm" className="text-sm">
            <span className="font-medium">지금 응답을 마감할까요?</span>{" "}
            <span className="text-sub">
              마감하면 참여자 모두 더 이상 시간을 바꿀 수 없고, 후보 중에서 일정을 확정할 수 있어요.
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setAsking(false)}>
              취소
            </Button>
            <Button disabled={busy} onClick={() => void close()}>
              {busy ? "마감하는 중…" : "마감하기"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-sub">
            <span className="font-medium text-text">방장 메뉴</span> · 응답이 충분히 모였다면 마감
            시각 전에 마감할 수 있어요.
          </p>
          <div className="w-32 shrink-0 sm:w-40">
            <Button variant="secondary" onClick={() => setAsking(true)}>
              응답 마감하기
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
