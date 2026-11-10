"use client";

import { useState } from "react";
import { Button } from "@/components/common/ui";
import { callApi } from "@/components/create-promise/api";
import {
  promisePath,
  type ParticipantList,
  type ParticipantRow,
} from "@/components/result/api-types";
import { classifyRemoveFailure, type ManageAction } from "@/lib/manage/failure";

// 참여자 명단 (MEMBER-API-06)과 내보내기 (MEMBER-API-08) (027)
// - 모든 참여자가 본다. 등록순(서버 순서 그대로)·방장 표시·내 항목. 제출 여부는 API에 없어 보이지 않는다(MEMBER-08-02)
// - 내보내기는 방장에게만, 모집 중(상태 조회 collecting = 마감 전)일 때만, 본인 행에는 버튼이 없다
// - 명단 조회·폴링은 상위(PromiseRoom)가 한다. 여기서는 그리기와 내보내기 요청만 한다
export function ParticipantListPanel({
  promiseId,
  list,
  unstable,
  canRemove,
  onRemoved,
  onAction,
}: {
  promiseId: string;
  list: ParticipantList | null;
  unstable: boolean; // 마지막 조회가 일시 실패했다(마지막 값을 보여 준다)
  canRemove: boolean;
  onRemoved: () => void;
  onAction: (action: ManageAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<ParticipantRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(target: ParticipantRow) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await callApi<{ participantId: string }>(
      promisePath(promiseId, `/participants/${encodeURIComponent(target.participantId)}`),
      { method: "DELETE" },
    );
    setBusy(false);
    if (result.ok) {
      // 이미 내보낸 대상도 200이다. 명단을 다시 조회한다
      setAsking(null);
      onRemoved();
      return;
    }
    const action = classifyRemoveFailure(result);
    if (action.kind === "retry") {
      setError(action.message);
      return;
    }
    setAsking(null);
    onAction(action);
  }

  const count = list ? `${list.currentParticipantCount} / ${list.participantLimit}명` : "…";

  return (
    <section
      aria-label="참여자 명단"
      className="mx-auto mb-4 max-w-5xl rounded-xl border border-line bg-paper px-4 py-3 sm:px-5"
    >
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">참여자</span>{" "}
          <span className="text-sub" aria-label="현재 인원 / 정원">
            {count}
          </span>
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="participant-rows"
          className="shrink-0 text-sm font-medium text-blue underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "명단 접기" : "명단 보기"}
        </button>
      </div>

      {open && (
        <div id="participant-rows" className="mt-3 border-t border-line pt-2">
          {unstable && (
            <p className="mb-2 text-xs text-sub">
              명단을 새로 불러오지 못했어요. 마지막 명단이에요.
            </p>
          )}
          {!list ? (
            <p role="status" className="py-2 text-sm text-sub">
              명단을 불러오고 있어요…
            </p>
          ) : (
            <ol className="divide-y divide-line">
              {list.participants.map((person) => (
                <li key={person.participantId} className="py-2">
                  <div className="flex min-h-9 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {person.nickname}
                      {person.role === "host" && (
                        <span className="ml-1.5 rounded bg-blue-soft px-1.5 py-0.5 text-xs font-medium text-ink">
                          방장
                        </span>
                      )}
                      {person.isMe && (
                        <span className="ml-1.5 rounded bg-faint px-1.5 py-0.5 text-xs font-medium text-sub">
                          나
                        </span>
                      )}
                    </span>
                    {canRemove &&
                      !person.isMe &&
                      asking?.participantId !== person.participantId && (
                        <button
                          type="button"
                          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-danger hover:bg-faint disabled:text-sub"
                          disabled={busy}
                          onClick={() => {
                            setAsking(person);
                            setError(null);
                          }}
                        >
                          내보내기
                        </button>
                      )}
                  </div>
                  {canRemove && asking?.participantId === person.participantId && (
                    <div
                      role="alertdialog"
                      aria-label={`${person.nickname} 내보내기 확인`}
                      className="mt-2 space-y-2"
                    >
                      <p className="text-sm text-sub">
                        <span className="font-medium text-text">{person.nickname}</span>님을
                        내보낼까요? 이 약속에 다시 로그인할 수 없고, 입력은 집계에서 빠져요.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" disabled={busy} onClick={() => setAsking(null)}>
                          취소
                        </Button>
                        <Button
                          disabled={busy}
                          className="!bg-danger hover:!bg-danger/90 disabled:!bg-line"
                          onClick={() => void remove(person)}
                        >
                          {busy ? "내보내는 중…" : "내보내기"}
                        </Button>
                      </div>
                      {error && (
                        <p role="alert" className="text-sm text-danger">
                          {error}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
