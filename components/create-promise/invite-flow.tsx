"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NoticeCard } from "@/components/common/ui";
import {
  callApi,
  readStorage,
  removeStorage,
  type LinkStatus,
  type StartedSettings,
} from "@/components/create-promise/api";
import { DoneCard } from "@/components/create-promise/done-card";
import { RegisterHostCard } from "@/components/create-promise/register-host-card";
import { SetupForm } from "@/components/create-promise/setup-form";
import { DRAFT_POLL_FALLBACK_MS } from "@/components/create-promise/constants";
import {
  parseSetupRecord,
  setupStorageKey,
  type SetupRecord,
} from "@/lib/create-promise/countdown";

// /p/[inviteToken] 화면 분기 (MEMBER-API-01 화면 분기 표, DECISION_CONFLICTS R-15)
// 저장소 값은 화면 복원에만 쓴다. 방장 권한은 서버가 세션 쿠키로 확인한다

type View =
  | { kind: "loading" }
  | { kind: "register"; notice: string | null }
  | { kind: "waiting"; pollMs: number; notice: string | null }
  | { kind: "setup"; record: SetupRecord }
  | { kind: "done"; settings: StartedSettings }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "join" }
  | { kind: "error" };

async function lookup(inviteToken: string, notice: string | null = null): Promise<View> {
  const result = await callApi<LinkStatus>(`/api/v1/links/${encodeURIComponent(inviteToken)}`);
  if (!result.ok) {
    if (result.status === 404) return { kind: "invalid" };
    if (result.status === 410) return { kind: "expired" };
    return { kind: "error" };
  }
  switch (result.data.nextAction) {
    case "register_host":
      return { kind: "register", notice };
    case "wait_setup":
      return { kind: "waiting", pollMs: result.data.pollAfterMs ?? DRAFT_POLL_FALLBACK_MS, notice };
    default:
      // 참여·로그인·결과·취소 화면은 PR 2 이후에 교체한다
      return { kind: "join" };
  }
}

export function InviteFlow({ inviteToken }: { inviteToken: string }) {
  const storageKey = setupStorageKey(inviteToken);
  const [view, setView] = useState<View>({ kind: "loading" });

  const reload = useCallback(
    async (notice: string | null = null) => {
      setView(await lookup(inviteToken, notice));
    },
    [inviteToken],
  );

  // 첫 진입: 이 토큰의 설정 진행 정보가 있고 시한이 남았으면 설정 화면을 바로 연다
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const record = parseSetupRecord(readStorage(storageKey), Date.now());
      const next: View = record ? { kind: "setup", record } : await lookup(inviteToken);
      if (!record) removeStorage(storageKey);
      if (!cancelled) setView(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, storageKey]);

  // 설정 중 대기: pollAfterMs 간격으로 다시 조회한다 (MEMBER-03-02)
  useEffect(() => {
    if (view.kind !== "waiting") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const next = await lookup(inviteToken, view.notice);
      if (!cancelled) setView(next);
    }, view.pollMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view, inviteToken]);

  switch (view.kind) {
    case "loading":
      return <p className="py-16 text-center text-sub">링크를 확인하고 있어요…</p>;
    case "register":
      return (
        <RegisterHostCard
          inviteToken={inviteToken}
          notice={view.notice}
          onRegistered={(record) => setView({ kind: "setup", record })}
          onConflict={() => reload("이미 다른 분이 이 링크로 약속을 만들고 있어요.")}
          onLinkGone={(kind) => setView({ kind })}
        />
      );
    case "waiting":
      return (
        <NoticeCard
          title="방장이 약속을 설정 중입니다"
          body={
            <>
              {view.notice && <p className="mb-1">{view.notice}</p>}
              <p>설정이 끝나면 이 화면이 자동으로 바뀌어요. 창을 닫지 말고 잠시 기다려 주세요.</p>
            </>
          }
        />
      );
    case "setup":
      return (
        <SetupForm
          inviteToken={inviteToken}
          record={view.record}
          onDone={(settings) => {
            removeStorage(storageKey);
            setView({ kind: "done", settings });
          }}
          onReset={(notice) => {
            removeStorage(storageKey);
            void reload(notice);
          }}
        />
      );
    case "done":
      return <DoneCard inviteToken={inviteToken} settings={view.settings} />;
    case "invalid":
      return <LinkProblem title="잘못된 링크" />;
    case "expired":
      return <LinkProblem title="만료된 링크" />;
    case "join":
      return (
        <NoticeCard
          title="참여 화면은 준비 중입니다"
          body="곧 이 링크로 약속에 참여하고 가능한 시간을 입력할 수 있어요."
        />
      );
    case "error":
      return (
        <NoticeCard
          title="링크를 확인하지 못했어요"
          body="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
          action={
            <button
              type="button"
              onClick={() => void reload()}
              className="h-11 w-full rounded-lg border border-line text-sm font-medium text-ink hover:bg-faint"
            >
              다시 시도
            </button>
          }
        />
      );
  }
}

// Figma 35:2666 "만료되거나 잘못된 링크" 문구
function LinkProblem({ title }: { title: string }) {
  return (
    <NoticeCard
      title={title}
      body="초대 링크를 다시 확인하거나 방장에게 새 링크를 요청해 주세요."
      action={
        <Link
          href="/"
          className="flex h-11 w-full items-center justify-center rounded-lg border border-line text-sm font-medium text-ink hover:bg-faint"
        >
          처음으로
        </Link>
      }
    />
  );
}
