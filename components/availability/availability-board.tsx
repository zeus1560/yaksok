"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ConfirmDialog } from "@/components/common/modal";
import { Badge, Button, Notice, PANEL_BOX } from "@/components/common/ui";
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
import { createIntake } from "@/lib/availability/intake";
import { formatSelectionSummary } from "@/lib/availability/summary";
import { seoulDateOf } from "@/lib/time/seoul";
import { decidePoll } from "@/lib/availability/poll";
import {
  clipDraftToRange,
  decideDraft,
  draftStorageKey,
  estimateServerNow,
  formatRemaining,
  formatSeoulDateTime,
  nextDraft,
  parseDraft,
  parseSlotList,
  rangeClippedNotice,
  serializeDraft,
  settingsRange,
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
// - 응답은 onSuccess가 아니라 SWR data로 받는다. 같은 주소 요청(후보 화면의 "모두의 시간" 등)에 합류해 새로 그려져도
//   결과를 받아야 하기 때문이다. createIntake가 새 응답마다 정확히 한 번만 넘긴다(lib/availability/intake.ts)
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

type BoardNotice = { tone: "info" | "attention"; text: string };

export function AvailabilityBoard({
  promiseId,
  me: myInfo,
  onRelink,
  initialTab = "mine",
}: {
  promiseId: string;
  me: MyParticipation;
  onRelink: () => void;
  initialTab?: "mine" | "all"; // 390px 탭의 첫 선택. 마감 뒤 "모두의 시간 보기"는 all
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
  const [tab, setTab] = useState<"mine" | "all">(initialTab);
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [offline, setOffline] = useState(false);

  // SWR 콜백·이벤트 처리기에서 최신 값을 읽기 위한 참조. 렌더 중에는 읽지 않는다
  const draftRef = useRef<LocalDraft | null>(draft);
  const draggingRef = useRef(false);
  const submittingRef = useRef(false);
  const pendingRef = useRef<{ snapshot: Snapshot; decideLocal: boolean } | null>(null);
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

  // 서버 응답 반영: 새 설정 범위 밖 칸을 로컬 입력에서 먼저 지우고(028), 버전을 비교한다 (TIME-10-04)
  // 범위가 줄어도 저장된 슬롯이 없던 참여자는 버전이 그대로라, 자르지 않으면 "선택 N칸"이 화면보다 많다
  // decideLocal이 false면 화면만 채운다 — 이 화면이 생기기 전에 시작된 요청의 응답이라 로컬 입력 판단에 쓰지 않는다
  const applyServer = useCallback(
    (next: Snapshot, decideLocal = true) => {
      const now = estimateServerNow(next.serverTimeMs, next.receivedAt, performance.now());
      if (!decideLocal) {
        setSnapshot(next);
        setNowMs(now);
        return;
      }
      let local = draftRef.current;
      let clipped = 0;
      if (local) {
        const result = clipDraftToRange(local, settingsRange(next.settings));
        if (result.removed > 0) {
          local = result.draft;
          clipped = result.removed;
          setDraft(local); // 저장소에도 반영한다
        }
      }
      const decision = decideDraft(local, next.me, next.status, now);
      if (decision.kind === "keep" && clipped > 0) {
        setNotice({ tone: "info", text: rangeClippedNotice(clipped) });
      }
      if (decision.kind === "drop") {
        setDraft(null);
        if (decision.reason === "changed")
          setNotice({ tone: "attention", text: NOTICES.changedElsewhere });
        if (decision.reason === "closed")
          setNotice({ tone: "attention", text: NOTICES.closedUnsaved });
      }
      setSnapshot(next);
      setNowMs(now);
    },
    [setDraft],
  );

  const { data: polled, mutate } = useSWR(path, fetchAvailability, {
    refreshInterval: POLL_MS,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    focusThrottleInterval: 1000,
    dedupingInterval: 1000,
    shouldRetryOnError: false,
    isPaused: () => draggingRef.current || submittingRef.current,
  });

  // 새 응답마다 한 번: 다시 그려지기만 하면(같은 data) 아무것도 하지 않는다. 기준 시각은 첫 렌더(SWR 첫 요청보다 앞)
  const [intake] = useState(() => createIntake<Polled>(performance.now()));
  useEffect(() => {
    const taken = intake(polled);
    if (!taken) return;
    const { result, startedAt, receivedAt } = taken.data;
    const outcome = decidePoll(result, {
      startedAt,
      lastWriteAt: lastWriteRef.current,
      dragging: draggingRef.current,
      submitting: submittingRef.current,
    });
    // 합류한 응답은 이 화면이 생기기 전 상태일 수 있다. 화면을 채운 뒤 새로 조회해 그 응답으로 판단한다
    if (taken.joined) void mutate();
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
      pendingRef.current = { snapshot: next, decideLocal: !taken.joined };
      return;
    }
    applyServer(next, !taken.joined);
  }, [polled, intake, mutate, onRelink, applyServer]);

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
        queueMicrotask(() => applyServer(pending.snapshot, pending.decideLocal));
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
      setSubmitError(null);
      setConfirmEmpty(true);
      return;
    }
    // 빈 제출 확인 창은 요청이 끝날 때까지 열어 두고(요청 중 닫기 막음) 결과를 받은 뒤 닫는다
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

    const action = result.ok ? null : classifySubmitFailure(result);
    // 다시 시도할 수 있는 실패만 확인 창 안에 안내를 남긴다. 나머지는 창을 닫고 화면 안내로 보인다
    if (action?.kind !== "retry") setConfirmEmpty(false);

    if (result.ok) {
      applyMe({
        version: result.data.version,
        submitted: true,
        slots: parseSlotList(result.data.slots),
      });
      setDraft(null);
      setNotice(
        result.data.droppedSlotCount > 0
          ? { tone: "attention", text: NOTICES.dropped }
          : { tone: "info", text: NOTICES.submitted },
      );
      return;
    }

    if (!action) return;
    switch (action.kind) {
      case "conflict":
        // 다시 조회하지 않고 details로 다시 그린다
        applyMe({ version: action.version, submitted: action.submitted, slots: action.slots });
        setDraft(null);
        setNotice({ tone: "attention", text: NOTICES.conflict });
        return;
      case "refetch":
        setDraft(null);
        setNotice({ tone: "attention", text: NOTICES.conflict });
        void mutate();
        return;
      case "closed":
        lastWriteRef.current = performance.now();
        setSnapshot((current) => (current ? { ...current, status: "closed" } : current));
        if (draftRef.current) setNotice({ tone: "attention", text: NOTICES.closedUnsaved });
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
  const futureSlots = [...selection].filter((ms) => ms > nowMs);
  const status = STATUS_BADGE[snapshot.status] ?? STATUS_BADGE.collecting;

  return (
    <div className={`mx-auto max-w-page ${readOnly ? "" : "pb-4"}`}>
      <section className={`${PANEL_BOX} p-5 sm:p-7`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold leading-snug">
            {readOnly ? "모두의 가능한 시간을 확인하세요" : "가능한 시간을 골라 주세요"}
          </h1>
          <Badge size="status" tone={status.tone}>
            {status.label}
          </Badge>
        </div>
        <p className="mt-2 text-sub">
          {formatDateRange(settings.dateRangeStart, settings.dateRangeEnd)} · 하루{" "}
          {settings.dailyStartTime}–{settings.dailyEndTime} ·{" "}
          {formatDuration(settings.durationMinutes)} · 참여 {snapshot.total}명
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {snapshot.status === "collecting" ? (
            <>
              <span className="text-text">마감 {formatSeoulDateTime(snapshot.deadlineMs)}</span>
              <Countdown snapshot={snapshot} onReached={revalidate} />
            </>
          ) : (
            // 조기 마감(R-22)이면 설정 마감 시각이 아직 미래라 그 시각 대신 마감됐다는 사실만 보인다
            <span className="font-medium text-text">
              {snapshot.status === "confirmed" ? "응답 마감됨 · 확정된 약속이에요" : "응답 마감됨"}
            </span>
          )}
          <Badge
            tone={state === "submitted" ? "blue" : "muted"}
            className={dirty ? "!text-text" : ""}
          >
            {readOnly
              ? snapshot.me.submitted
                ? "제출한 내용으로 마감"
                : "제출하지 않고 마감"
              : SUBMISSION_LABELS[state]}
          </Badge>
        </div>
        {readOnly && (
          <p className="mt-3 text-sm text-sub">
            더 이상 시간을 바꿀 수 없어요. 내가 제출한 시간과 모두의 시간은 계속 볼 수 있어요.
          </p>
        )}
      </section>

      <div aria-live="polite" className="mt-4 space-y-2 empty:hidden">
        {notice && (
          <Notice tone={notice.tone} onClose={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}
        {offline && (
          <Notice tone="attention">연결이 불안정해요. 다시 연결되면 자동으로 갱신돼요.</Notice>
        )}
      </div>

      <div role="tablist" className="mt-4 grid grid-cols-2 gap-2 lg:hidden">
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
            className={`h-icon rounded-field text-sm ${
              tab === key
                ? "bg-blue-soft font-bold text-ink"
                : "border border-line bg-paper text-sub"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-2 lg:gap-4">
        <section
          className={`min-w-0 ${PANEL_BOX} p-4 sm:p-6 ${tab === "mine" ? "" : "hidden lg:block"}`}
        >
          <h2 className="text-lg font-bold">내 가능 시간</h2>
          <p className="mt-1 text-sm text-sub">
            {readOnly
              ? "제출한 시간이에요."
              : "30분 단위예요. 빈 칸부터 끌면 추가, 고른 칸부터 끌면 해제돼요. 휴대폰은 칸을 눌러 하나씩, 날짜를 누르면 하루 전체를 골라요."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-sub">
            <Legend className="bg-blue" label="가능" />
            <Legend className="border border-line bg-paper" label="불가능" />
            <Legend className="bg-muted" label="지난 시간" />
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
          className={`mt-4 min-w-0 ${PANEL_BOX} p-4 sm:p-6 lg:mt-0 ${tab === "all" ? "" : "hidden lg:block"}`}
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
              today={nowMs > 0 ? seoulDateOf(new Date(nowMs)) : null}
            />
          </div>
        </section>
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 z-30 mt-4 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{SUBMISSION_LABELS[state]}</p>
              <p className="text-xs text-sub" data-selected-slots={futureSlots.length}>
                {formatSelectionSummary(futureSlots)}
              </p>
            </div>
            <div className="w-36 shrink-0 sm:w-60">
              <Button disabled={submitting} onClick={() => void submit(false)}>
                {submitting && !confirmEmpty
                  ? "제출 중…"
                  : snapshot.me.submitted
                    ? "다시 제출"
                    : "가능 시간 제출"}
              </Button>
            </div>
          </div>
          {submitError && !confirmEmpty && (
            <Notice tone="error" role="alert" className="mt-2">
              {submitError} 고른 시간은 그대로 남아 있어요.
            </Notice>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmEmpty}
        title="가능한 시간이 없다고 제출할까요?"
        confirmLabel="가능 시간 없음으로 제출"
        busyLabel="제출 중…"
        cancelLabel="시간 선택으로"
        busy={submitting}
        error={submitError}
        onConfirm={() => void submit(true)}
        onClose={() => {
          setConfirmEmpty(false);
          setSubmitError(null);
        }}
      >
        <p>고른 시간이 없어요. 이대로 제출하면 모든 시간이 불가능으로 제출돼요.</p>
      </ConfirmDialog>
    </div>
  );
}

// 약속 상태 배지 (Figma Badge: 조율 중·투표 마감·약속 확정)
const STATUS_BADGE: Record<string, { label: string; tone: "blue" | "muted" }> = {
  collecting: { label: "조율 중", tone: "blue" },
  closed: { label: "투표 마감", tone: "muted" },
  confirmed: { label: "약속 확정", tone: "blue" },
};

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-xs ${className}`} />
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
    <span className={`font-medium ${remaining < 60 * 60 * 1000 ? "text-danger" : "text-blue"}`}>
      {text ?? "마감 시간이 됐어요. 확인 중…"}
    </span>
  );
}
