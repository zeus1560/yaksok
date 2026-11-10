"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AvailabilityBoard } from "@/components/availability/availability-board";
import { Button } from "@/components/common/ui";
import { callApi, type MyParticipation } from "@/components/create-promise/api";
import { HostMenu } from "@/components/manage/host-menu";
import { ParticipantListPanel } from "@/components/manage/participant-list";
import { decidePoll } from "@/lib/availability/poll";
import { classifyListFailure, type ManageAction } from "@/lib/manage/failure";
import type { PromiseSettings } from "@/lib/manage/settings-form";
import { pollDelay } from "@/lib/result/poll-delay";
import type { RoomAction } from "@/lib/result/failure";
import { canManage, decideRoomView, type RoomDetail } from "@/lib/result/view";
import { CandidatesPanel } from "./candidates-panel";
import {
  fetchTimed,
  promisePath,
  type ParticipantList,
  type PromiseDetail,
  type Timed,
} from "./api-types";
import { ResultPanel } from "./result-panel";

// 참여 뒤 화면 (018). 상태 조회(STATE-API-01)를 SWR로 5초 폴링해 시간 입력·후보·결과 화면을 고른다
// - 방장이 마감·확정하면 다른 참여자 화면도 다음 폴링에서 바뀐다
// - 탭이 숨겨지면 멈추고 돌아오면 바로 조회한다. 일시 실패는 마지막 성공 값을 유지한다(012와 같은 방식, R-19)
// - 버튼 표시는 /me의 role·permissions. /me의 deadlinePassed는 쓰지 않는다(조기 마감에서 false)
// - 027: 화면 위쪽에 방장 메뉴(마감·설정 변경·재조율·취소)와 참여자 명단(MEMBER-API-06, 같은 간격 폴링)을 둔다

const POLL_MS = 5000;
const FORBIDDEN_NOTICE = "방장 권한이 없어 요청하지 못했어요. 최신 정보로 다시 불러왔어요.";

