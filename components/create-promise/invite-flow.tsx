"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Identity } from "@/components/common/identity";
import { Button, LinkButton, NoticeCard } from "@/components/common/ui";
import {
  callApi,
  readStorage,
  removeStorage,
  storageKeys,
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
import { promiseStorageKeys } from "@/lib/leave/storage";
import { decideInviteView, setupCountdownBase } from "@/lib/create-promise/invite-view";
import { BLOCKED_NOTICES, type BlockedReason } from "@/lib/participate/failure";
import type { AuthMode } from "@/components/participate/participant-auth-card";

// /p/[inviteToken] 화면 분기 (MEMBER-API-01 화면 분기 표, DECISION_CONFLICTS R-15·R-17·R-18)
// 링크 조회 → promiseId가 있으면 /me(MEMBER-API-05)로 본인을 확인해 화면을 정한다
// 브라우저 저장소는 카운트다운의 경과 시간 기준값으로만 쓰고 방장 여부 판단에는 쓰지 않는다
// 등록 전 사람에게는 약속 설정 값을 보여 주지 않는다(MEMBER-08-01). 그래서 다른 API를 부르지 않는다

type View =
  | { kind: "loading" }
  | { kind: "register"; notice: string | null }
  | { kind: "waiting"; promiseId: string | null; pollMs: number; notice: string | null }
  // localExpiresAt이 null이면 이 기기에 기준값이 없다(다른 기기·저장소 삭제) — 카운트다운을 숨긴다
  // identity: 헤더 "닉네임 · 방장"(029 G-2). /me 또는 방금 등록한 닉네임
  | { kind: "setup"; promiseId: string; localExpiresAt: number | null; identity: Identity }
  | { kind: "done"; settings: StartedSettings; identity: Identity }
  // notice·mode: 나가기·로그아웃 뒤(028) 안내와 첫 화면(로그아웃은 로그인)
  | { kind: "join"; promiseId: string; notice: string | null; mode: AuthMode }
  | { kind: "arrived"; promiseId: string; me: MyParticipation }
  | { kind: "closed"; promiseId: string; notice: string | null }
  | { kind: "cancelled"; notice: string | null }
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

async function lookup(
  inviteToken: string,
  notice: string | null = null,
  mode: AuthMode = "register",
): Promise<View> {
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
      const identity = me ? { nickname: me.nickname, role: me.role } : null;
      return { kind: "setup", promiseId: id, localExpiresAt, identity };
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
      return { kind: "join", promiseId: promiseId as string, notice, mode };
    case "arrived":
      return { kind: "arrived", promiseId: promiseId as string, me: me as MyParticipation };
    case "closed":
      return { kind: "closed", promiseId: promiseId as string, notice };
    case "cancelled":
      return { kind: "cancelled", notice };
  }
}

export function InviteFlow({ inviteToken }: { inviteToken: string }) {
  const storageKey = setupStorageKey(inviteToken);
  const [view, setView] = useState<View>({ kind: "loading" });

  // 재조회가 겹치면 마지막에 시작한 결과만 반영한다(예: 폴링 401 재조회가 나가기 뒤 안내 화면을 덮지 않게)
  const lookupSeqRef = useRef(0);
  // 나가기·로그아웃 처리 중에는 참여 화면이 보내는 일반 재조회(폴링 401 등)를 무시한다
  const exitingRef = useRef(false);

  const reload = useCallback(
    async (notice: string | null = null) => {
      if (exitingRef.current) return;
      const seq = ++lookupSeqRef.current;
      const next = await lookup(inviteToken, notice);
      if (seq === lookupSeqRef.current) setView(next);
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

  // 나가기·로그아웃 완료(028): 참여 화면을 먼저 내려 폴링을 멈추고, 이 약속의 저장값(제출 전 입력·카운트다운 기준값)을
  // 지운 뒤 링크를 다시 조회한다. 내리기 직전에 끝난 조회가 입력을 다시 쓸 수 있어 조회 뒤에 한 번 더 지운다
  const exit = useCallback(
    async (promiseId: string, notice: string, mode: AuthMode) => {
      const clear = () => {
        for (const key of promiseStorageKeys(storageKeys(), promiseId, inviteToken)) {
          removeStorage(key);
        }
      };
      exitingRef.current = true;
      const seq = ++lookupSeqRef.current;
      setView({ kind: "loading" });
      clear();
      const next = await lookup(inviteToken, notice, mode);
      clear();
      exitingRef.current = false;
      if (seq === lookupSeqRef.current) setView(next);
    },
    [inviteToken],
  );

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
          onRegistered={(record, nickname) =>
            setView({
              kind: "setup",
              promiseId: record.promiseId,
              localExpiresAt: record.localExpiresAt,
              identity: { nickname, role: "host" },
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
          identity={view.identity}
          localExpiresAt={view.localExpiresAt}
          onDone={(settings) => {
            removeStorage(storageKey);
            setView({ kind: "done", settings, identity: view.identity });
          }}
          onReset={(notice) => {
            removeStorage(storageKey);
            void reload(notice);
          }}
          onLeft={(notice) => void exit(view.promiseId, notice, "register")}
        />
      );
    case "done":
      // 완료 → 내 가능 시간 입력: 링크 조회 + /me로 도착(입력) 화면을 연다
      return (
        <DoneCard
          inviteToken={inviteToken}
          settings={view.settings}
          identity={view.identity}
          onStartInput={afterAuth}
        />
      );
    case "join":
      return (
        <ParticipantAuthCard
          // 같은 약속에서 나간 뒤 다시 그려도 안내·모드를 새로 적용한다
          key={`${view.promiseId}:${view.mode}:${view.notice ?? ""}`}
          promiseId={view.promiseId}
          initialMode={view.mode}
          intro={view.notice ?? undefined}
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
          inviteToken={inviteToken}
          me={view.me}
          onRelink={afterAuth}
          onExit={(notice, mode) => void exit(view.promiseId, notice, mode)}
        />
      );
    case "closed":
      return (
        <LoginBehindNotice
          promiseId={view.promiseId}
          title="응답이 마감된 약속이에요"
          body={`${view.notice ? `${view.notice} ` : ""}참여자라면 로그인해서 내 참여 정보를 볼 수 있어요.`}
          onAuthenticated={afterAuth}
          onBlocked={onBlocked(view.promiseId)}
        />
      );
    case "cancelled":
      return (
        <NoticeCard
          title="취소된 약속이에요"
          body={view.notice ?? "방장이 이 약속을 취소했어요."}
          action={<LinkButton href="/">새 약속 만들기</LinkButton>}
        />
      );
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
      return <LinkProblem body="링크 주소를 다시 확인하거나 방장에게 새 링크를 요청해 주세요." />;
    case "expired":
      return <LinkProblem body="사용 기간이 지난 링크예요. 방장에게 새 링크를 요청해 주세요." />;
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
          <Button variant="secondary" onClick={() => setLogin(true)}>
            방장이신가요? 로그인
          </Button>
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

// Figma 22 "만료되거나 잘못된 링크". 제목은 같고 설명으로 404·410을 구분한다
function LinkProblem({ body }: { body: string }) {
  return (
    <NoticeCard
      title="만료되거나 잘못된 링크"
      body={body}
      action={<LinkButton href="/">처음으로</LinkButton>}
    />
  );
}
