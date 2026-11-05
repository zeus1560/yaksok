"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NoticeCard } from "@/components/common/ui";
import {
  callApi,
  readStorage,
  removeStorage,
  type LinkStatus,
  type MyParticipation,
  type StartedSettings,
} from "@/components/create-promise/api";
import { DoneCard } from "@/components/create-promise/done-card";
import { RegisterHostCard } from "@/components/create-promise/register-host-card";
import { SetupForm } from "@/components/create-promise/setup-form";
import { DRAFT_POLL_FALLBACK_MS } from "@/components/create-promise/constants";
import { setupStorageKey } from "@/lib/create-promise/countdown";
import {
  decideInviteView,
  setupCountdownBase,
  type MeOutcome,
} from "@/lib/create-promise/invite-view";

// /p/[inviteToken] 화면 분기 (MEMBER-API-01 화면 분기 표, DECISION_CONFLICTS R-15·R-17)
// 링크 조회 → promiseId가 있으면 /me(MEMBER-API-05)로 본인을 확인해 화면을 정한다
// 브라우저 저장소는 카운트다운의 경과 시간 기준값으로만 쓰고 방장 여부 판단에는 쓰지 않는다

type View =
  | { kind: "loading" }
  | { kind: "register"; notice: string | null }
  | { kind: "waiting"; pollMs: number; notice: string | null }
  // localExpiresAt이 null이면 이 기기에 기준값이 없다(다른 기기·저장소 삭제) — 카운트다운을 숨긴다
  | { kind: "setup"; promiseId: string; localExpiresAt: number | null }
  | { kind: "done"; settings: StartedSettings }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "join" }
  | { kind: "error" };

async function fetchMe(promiseId: string): Promise<MeOutcome> {
  const result = await callApi<MyParticipation>(
    `/api/v1/promises/${encodeURIComponent(promiseId)}/me`,
  );
  return result.ok
    ? { ok: true, role: result.data.role, promiseStatus: result.data.promiseStatus }
    : { ok: false };
}

async function lookup(inviteToken: string, notice: string | null = null): Promise<View> {
  const storageKey = setupStorageKey(inviteToken);
  const result = await callApi<LinkStatus>(`/api/v1/links/${encodeURIComponent(inviteToken)}`);
  if (!result.ok) {
    if (result.status === 404) return { kind: "invalid" };
    if (result.status === 410) return { kind: "expired" };
    return { kind: "error" };
  }
  const { promiseId, nextAction, pollAfterMs } = result.data;
  const me = promiseId ? await fetchMe(promiseId) : null;

  switch (decideInviteView(nextAction, me)) {
    case "setup": {
      // decideInviteView가 setup을 고르면 promiseId가 있다
      const id = promiseId as string;
      const localExpiresAt = setupCountdownBase(readStorage(storageKey), id, Date.now());
      if (localExpiresAt === null) removeStorage(storageKey);
      return { kind: "setup", promiseId: id, localExpiresAt };
    }
    case "register":
      // 링크가 다시 비었다(만료 draft 포함). 이전 약속의 기준값은 쓸 일이 없다
      removeStorage(storageKey);
      return { kind: "register", notice };
    case "waiting":
      // /me 일시 오류일 수 있어 기준값을 지우지 않는다. 다음 폴링에서 방장으로 확인되면 카운트다운을 이어 쓴다
      return { kind: "waiting", pollMs: pollAfterMs ?? DRAFT_POLL_FALLBACK_MS, notice };
    case "join":
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

  // 첫 진입: 링크 조회와 /me로 화면을 정한다
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await lookup(inviteToken);
      if (!cancelled) setView(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

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
          onRegistered={(record) =>
            setView({
              kind: "setup",
              promiseId: record.promiseId,
              localExpiresAt: record.localExpiresAt,
            })
          }
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
          promiseId={view.promiseId}
          localExpiresAt={view.localExpiresAt}
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