export function PromiseRoom({
  promiseId,
  inviteToken,
  me: initialMe,
  onRelink: onRelinkProp,
}: {
  promiseId: string;
  inviteToken: string;
  me: MyParticipation;
  onRelink: () => void;
}) {
  const [me, setMe] = useState(initialMe);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [settings, setSettings] = useState<PromiseSettings | null>(null);
  const [list, setList] = useState<ParticipantList | null>(null);
  const [listUnstable, setListUnstable] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showEveryone, setShowEveryone] = useState(false);
  // 마감·확정 결과를 반영한 시각. 그보다 먼저 시작한 폴링 응답은 낡았으므로 버린다
  const lastWriteRef = useRef(0);
  // 상위가 렌더마다 새 함수를 넘겨도 하위 효과가 다시 돌지 않게 하고, 링크 재조회는 한 번만 부른다
  const onRelinkRef = useRef(onRelinkProp);
  const relinkedRef = useRef(false);
  useEffect(() => {
    // 상위가 다시 그려졌다 = 앞선 링크 재조회가 끝났다. 다음 재조회를 다시 허용한다
    onRelinkRef.current = onRelinkProp;
    relinkedRef.current = false;
  }, [onRelinkProp]);
  const onRelink = useCallback(() => {
    if (relinkedRef.current) return;
    relinkedRef.current = true;
    onRelinkRef.current();
  }, []);

  const { mutate } = useSWR(promisePath(promiseId), fetchTimed<PromiseDetail>, {
    refreshInterval: (latest?: Timed<PromiseDetail>) =>
      latest ? pollDelay(latest.finishedAt - latest.startedAt, POLL_MS) : POLL_MS,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    focusThrottleInterval: 1000,
    dedupingInterval: 1000,
    shouldRetryOnError: false,
    onSuccess: ({ result, startedAt }: Timed<PromiseDetail>) => {
      const outcome = decidePoll(result, {
        startedAt,
        lastWriteAt: lastWriteRef.current,
        dragging: false,
        submitting: false,
      });
      if (outcome.kind === "stale") return;
      if (outcome.kind === "relink") {
        onRelink();
        return;
      }
      if (outcome.kind === "keep_last") {
        setOffline(true);
        return;
      }
      setOffline(false);
      if (outcome.kind === "apply" || outcome.kind === "defer") {
        setDetail({
          promiseStatus: outcome.data.promiseStatus,
          currentConfirmation: outcome.data.currentConfirmation,
        });
        setSettings(outcome.data.settings);
      }
    },
  });

  // 참여자 명단. 상태 조회와 같은 간격으로 다시 조회한다(탭 숨김 중지). 일시 실패는 마지막 명단을 유지한다
  const { mutate: mutateList } = useSWR(
    promisePath(promiseId, "/participants"),
    fetchTimed<ParticipantList>,
    {
      refreshInterval: (latest?: Timed<ParticipantList>) =>
        latest ? pollDelay(latest.finishedAt - latest.startedAt, POLL_MS) : POLL_MS,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      revalidateOnFocus: true,
      focusThrottleInterval: 1000,
      dedupingInterval: 1000,
      shouldRetryOnError: false,
      onSuccess: ({ result }: Timed<ParticipantList>) => {
        if (result.ok) {
          setList(result.data);
          setListUnstable(false);
          return;
        }
        if (classifyListFailure(result).kind === "relink") onRelink();
        else setListUnstable(true);
      },
    },
  );

  const refetchStatus = useCallback(() => {
    lastWriteRef.current = performance.now();
    void mutate();
  }, [mutate]);

  const refetchMe = useCallback(async () => {
    const result = await callApi<MyParticipation>(promisePath(promiseId, "/me"));
    if (!result.ok) {
      onRelink();
      return;
    }
    setMe(result.data);
    setNotice(FORBIDDEN_NOTICE);
    refetchStatus();
  }, [promiseId, onRelink, refetchStatus]);

  const onAction = useCallback(
    (action: RoomAction) => {
      switch (action.kind) {
        case "refetch_status":
          refetchStatus();
          return;
        case "refetch_me":
          void refetchMe();
          return;
        case "relink":
          onRelink();
          return;
        default:
          // retry·refetch_candidates는 각 패널이 처리한다
          return;
      }
    },
    [refetchStatus, refetchMe, onRelink],
  );

  // 방장 관리(027) 실패·결과 처리. 입력란 안내·다시 시도는 각 패널이 처리한다
  const onManage = useCallback(
    (action: ManageAction) => {
      switch (action.kind) {
        case "done":
          // 취소 성공(또는 이미 취소됨). 링크 재조회로 취소 안내에 간다
          onRelink();
          return;
        case "refetch":
          setNotice(action.notice);
          refetchStatus();
          void mutateList();
          return;
        case "field":
          if (action.refetch === "status") refetchStatus();
          if (action.refetch === "list") void mutateList();
          return;
        case "refetch_me":
          void refetchMe();
          return;
        case "relink":
          onRelink();
          return;
        default:
          return;
      }
    },
    [onRelink, refetchStatus, mutateList, refetchMe],
  );

  // 설정 변경·재조율 200. 재조율은 서버가 collecting을 돌려줬으므로 바로 시간 입력 화면으로 바꾸고 상태 조회로 맞춘다
  const onSaved = useCallback(
    (message: string, promiseStatus: string) => {
      setSaved(message);
      setNotice(null);
      lastWriteRef.current = performance.now();
      setDetail((current) =>
        current && promiseStatus === "collecting"
          ? { ...current, promiseStatus, currentConfirmation: null }
          : current,
      );
      void mutate();
      void mutateList();
    },
    [mutate, mutateList],
  );

  // 내보내기 200(이미 내보낸 대상 포함): 명단과 상태를 다시 조회한다
  const onRemoved = useCallback(() => {
    void mutateList();
    refetchStatus();
  }, [mutateList, refetchStatus]);

  // 마감 200: 서버가 closed를 돌려줬으므로 바로 후보 화면으로 바꾸고, 상태 조회로 맞춘다
  const onClosed = useCallback(() => {
    lastWriteRef.current = performance.now();
    setDetail((current) =>
      current ? { ...current, promiseStatus: "closed", currentConfirmation: null } : current,
    );
    void mutate();
  }, [mutate]);

  const view = decideRoomView(detail, me);

  useEffect(() => {
    if (view.kind === "relink") onRelink();
  }, [view.kind, onRelink]);

  const banner = (
    <div aria-live="polite" className="mx-auto mb-4 max-w-5xl space-y-2 empty:hidden">
      {saved && (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-blue-soft px-4 py-3 text-sm text-ink">
          <span>{saved}</span>
          <button
            type="button"
            aria-label="저장 안내 닫기"
            className="shrink-0 opacity-70 hover:opacity-100"
            onClick={() => setSaved(null)}
          >
            ✕
          </button>
        </div>
      )}
      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="안내 닫기"
            className="shrink-0 opacity-70 hover:opacity-100"
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      )}
      {offline && (
        <p className="rounded-lg bg-faint px-4 py-2 text-sm text-sub">
          연결이 불안정해요. 다시 연결되면 자동으로 갱신돼요.
        </p>
      )}
    </div>
  );

  // 화면 위쪽: 방장 메뉴(현재 방장만) → 참여자 명단(모두). 내보내기는 방장·모집 중(마감 전)만
  const manager = canManage(me);
  const top = (
    <>
      {banner}
      {manager && detail && settings && (
        <HostMenu
          promiseId={promiseId}
          promiseStatus={detail.promiseStatus}
          settings={settings}
          activeCount={list?.currentParticipantCount ?? 0}
          onClosed={onClosed}
          onRoomAction={onAction}
          onManageAction={onManage}
          onSaved={onSaved}
        />
      )}
      <ParticipantListPanel
        promiseId={promiseId}
        list={list}
        unstable={listUnstable}
        canRemove={manager && view.kind === "input"}
        onRemoved={onRemoved}
        onAction={onManage}
      />
    </>
  );

  switch (view.kind) {
    case "loading":
    case "relink":
      return (
        <p role="status" className="py-16 text-center text-sub">
          {offline
            ? "약속 정보를 불러오지 못했어요. 다시 연결되면 자동으로 불러와요."
            : "약속 정보를 불러오고 있어요…"}
        </p>
      );
    case "input":
      return (
        <>
          {top}
          <AvailabilityBoard promiseId={promiseId} me={me} onRelink={onRelink} />
        </>
      );
    case "candidates":
      return (
        <>
          {top}
          <CandidatesPanel
            promiseId={promiseId}
            canConfirm={view.canConfirm}
            onConfirmed={refetchStatus}
            onAction={onAction}
          />
          <Everyone
            open={showEveryone}
            onToggle={() => setShowEveryone((v) => !v)}
            promiseId={promiseId}
            me={me}
            onRelink={onRelink}
          />
        </>
      );
    case "result":
      return (
        <>
          {top}
          <ResultPanel
            confirmation={view.confirmation}
            showHostWarning={view.showHostWarning}
            inviteToken={inviteToken}
          />
          <Everyone
            open={showEveryone}
            onToggle={() => setShowEveryone((v) => !v)}
            promiseId={promiseId}
            me={me}
            onRelink={onRelink}
          />
        </>
      );
  }
}

// closed·confirmed에서 기존 그리드를 읽기 전용으로 본다. 보드가 TIME-API-02의 closed·confirmed를 보고 입력을 막는다
function Everyone({
  open,
  onToggle,
  promiseId,
  me,
  onRelink,
}: {
  open: boolean;
  onToggle: () => void;
  promiseId: string;
  me: MyParticipation;
  onRelink: () => void;
}) {
  return (
    <div className="mx-auto mt-4 max-w-5xl">
      <div className="mx-auto max-w-xs">
        <Button variant="secondary" aria-expanded={open} onClick={onToggle}>
          {open ? "모두의 시간 접기" : "모두의 시간 보기"}
        </Button>
      </div>
      {open && (
        <div className="mt-4">
          <AvailabilityBoard promiseId={promiseId} me={me} onRelink={onRelink} initialTab="all" />
        </div>
      )}
    </div>
  );
}
