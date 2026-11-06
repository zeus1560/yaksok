"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/common/ui";
import {
  callApi,
  readStorage,
  removeStorage,
  writeStorage,
  type ApiResult,
  type MyParticipation,
} from "@/components/create-promise/api";
import { formatDateRange, formatDuration } from "@/lib/create-promise/format";
import { classifySubmitFailure, NOTICES } from "@/lib/availability/failure";
import { decidePoll } from "@/lib/availability/poll";
import {
  decideDraft,
  draftStorageKey,
  estimateServerNow,
  formatRemaining,
  formatSeoulDateTime,
  nextDraft,
  parseDraft,
  parseSlotList,
  serializeDraft,
  submissionState,
  SUBMISSION_LABELS,
  toSlotStrings,
  type LocalDraft,
  type ServerMe,
} from "@/lib/availability/sync";
import { EveryoneGrid } from "./everyone-grid";
import { MyGrid } from "./my-grid";
import {
  toSnapshot,
  withMe,
  type AvailabilityResponse,
  type Snapshot,
  type SubmitResponse,
} from "./snapshot";

// 가능 시간 입력 화면 (TIME-API-01·02, TIME-10-04, DECISION_CONFLICTS R-19)
// - 폴링은 SWR 주기 조회(5초). 탭이 숨겨지면 멈추고 돌아오면 바로 조회한다. 마감 뒤에도 계속한다
// - fetcher는 예외를 던지지 않는다. SWR은 에러 상태에서 주기 조회를 멈추므로, 실패도 결과 값으로 받아 분기한다
// - 드래그·제출 중에는 조회를 멈추고, 그사이 도착한 응답은 드래그가 끝난 뒤 반영한다(제출 중 응답은 버린다)
// - 지난 칸·남은 시간은 serverTime + 받은 뒤 흐른 시간(단조 시계) 기준이다

const POLL_MS = 5000;
const CLOCK_TICK_MS = 15_000;

type Polled = { result: ApiResult<AvailabilityResponse>; startedAt: number; receivedAt: number };

async function fetchAvailability(path: string): Promise<Polled> {
  const startedAt = performance.now();
  const result = await callApi<AvailabilityResponse>(path);
  return { result, startedAt, receivedAt: performance.now() };
}

type Notice = { tone: "info" | "warn"; text: string };

