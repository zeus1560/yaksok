"use client";

import { useState } from "react";
import { Button } from "@/components/common/ui";
import { CloseVotingConfirm } from "@/components/result/close-voting-bar";
import type { ManageAction } from "@/lib/manage/failure";
import type { PromiseSettings } from "@/lib/manage/settings-form";
import type { RoomAction } from "@/lib/result/failure";
import { CancelPanel } from "./cancel-panel";
import { SettingsPanel } from "./settings-panel";

// 방장 메뉴 (027). 현재 방장(/me role host + active + canManagePromise)에게만 화면 위쪽에 그린다 — 호출자가 판단한다
// 상태는 상태 조회(STATE-API-01)의 promiseStatus 기준이다(마감 지난 collecting은 closed로 온다). /me의 deadlinePassed는 쓰지 않는다
// - collecting: 응답 마감(STATE-API-04)·설정 변경(STATE-API-03)·약속 취소(STATE-API-07)
// - closed·confirmed: 다시 열기(STATE-API-06)·약속 취소
// 권한·상태의 최종 판정은 각 API가 잠금 후 다시 한다

type Mode = "menu" | "close" | "settings" | "reopen" | "cancel";

function allowed(mode: Mode, status: string): boolean {
  switch (mode) {
    case "close":
    case "settings":
      return status === "collecting";
    case "reopen":
      return status === "closed" || status === "confirmed";
    default:
      return true;
  }
}

export function HostMenu({
  promiseId,
  promiseStatus,
  settings,
  activeCount,
  onClosed,
  onRoomAction,
  onManageAction,
  onSaved,
}: {
  promiseId: string;
  promiseStatus: string;
  settings: PromiseSettings;
  activeCount: number;
  onClosed: () => void;
  onRoomAction: (action: RoomAction) => void;
  onManageAction: (action: ManageAction) => void;
  onSaved: (message: string, promiseStatus: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  // 폴링으로 상태가 바뀌면(마감 경과·다른 기기의 처리) 지금 상태에서 할 수 없는 화면은 메뉴로 돌린다
  const current: Mode = allowed(mode, promiseStatus) ? mode : "menu";
  const collecting = promiseStatus === "collecting";
  const back = () => setMode("menu");
  const reset = () => {
    setMode("menu");
    setOpen(false);
  };

  return (
    <section
      aria-label="방장 메뉴"
      className="mx-auto mb-4 max-w-5xl rounded-xl border border-line bg-paper p-4 sm:p-5"
    >
      {current === "menu" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-sub">
              <span className="font-medium text-text">방장 메뉴</span>
              {collecting
                ? " · 응답이 충분히 모였다면 마감 시각 전에 마감할 수 있어요."
                : " · 마감·확정 뒤에도 다시 열거나 취소할 수 있어요."}
            </p>
            <div className="flex w-full gap-2 sm:w-auto">
              {collecting && (
                <div className="flex-1 sm:w-36 sm:flex-none">
                  <Button variant="secondary" onClick={() => setMode("close")}>
                    응답 마감하기
                  </Button>
                </div>
              )}
              <div className="flex-1 sm:w-36 sm:flex-none">
                <Button
                  variant="secondary"
                  aria-expanded={open}
                  aria-controls="host-manage-actions"
                  onClick={() => setOpen((v) => !v)}
                >
                  {open ? "약속 관리 닫기" : "약속 관리"}
                </Button>
              </div>
            </div>
          </div>
          {open && (
            <div
              id="host-manage-actions"
              className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2"
            >
              {collecting ? (
                <Button variant="secondary" onClick={() => setMode("settings")}>
                  설정 변경
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setMode("reopen")}>
                  다시 열기(재조율)
                </Button>
              )}
              <Button
                variant="secondary"
                className="!text-danger"
                onClick={() => setMode("cancel")}
              >
                약속 취소
              </Button>
            </div>
          )}
        </>
      )}

      {current === "close" && (
        <CloseVotingConfirm
          promiseId={promiseId}
          onBack={back}
          onClosed={() => {
            reset();
            onClosed();
          }}
          onAction={(action) => {
            reset();
            onRoomAction(action);
          }}
        />
      )}

      {(current === "settings" || current === "reopen") && (
        <SettingsPanel
          // 폼은 열 때의 현재 값으로 채운다. 모드를 바꾸면 새로 만든다
          key={current}
          mode={current}
          promiseId={promiseId}
          promiseStatus={promiseStatus}
          current={settings}
          activeCount={activeCount}
          onBack={back}
          onSaved={(message, status) => {
            reset();
            onSaved(message, status);
          }}
          onAction={(action) => {
            // 입력란 안내와 함께 값만 다시 조회하는 경우는 폼을 유지한다
            if (action.kind !== "field") reset();
            onManageAction(action);
          }}
        />
      )}

      {current === "cancel" && (
        <CancelPanel
          promiseId={promiseId}
          onBack={back}
          onAction={(action) => {
            if (action.kind !== "done") reset();
            onManageAction(action);
          }}
        />
      )}
    </section>
  );
}
