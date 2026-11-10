"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/common/modal";
import { Badge, Button, Notice, PANEL } from "@/components/common/ui";
import { callApi, type ApiResult } from "@/components/create-promise/api";
import type { AvailabilityResponse } from "@/components/availability/snapshot";
import { parseSlotList } from "@/lib/availability/sync";
import {
  classifyCandidatesFailure,
  classifyConfirmFailure,
  type RoomAction,
} from "@/lib/result/failure";
import {
  appendCandidates,
  formatSeoulRange,
  isAvailableThroughout,
  type CandidateItem,
} from "@/lib/result/format";
import { PAGE_SIZE, promisePath, type CandidatePage } from "./api-types";

// 후보 화면 (STATE-API-10, STATE-API-05). closed에서 모든 참여자가 보고, 방장에게만 후보마다 확정 버튼
// - 상위 5개(RESULT-06-01), "더 보기"는 다음 offset. 겹치는 후보(RESULT-07-02 ❗미결)는 묶지 않고 각각 보인다
// - 공통 가능 인원만 보인다. 이름(RESULT-10-01)·비율(RESULT-05-03)·미제출자(RESULT-05-01)는 미결이라 보이지 않는다
// - 방장이 가능하다고 하지 않은 후보를 확정할 때는 방장 불참을 안내한다(RESULT-04-02)

type HostMe = { submitted: boolean; slots: number[] };
type PageReply = { id: number; offset: number; result: ApiResult<CandidatePage> };