export function AvailabilityBoard({
  promiseId,
  me: myInfo,
  onRelink,
}: {
  promiseId: string;
  me: MyParticipation;
  onRelink: () => void;
}) {
  const path = `/api/v1/promises/${encodeURIComponent(promiseId)}/availability`;
  const storageKey = draftStorageKey(promiseId, myInfo.participantId);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraftState] = useState<LocalDraft | null>(() => {
    const raw = readStorage(storageKey);
    const parsed = parseDraft(raw);
    if (raw !== null && !parsed) removeStorage(storageKey);
    return parsed;
  });
  const [nowMs, setNowMs] = useState(0);
  const [tab, setTab] = useState<"mine" | "all">("mine");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [offline, setOffline] = useState(false);

  // SWR 콜백·이벤트 처리기에서 최신 값을 읽기 위한 참조. 렌더 중에는 읽지 않는다
  const draftRef = useRef<LocalDraft | null>(draft);
  const draggingRef = useRef(false);
  const submittingRef = useRef(false);
  const pendingRef = useRef<Snapshot | null>(null);
  const lastWriteRef = useRef(0); // 제출 결과를 반영한 시각. 그 전에 시작한 조회 응답은 낡았다

  const setDraft = useCallback(
    (next: LocalDraft | null) => {
      draftRef.current = next;
      setDraftState(next);
      if (next) writeStorage(storageKey, serializeDraft(next));
      else removeStorage(storageKey);
    },
    [storageKey],
  );

  // 서버 응답 반영: 로컬 입력과 버전을 비교한다 (TIME-10-04)
  const applyServer = useCallback(
    (next: Snapshot) => {
      const now = estimateServerNow(next.serverTimeMs, next.receivedAt, performance.now());
      const decision = decideDraft(draftRef.current, next.me, next.status, now);
      if (decision.kind === "drop") {
        setDraft(null);
        if (decision.reason === "changed")
          setNotice({ tone: "warn", text: NOTICES.changedElsewhere });
        if (decision.reason === "closed") setNotice({ tone: "warn", text: NOTICES.closedUnsaved });
      }
      setSnapshot(next);
      setNowMs(now);
    },
    [setDraft],
  );

  const { mutate } = useSWR(path, fetchAvailability, {
    refreshInterval: POLL_MS,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    focusThrottleInterval: 1000,
    dedupingInterval: 1000,
    shouldRetryOnError: false,
    isPaused: () => draggingRef.current || submittingRef.current,
    onSuccess: ({ result, startedAt, receivedAt }) => {
      const outcome = decidePoll(result, {
        startedAt,
        lastWriteAt: lastWriteRef.current,
        dragging: draggingRef.current,
        submitting: submittingRef.current,
      });
      if (outcome.kind === "stale") return;
      if (outcome.kind === "relink") {
        onRelink();
        return;
      }
      if (outcome.kind === "keep_last") {
        // 마지막 성공 응답과 로컬 입력을 그대로 둔다
        setOffline(true);
        return;
      }
      setOffline(false);
      if (outcome.kind === "skip") return;
      const next = toSnapshot(outcome.data, receivedAt);
      if (outcome.kind === "defer") {
        pendingRef.current = next;
        return;
      }
      applyServer(next);
    },
  });

  // 지난 칸 판정용 서버 시각을 주기적으로 갱신한다
  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setInterval(() => {
      setNowMs(estimateServerNow(snapshot.serverTimeMs, snapshot.receivedAt, performance.now()));
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  const onDragActive = useCallback(
    (active: boolean) => {
      draggingRef.current = active;
      if (!active && pendingRef.current) {
        const pending = pendingRef.current;
        pendingRef.current = null;
        // 드래그 결과(onCommit)가 먼저 로컬 입력에 반영된 뒤 서버 응답을 비교한다
        queueMicrotask(() => applyServer(pending));
      }
    },
    [applyServer],
  );

  const serverSlots = snapshot?.me.slots;
  const selection = useMemo(() => new Set(draft?.slots ?? serverSlots ?? []), [draft, serverSlots]);

  const onCommit = useCallback(
    (next: Set<number>) => {
      if (!snapshot) return;
      setDraft(nextDraft(draftRef.current, next, snapshot.me));
      setSubmitError(null);
      setConfirmEmpty(false);
    },
    [snapshot, setDraft],
  );

  const revalidate = useCallback(() => void mutate(), [mutate]);

  if (!snapshot) {
    return (
      <p role="status" className="py-16 text-center text-sub">
        {offline
          ? "가능 시간을 불러오지 못했어요. 다시 연결되면 자동으로 불러와요."
          : "가능 시간을 불러오고 있어요…"}
      </p>
    );
  }

  const readOnly = snapshot.status !== "collecting";
  const dirty = draft !== null;
  const state = submissionState(snapshot.me.submitted, dirty);
  const futureCount = [...selection].filter((ms) => ms > nowMs).length;

  function applyMe(me: ServerMe) {
    lastWriteRef.current = performance.now();
    pendingRef.current = null;
    setSnapshot((current) => (current ? withMe(current, me) : current));
  }

  async function submit(confirmed: boolean) {
    if (!snapshot || readOnly || submittingRef.current) return;
    if (futureCount === 0 && !confirmed) {
      setConfirmEmpty(true);
      return;
    }
    setConfirmEmpty(false);
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setNotice(null);

    const baseVersion = draftRef.current?.baseVersion ?? snapshot.me.version;
    const result = await callApi<SubmitResponse>(
      `/api/v1/promises/${encodeURIComponent(promiseId)}/me/availability`,
      { method: "PUT", body: { baseVersion, slots: toSlotStrings(selection) } },
    );
    submittingRef.current = false;
    setSubmitting(false);

    if (result.ok) {
      applyMe({
        version: result.data.version,
        submitted: true,
        slots: parseSlotList(result.data.slots),
      });
      setDraft(null);
      setNotice(
        result.data.droppedSlotCount > 0
          ? { tone: "warn", text: NOTICES.dropped }
          : { tone: "info", text: NOTICES.submitted },
      );
      return;
    }

    const action = classifySubmitFailure(result);
    switch (action.kind) {
      case "conflict":
        // 다시 조회하지 않고 details로 다시 그린다
        applyMe({ version: action.version, submitted: action.submitted, slots: action.slots });
        setDraft(null);
        setNotice({ tone: "warn", text: NOTICES.conflict });
        return;
      case "refetch":
        setDraft(null);
        setNotice({ tone: "warn", text: NOTICES.conflict });
        void mutate();
        return;
      case "closed":
        lastWriteRef.current = performance.now();
        setSnapshot((current) => (current ? { ...current, status: "closed" } : current));
        if (draftRef.current) setNotice({ tone: "warn", text: NOTICES.closedUnsaved });
        setDraft(null);
        void mutate(); // 마감·확정 중 실제 상태를 받아 온다
        return;
      case "relink":
        onRelink();
        return;
      case "retry":
        setSubmitError(action.message);
        return;
    }
  }

  const { settings } = snapshot;
  const isHost = myInfo.role === "host";

  return (
    <div className={`mx-auto max-w-5xl ${readOnly ? "" : "pb-4"}`}>
      <section className="rounded-xl border border-line bg-paper p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold leading-snug">{myInfo.nickname}님의 가능 시간</h1>
          {isHost && (
            <span className="rounded-full bg-blue-soft px-2.5 py-0.5 text-sm font-medium text-ink">
              방장
            </span>
          )}
        </div>
        <p className="mt-2 text-sub">
          {formatDateRange(settings.dateRangeStart, settings.dateRangeEnd)} · 하루{" "}
          {settings.dailyStartTime}–{settings.dailyEndTime} ·{" "}
          {formatDuration(settings.durationMinutes)} · 참여 {snapshot.total}명
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-text">마감 {formatSeoulDateTime(snapshot.deadlineMs)}</span>
          {snapshot.status === "collecting" ? (
            <Countdown snapshot={snapshot} onReached={revalidate} />
          ) : (
            <span className="font-medium text-warn">
              {snapshot.status === "confirmed" ? "확정된 약속이에요" : "응답이 마감됐어요"}
            </span>
          )}
          <span
            className={`rounded-lg px-3 py-1 text-xs font-medium ${
              state === "submitted"
                ? "bg-blue-soft text-ink"
                : dirty
                  ? "bg-warn/10 text-warn"
                  : "bg-faint text-sub"
            }`}
          >
            {readOnly
              ? snapshot.me.submitted
                ? "제출한 내용으로 마감"
                : "제출하지 않고 마감"
              : SUBMISSION_LABELS[state]}
          </span>
        </div>
        {readOnly && (
          <p className="mt-3 text-sm text-sub">
            더 이상 시간을 바꿀 수 없어요. 내가 제출한 시간과 모두의 시간은 계속 볼 수 있어요.
          </p>
        )}
      </section>

      <div aria-live="polite" className="mt-4 space-y-2 empty:hidden">
        {notice && (
          <div
            className={`flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${
              notice.tone === "warn" ? "bg-warn/10 text-warn" : "bg-blue-soft text-ink"
            }`}
          >
            <span>{notice.text}</span>
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

      <div role="tablist" className="mt-4 grid grid-cols-2 rounded-lg bg-line/60 p-1 lg:hidden">
        {(
          [
            ["mine", "내 시간"],
            ["all", "모두의 시간"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`h-9 rounded-md text-sm font-medium ${tab === key ? "bg-paper text-text shadow-sm" : "text-sub"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-2 lg:gap-4">
        <section
          className={`min-w-0 rounded-xl border border-line bg-paper p-4 sm:p-6 ${tab === "mine" ? "" : "hidden lg:block"}`}
        >
          <h2 className="text-lg font-bold">내 가능 시간</h2>
          <p className="mt-1 text-sm text-sub">
            {readOnly
              ? "제출한 시간이에요."
              : "가능한 칸을 고르세요. 컴퓨터는 끌어서 여러 칸을, 휴대폰은 칸을 눌러 하나씩 고르고 날짜를 누르면 하루 전체를 고를 수 있어요."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-sub">
            <Legend className="bg-blue" label="가능" />
            <Legend className="border border-line bg-paper" label="불가능" />
            <Legend className="bg-line/70" label="지난 시간" />
          </div>
          <div className="mt-3">
            <MyGrid
              grid={snapshot.grid}
              selection={selection}
              nowMs={nowMs}
              readOnly={readOnly}
              onCommit={onCommit}
              onDragActive={onDragActive}
            />
          </div>
        </section>

        <section
          className={`mt-4 min-w-0 rounded-xl border border-line bg-paper p-4 sm:p-6 lg:mt-0 ${tab === "all" ? "" : "hidden lg:block"}`}
        >
          <h2 className="text-lg font-bold">모두의 가능 시간</h2>
          <p className="mt-1 text-sm text-sub">
            제출한 시간만 보여요. 색이 진할수록 가능한 사람이 많아요.
          </p>
          <div className="mt-3">
            <EveryoneGrid
              grid={snapshot.grid}
              participants={snapshot.participants}
              total={snapshot.total}
            />
          </div>
        </section>
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 z-30 mt-4 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          {confirmEmpty ? (
            <div role="alertdialog" aria-labelledby="empty-confirm" className="space-y-3">
              <p id="empty-confirm" className="text-sm">
                <span className="font-medium">가능한 시간이 없다고 제출할까요?</span>{" "}
                <span className="text-sub">모든 시간이 불가능으로 제출돼요.</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirmEmpty(false)}>
                  취소
                </Button>
                <Button disabled={submitting} onClick={() => void submit(true)}>
                  {submitting ? "제출 중…" : "없다고 제출"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{SUBMISSION_LABELS[state]}</p>
                <p className="text-xs text-sub">선택 {futureCount}칸</p>
              </div>
              <div className="w-32 shrink-0 sm:w-40">
                <Button disabled={submitting} onClick={() => void submit(false)}>
                  {submitting ? "제출 중…" : snapshot.me.submitted ? "다시 제출" : "제출하기"}
                </Button>
              </div>
            </div>
          )}
          {submitError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {submitError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

// 마감까지 남은 시간. 서버 시각 기준이며 0이 되면 한 번 다시 조회해 서버 판정을 받는다
function Countdown({ snapshot, onReached }: { snapshot: Snapshot; onReached: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const reachedRef = useRef(false);

  useEffect(() => {
    reachedRef.current = false;
    const update = () => {
      const now = estimateServerNow(snapshot.serverTimeMs, snapshot.receivedAt, performance.now());
      const left = snapshot.deadlineMs - now;
      setRemaining(left);
      if (left <= 0 && !reachedRef.current) {
        reachedRef.current = true;
        onReached();
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [snapshot, onReached]);

  if (remaining === null) return null;
  const text = formatRemaining(remaining);
  return (
    <span className={`font-medium ${remaining < 60 * 60 * 1000 ? "text-warn" : "text-blue"}`}>
      {text ?? "마감 시간이 됐어요. 확인 중…"}
    </span>
  );
}
