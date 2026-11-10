"use client";

import { useState } from "react";
import { Button } from "@/components/common/ui";
import { callApi } from "@/components/create-promise/api";
import {
  leaveConfirm,
  leftNotice,
  LOGGED_OUT_NOTICE,
  LOGOUT_ALL_CONFIRM,
  type LeaveConfirm,
  type LeaveSituation,
} from "@/lib/leave/confirm";
import { classifyLeaveFailure, classifyLogoutFailure } from "@/lib/leave/failure";

// 약속 나가기(STATE-API-08)·로그아웃(MEMBER-API-07) (028)
// - 성공과 "이미 나갔다/이미 로그아웃됐다"는 응답(lib/leave/failure.ts)은 onExit — 상위가 이 약속의 저장값을 지우고 링크를 다시 조회한다
// - 쿠키는 서버가 Max-Age=0으로 지운다
// - 나가기는 다시 참여할 수 없고, 로그아웃은 다시 로그인할 수 있다. 문구로 구분한다

const DANGER = "!bg-danger hover:!bg-danger/90 disabled:!bg-line";

function participantsMePath(promiseId: string): string {
  return `/api/v1/promises/${encodeURIComponent(promiseId)}/participants/me`;
}

type LeaveResponse = { promiseStatus?: string; result?: string };

// 확인 창 하나. 요청 중에는 두 버튼을 막는다
function ConfirmBox({
  id,
  confirm,
  busy,
  busyLabel,
  error,
  onBack,
  onConfirm,
}: {
  id: string;
  confirm: LeaveConfirm;
  busy: boolean;
  busyLabel: string;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      className="space-y-3"
    >
      <p className="text-sm">
        <span id={`${id}-title`} className="font-medium">
          {confirm.title}
        </span>{" "}
        <span id={`${id}-body`} className="text-sub">
          {confirm.body}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={busy} onClick={onBack}>
          돌아가기
        </Button>
        <Button disabled={busy} className={DANGER} onClick={onConfirm}>
          {busy ? busyLabel : confirm.confirmLabel}
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

// 나가기 버튼 + 확인 창. 문구는 열 때 resolveSituation으로 정한다(방장은 명단을 새로 조회해 승계 대상을 고른다)
export function LeaveControl({
  promiseId,
  resolveSituation,
  onLeft,
  onRelink,
  buttonLabel = "약속 나가기",
}: {
  promiseId: string;
  resolveSituation: () => Promise<LeaveSituation>;
  // promiseCancelled: 혼자인 방장의 나가기가 약속 취소로 끝났다
  onLeft: (promiseCancelled: boolean) => void;
  onRelink: () => void;
  buttonLabel?: string;
}) {
  const [confirm, setConfirm] = useState<LeaveConfirm | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (preparing) return;
    setPreparing(true);
    setError(null);
    const situation = await resolveSituation();
    setPreparing(false);
    setConfirm(leaveConfirm(situation));
  }

  async function leave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await callApi<LeaveResponse>(participantsMePath(promiseId), {
      method: "DELETE",
    });
    if (result.ok) {
      onLeft(result.data.promiseStatus === "cancelled");
      return;
    }
    const action = classifyLeaveFailure(result);
    if (action.kind === "done") {
      onLeft(result.code === "PROMISE_CANCELLED");
      return;
    }
    setBusy(false);
    if (action.kind === "retry") {
      setError(action.message);
      return;
    }
    onRelink();
  }

  if (!confirm) {
    return (
      <Button
        variant="secondary"
        className="!text-danger"
        disabled={preparing}
        onClick={() => void open()}
      >
        {preparing ? "확인하는 중…" : buttonLabel}
      </Button>
    );
  }
  // 버튼 줄(그리드) 안에서 열리면 한 줄 전체를 쓴다
  return (
    <div className="sm:col-span-3">
      <ConfirmBox
        id="leave-confirm"
        confirm={confirm}
        busy={busy}
        busyLabel="나가는 중…"
        error={error}
        onBack={() => {
          setConfirm(null);
          setError(null);
        }}
        onConfirm={() => void leave()}
      />
    </div>
  );
}

// 참여 뒤 화면 아래쪽의 "내 참여" 영역: 로그아웃(이 기기·모든 기기)과 약속 나가기
export function SessionPanel({
  promiseId,
  resolveLeaveSituation,
  onExit,
  onRelink,
}: {
  promiseId: string;
  resolveLeaveSituation: () => Promise<LeaveSituation>;
  onExit: (notice: string, mode: "register" | "login") => void;
  onRelink: () => void;
}) {
  const [askAll, setAskAll] = useState(false);
  const [busy, setBusy] = useState<"one" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function logout(allDevices: boolean) {
    if (busy) return;
    setBusy(allDevices ? "all" : "one");
    setError(null);
    const query = allDevices ? "?allDevices=true" : "";
    const result = await callApi<null>(
      `/api/v1/promises/${encodeURIComponent(promiseId)}/auth/session${query}`,
      { method: "DELETE" },
    );
    const action = result.ok ? { kind: "done" as const } : classifyLogoutFailure(result);
    if (action.kind === "done") {
      onExit(LOGGED_OUT_NOTICE, "login");
      return;
    }
    setBusy(null);
    if (action.kind === "retry") {
      setError(action.message);
      return;
    }
    onRelink();
  }

  return (
    <section
      aria-label="내 참여"
      className="mx-auto mt-8 max-w-5xl rounded-xl border border-line bg-paper p-4 sm:p-5"
    >
      <h2 className="text-sm font-medium">내 참여</h2>
      <p className="mt-1 text-sm text-sub">
        로그아웃해도 참여와 제출한 시간은 그대로예요. 닉네임과 PIN으로 다시 로그인할 수 있어요. 이
        기기에서 제출하지 않은 입력은 지워져요.
      </p>
      {askAll ? (
        <div className="mt-3">
          <ConfirmBox
            id="logout-all-confirm"
            confirm={LOGOUT_ALL_CONFIRM}
            busy={busy !== null}
            busyLabel="로그아웃하는 중…"
            error={error}
            onBack={() => {
              setAskAll(false);
              setError(null);
            }}
            onConfirm={() => void logout(true)}
          />
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" disabled={busy !== null} onClick={() => void logout(false)}>
              {busy === "one" ? "로그아웃하는 중…" : "이 기기에서 로그아웃"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setError(null);
                setAskAll(true);
              }}
            >
              모든 기기에서 로그아웃
            </Button>
            <LeaveControl
              promiseId={promiseId}
              resolveSituation={resolveLeaveSituation}
              onLeft={(cancelled) => onExit(leftNotice(cancelled), "register")}
              onRelink={onRelink}
            />
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