type ListState = {
  items: CandidateItem[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export function CandidatesPanel({
  promiseId,
  canConfirm,
  onConfirmed,
  onAction,
}: {
  promiseId: string;
  canConfirm: boolean;
  onConfirmed: () => void;
  onAction: (action: RoomAction) => void;
}) {
  const [list, setList] = useState<ListState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<CandidateItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [hostMe, setHostMe] = useState<HostMe | null>(null);
  const requestRef = useRef(0); // 다시 조회하면 그 전 요청의 응답은 버린다

  // 요청(상태 변경 없음)과 응답 반영을 나눈다. 다시 조회하면 그 전 요청의 응답은 버린다
  const requestPage = useCallback(
    async (offset: number): Promise<PageReply> => {
      const id = ++requestRef.current;
      const result = await callApi<CandidatePage>(
        promisePath(promiseId, `/candidates?limit=${PAGE_SIZE}&offset=${offset}`),
      );
      return { id, offset, result };
    },
    [promiseId],
  );

  const applyPage = useCallback(
    ({ id, offset, result }: PageReply) => {
      if (id !== requestRef.current) return;
      setLoading(false);
      if (!result.ok) {
        const action = classifyCandidatesFailure(result);
        if (action.kind === "retry") setLoadError(action.message);
        else onAction(action);
        return;
      }
      const page = result.data;
      setList((current) => ({
        items:
          offset === 0 || !current
            ? appendCandidates([], page.candidates)
            : appendCandidates(current.items, page.candidates),
        total: page.total,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
      }));
    },
    [onAction],
  );

  // 더 보기·다시 시도·후보 재조회
  function load(offset: number) {
    setLoading(true);
    setLoadError(null);
    void requestPage(offset).then(applyPage);
  }

  // 화면에 들어올 때 첫 페이지를 한 번 조회한다
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reply = await requestPage(0);
      if (!cancelled) applyPage(reply);
    })();
    return () => {
      cancelled = true;
    };
  }, [requestPage, applyPage]);

  // 방장 불참 안내용 본인 가능 시간. 실패하면 안내 없이 확인 창만 보인다
  useEffect(() => {
    if (!canConfirm) return;
    let cancelled = false;
    void (async () => {
      const result = await callApi<AvailabilityResponse>(promisePath(promiseId, "/availability"));
      if (cancelled || !result.ok) return;
      setHostMe({
        submitted: result.data.me.submitted,
        slots: parseSlotList(result.data.me.slots),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [canConfirm, promiseId]);

  async function confirm(candidate: CandidateItem) {
    if (confirming) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await callApi<unknown>(promisePath(promiseId, "/confirmation"), {
      method: "POST",
      body: { startAt: candidate.startAt },
    });
    setConfirming(false);
    if (result.ok) {
      setAsking(null);
      setConfirmed(true);
      onConfirmed();
      return;
    }
    const action = classifyConfirmFailure(result);
    switch (action.kind) {
      case "retry":
        // 확인 창을 열어 둔 채 다시 누를 수 있다. 응답이 유실됐다면 다음 요청이 409 → 결과 화면
        setConfirmError(action.message);
        return;
      case "refetch_candidates":
        setAsking(null);
        setNotice(action.notice);
        void load(0);
        return;
      default:
        setAsking(null);
        onAction(action);
    }
  }

  if (confirmed) {
    return (
      <Panel>
        <p role="status" className="py-6 text-center text-sub">
          확정했어요. 결과를 불러오고 있어요…
        </p>
      </Panel>
    );
  }

  const hostAbsent =
    asking !== null &&
    hostMe !== null &&
    !isAvailableThroughout(hostMe, asking.startAt, asking.endAt);

  const askingRange = asking ? formatSeoulRange(asking.startAt, asking.endAt) : null;

  return (
    <Panel>
      <h1 className="text-2xl font-bold leading-snug">응답이 마감됐어요</h1>
      <p className="mt-2 text-sub">
        {canConfirm
          ? "함께 가능한 사람이 많은 순서예요. 확정할 시간을 골라 주세요."
          : "마감되어 시간을 바꿀 수 없어요. 함께 가능한 사람이 많은 순서이고, 방장이 이 중에서 최종 확정할 때까지 기다려 주세요."}
      </p>

      {notice && (
        <Notice tone="attention" className="mt-4" onClose={() => setNotice(null)}>
          {notice}
        </Notice>
      )}

      {list === null ? (
        <div className="py-8 text-center text-sub">
          {loadError ? (
            <LoadError message={loadError} onRetry={() => void load(0)} />
          ) : (
            <p role="status">후보를 불러오고 있어요…</p>
          )}
        </div>
      ) : list.items.length === 0 ? (
        <Notice tone="attention" className="mt-5">
          <p className="font-medium">함께 가능한 시간이 없어요</p>
          <p className="mt-1 text-sub">
            2명 이상이 같은 시간에 가능해야 후보가 돼요. 모두의 시간에서 응답을 확인할 수 있어요.
          </p>
        </Notice>
      ) : (
        <>
          <ol className="mt-5 space-y-2">
            {list.items.map((candidate, index) => {
              const { date, time } = formatSeoulRange(candidate.startAt, candidate.endAt);
              // Figma CandidateCard: 1순위는 연한 파랑, 확인 창이 열린 후보는 파란 테두리
              const tone =
                asking?.startAt === candidate.startAt
                  ? "border-blue bg-paper"
                  : index === 0
                    ? "border-line bg-blue-soft"
                    : "border-line bg-paper";
              return (
                <li key={candidate.startAt} className={`rounded-field border px-4 py-3 ${tone}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="w-6 shrink-0 text-sm font-bold text-ink">{index + 1}</span>
                    <div className="min-w-0 flex-1 text-ink">
                      <p className="font-medium">{date}</p>
                      <p className="text-sm">{time}</p>
                    </div>
                    <Badge tone={index === 0 ? "muted" : "blue"} className="!text-ink">
                      {candidate.availableParticipantCount}명 가능
                    </Badge>
                    {canConfirm && (
                      <div className="w-full sm:w-36">
                        <Button
                          variant="secondary"
                          disabled={confirming}
                          onClick={() => {
                            setAsking(candidate);
                            setConfirmError(null);
                          }}
                        >
                          이 시간으로 확정
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {loadError && (
            <div className="mt-3 text-center">
              <LoadError message={loadError} onRetry={() => void load(list.nextOffset ?? 0)} />
            </div>
          )}
          {list.hasMore && list.nextOffset !== null && !loadError && (
            <div className="mt-3">
              <Button
                variant="secondary"
                disabled={loading}
                onClick={() => void load(list.nextOffset as number)}
              >
                {loading ? "불러오는 중…" : `더 보기 (${list.items.length}/${list.total})`}
              </Button>
            </div>
          )}
        </>
      )}

      {/* 확정 확인 (Figma ConfirmScheduleDialog). 재조율(STATE-API-06)로 다시 열 수 있어 "수정할 수 없어요"는 쓰지 않는다 */}
      <ConfirmDialog
        open={canConfirm && asking !== null}
        title="이 시간으로 확정할까요?"
        confirmLabel="약속 확정하기"
        busyLabel="확정하는 중…"
        busy={confirming}
        error={confirmError}
        onConfirm={() => asking && void confirm(asking)}
        onClose={() => {
          setAsking(null);
          setConfirmError(null);
        }}
      >
        {askingRange && asking && (
          <div className="rounded-field border border-blue px-4 py-4 text-center text-ink">
            <p className="font-medium">{askingRange.date}</p>
            <p className="mt-0.5">
              {askingRange.time} · {asking.availableParticipantCount}명 가능
            </p>
          </div>
        )}
        <p>
          확정하면 참여자 모두에게 결과가 보여요. 나중에 방장 메뉴의 다시 열기로 다시 조율할 수
          있어요.
        </p>
        {hostAbsent && (
          <Notice tone="attention">
            방장님은 이 시간에 가능하다고 응답하지 않았어요. 방장 없이 만나는 일정이 돼요.
          </Notice>
        )}
      </ConfirmDialog>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className={`${PANEL} p-5 sm:p-7`}>{children}</section>;
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3">
      <p className="text-sm text-danger">{message}</p>
      <div className="mx-auto w-40">
        <Button variant="secondary" onClick={onRetry}>
          다시 시도
        </Button>
      </div>
    </div>
  );
}
