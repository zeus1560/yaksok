"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/common/ui";
import type { StartedSettings } from "@/components/create-promise/api";
import {
  formatDailyRange,
  formatDeadline,
  formatDuration,
  formatSummaryTitle,
  timeToMinute,
} from "@/lib/create-promise/format";

// 설정 완료 (Figma 35:379). 약속 이름 대신 날짜 범위·정원 요약을 제목으로 쓴다 (R-15)

function inviteUrlOf(inviteToken: string): string {
  // MEMBER-API-09의 inviteUrl과 같은 기준(NEXT_PUBLIC_BASE_URL)으로 조립한다
  const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
  return `${base.replace(/\/$/, "")}/p/${encodeURIComponent(inviteToken)}`;
}

export function DoneCard({
  inviteToken,
  settings,
  onStartInput,
}: {
  inviteToken: string;
  settings: StartedSettings;
  onStartInput: () => void;
}) {
  const [inviteUrl] = useState(() => inviteUrlOf(inviteToken));
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function showToast(message: string) {
    setToast(message);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast("링크를 복사했어요");
    } catch {
      // 클립보드 권한이 없으면 직접 복사할 수 있게 선택해 둔다
      inputRef.current?.select();
      showToast("링크를 선택했어요. 길게 눌러 복사해 주세요");
    }
  }

  const { dateRange, dailyTimeRange } = settings;
  return (
    <>
      <Card className="mx-auto max-w-lg">
        <h1 className="text-[28px] font-bold leading-snug">약속이 만들어졌어요</h1>
        <p className="mt-2 text-sub">친구들에게 링크를 보내고, 가능한 시간을 함께 골라보세요.</p>
        <span className="mt-5 inline-block rounded-lg bg-blue-soft px-4 py-1.5 text-xs font-medium text-ink">
          조율 중
        </span>
        <h2 className="mt-5 text-xl font-bold">
          {formatSummaryTitle(dateRange.startDate, dateRange.endDate, settings.participantLimit)}
        </h2>
        <div className="mt-3 space-y-0.5 text-sub">
          <p>
            하루{" "}
            {formatDailyRange(
              timeToMinute(dailyTimeRange.startTime),
              timeToMinute(dailyTimeRange.endTime),
            )}{" "}
            · {formatDuration(settings.durationMinutes)}
          </p>
          <p>마감 {formatDeadline(settings.votingDeadlineAt)} KST</p>
        </div>

        <label htmlFor="invite-url" className="sr-only">
          초대 링크
        </label>
        <input
          id="invite-url"
          ref={inputRef}
          readOnly
          value={inviteUrl}
          className="mt-6 h-12 w-full rounded-lg border border-line bg-faint px-4 text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-4 space-y-3">
          <Button variant="secondary" onClick={copy}>
            초대 링크 복사
          </Button>
          <Button onClick={onStartInput}>내 가능 시간 입력하기</Button>
        </div>
      </Card>
      <div
        role="status"
        aria-live="polite"
        className={`fixed inset-x-4 bottom-6 mx-auto max-w-sm rounded-lg bg-text px-4 py-3 text-center text-sm text-white transition-opacity ${
          toast ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {toast}
      </div>
    </>
  );
}
