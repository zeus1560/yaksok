"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, NoticeCard } from "@/components/common/ui";
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
import { ArrivedCard } from "@/components/participate/arrived-card";
import { ParticipantAuthCard } from "@/components/participate/participant-auth-card";
import { setupStorageKey } from "@/lib/create-promise/countdown";
import { decideInviteView, setupCountdownBase } from "@/lib/create-promise/invite-view";
import { BLOCKED_NOTICES, type BlockedReason } from "@/lib/participate/failure";

// /p/[inviteToken] 화면 분기 (MEMBER-API-01 화면 분기 표, DECISION_CONFLICTS R-15·R-17·R-18)
// 링크 조회 → promiseId가 있으면 /me(MEMBER-API-05)로 본인을 확인해 화면을 정한다
// 브라우저 저장소는 카운트다운의 경과 시간 기준값으로만 쓰고 방장 여부 판단에는 쓰지 않는다
// 등록 전 사람에게는 약속 설정 값을 보여 주지 않는다(MEMBER-08-01). 그래서 다른 API를 부르지 않는다

type View =
  | { kind: "loading" }
  | { kind: "register"; notice: string | null }
  | { kind: "waiting"; promiseId: string | null; pollMs: number; notice: string | null }
  // localExpiresAt이 null이면 이 기기에 기준값이 없다(다른 기기·저장소 삭제) — 카운트다운을 숨긴다
  | { kind: "setup"; promiseId: string; localExpiresAt: number | null }
  | { kind: "done"; settings: StartedSettings }
  | { kind: "join"; promiseId: string }
  | { kind: "arrived"; promiseId: string; me: MyParticipation }
  | { kind: "closed"; promiseId: string }
  | { kind: "cancelled" }
  | { kind: "blocked"; promiseId: string; reason: BlockedReason }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "error" };

async function fetchMe(promiseId: string): Promise<MyParticipation | null> {
  const result = await callApi<MyParticipation>(
    `/api/v1/promises/${encodeURIComponent(promiseId)}/me`,
  );
  return result.ok ? result.data : null;
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
  const outcome = promiseId ? (me ? { ok: true as const, ...me } : { ok: false as const }) : null;

  switch (decideInviteView(nextAction, outcome)) {
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
      return {
        kind: "waiting",
        promiseId,
        pollMs: pollAfterMs ?? DRAFT_POLL_FALLBACK_MS,
        notice,
      };
    case "join":
      return { kind: "join", promiseId: promiseId as string };
    case "arrived":
      return { kind: "arrived", promiseId: promiseId as string, me: me as MyParticipation };
    case "closed":
      return { kind: "closed", promiseId: promiseId as string };
    case "cancelled":
      return { kind: "cancelled" };
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

  // 등록·로그인 성공: 세션 쿠키를 받았으므로 링크 조회 + /me로 다음 화면을 정한다
  // 방장이 draft에서 로그인했으면 설정 화면(카운트다운은 같은 promiseId의 저장값이 있을 때만)
  const afterAuth = () => void reload();
  const onBlocked = (promiseId: string) => (reason: BlockedReason) =>
    setView({ kind: "blocked", promiseId, reason });

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
        <WaitingView
          promiseId={view.promiseId}
          notice={view.notice}
          onAuthenticated={afterAuth}
          onReload={afterAuth}
          onBlocked={view.promiseId ? onBlocked(view.promiseId) : () => void reload()}
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
      // 완료 → 내 가능 시간 입력: 링크 조회 + /me로 도착(입력) 화면을 연다
      return (
        <DoneCard inviteToken={inviteToken} settings={view.settings} onStartInput={afterAuth} />
      );
    case "join":
      return (
        <ParticipantAuthCard
          promiseId={view.promiseId}
          initialMode="register"
          allowRegister
          onAuthenticated={afterAuth}
          onReload={afterAuth}
          onBlocked={onBlocked(view.promiseId)}
        />
      );
    case "arrived":
      // key: 다른 약속·참여자로 바뀌면 입력 상태를 새로 시작한다
      return (
        <ArrivedCard
          key={`${view.promiseId}:${view.me.participantId}`}
          promiseId={view.promiseId}
          me={view.me}
          onRelink={afterAuth}
        />
      );
    case "closed":
      return (
        <LoginBehindNotice
          promiseId={view.promiseId}
          title="응답이 마감된 약속이에요"
          body="참여자라면 로그인해서 내 참여 정보를 볼 수 있어요."
          onAuthenticated={afterAuth}
          onBlocked={onBlocked(view.promiseId)}
        />
      );
    case "cancelled":
      return <NoticeCard title="취소된 약속이에요" body="방장이 이 약속을 취소했어요." />;
    case "blocked": {
      const notice = BLOCKED_NOTICES[view.reason];
      // 마감 뒤에는 새로 참여할 수 없지만 기존 참여자는 로그인할 수 있다
      if (view.reason === "deadline_passed") {
        return (
          <LoginBehindNotice
            promiseId={view.promiseId}
            title={notice.title}
            body={notice.body}
            onAuthenticated={afterAuth}
            onBlocked={onBlocked(view.promiseId)}
          />
        );
      }
      return <NoticeCard title={notice.title} body={notice.body} />;
    }
    case "invalid":
      return <LinkProblem title="잘못된 링크" />;
    case "expired":
      return <LinkProblem title="만료된 링크" />;
    case "error":
      return (
        <NoticeCard
          title="링크를 확인하지 못했어요"
          body="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              다시 시도
            </Button>
          }
        />
      );
  }
}

// 설정 중 대기 (MEMBER-03-01·03-02). 방장 등록 응답을 못 받은 방장이 로그인으로 복구한다(009에서 넘긴 409 복구)
// 폴링으로 view가 바뀌어도 같은 위치의 같은 컴포넌트라 로그인 입력 상태가 유지된다
function WaitingView(props: {
  promiseId: string | null;
  notice: string | null;
  onAuthenticated: () => void;
  onReload: () => void;
  onBlocked: (reason: BlockedReason) => void;
}) {
  const [login, setLogin] = useState(false);
  if (login && props.promiseId) {
    return (
      <ParticipantAuthCard
        promiseId={props.promiseId}
        initialMode="login"
        allowRegister={false}
        title="방장이신가요?"
        intro="약속을 만들 때 쓴 닉네임과 PIN으로 로그인하면 설정을 이어서 할 수 있어요."
        onAuthenticated={props.onAuthenticated}
        onReload={props.onReload}
        onBlocked={props.onBlocked}
        onBack={() => setLogin(false)}
      />
    );
  }
  return (
    <NoticeCard
      title="방장이 약속을 설정 중입니다"
      body={
        <>
          {props.notice && <p className="mb-1">{props.notice}</p>}
          <p>설정이 끝나면 이 화면이 자동으로 바뀌어요. 창을 닫지 말고 잠시 기다려 주세요.</p>
        </>
      }
      action={
        props.promiseId && (
          <button
            type="button"
            onClick={() => setLogin(true)}
            className="w-full text-center text-sm text-sub underline underline-offset-2 hover:text-ink"
          >
            방장이신가요? 로그인
          </button>
        )
      }
    />
  );
}

// 안내 + 로그인 진입점 (마감된 약속, 마감 뒤 등록 시도). 새 참여는 열지 않는다
function LoginBehindNotice(props: {
  promiseId: string;
  title: string;
  body: string;
  onAuthenticated: () => void;
  onBlocked: (reason: BlockedReason) => void;
}) {
  const [login, setLogin] = useState(false);
  if (login) {
    return (
      <ParticipantAuthCard
        promiseId={props.promiseId}
        initialMode="login"
        allowRegister={false}
        onAuthenticated={props.onAuthenticated}
        onReload={props.onAuthenticated}
        onBlocked={props.onBlocked}
        onBack={() => setLogin(false)}
      />
    );
  }
  return (
    <NoticeCard
      title={props.title}
      body={props.body}
      action={
        <Button variant="secondary" onClick={() => setLogin(true)}>
          이미 참여했다면 로그인
        </Button>
      }
    />
  );
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
