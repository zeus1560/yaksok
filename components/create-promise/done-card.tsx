"use client";

import { useEffect, useRef, useState } from "react";
import { useHeaderIdentity, type Identity } from "@/components/common/identity";
import { Badge, Button, Card } from "@/components/common/ui";
import type { StartedSettings } from "@/components/create-promise/api";
import {
  formatDailyRange,
  formatDeadline,
  formatDuration,
  formatSummaryTitle,
  timeToMinute,
} from "@/lib/create-promise/format";
import { inviteBaseUrl } from "@/lib/public-url";

// 설정 완료 (Figma 35:379, 04). 약속 이름 대신 날짜 범위·정원 요약을 제목으로 쓴다 (R-15)
// 복사가 되면 버튼이 2초 동안 어두운 "복사 완료" 상태가 된다(Figma 04). 복사하지 못하면 링크를 선택하고 알림으로 안내한다

const COPIED_MS = 2000;

function inviteUrlOf(inviteToken: string): string {
  // MEMBER-API-09의 inviteUrl과 같은 기준(lib/public-url.ts)으로 조립한다 — 미리보기 배포는 지금 연 배포 주소(032)
  // NEXT_PUBLIC_ 값은 빌드 때 글자 그대로 바뀌므로 하나씩 적는다
  const base =
    inviteBaseUrl(
      {
        NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
        VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
      },
      window.location.origin,
    ) ?? window.location.origin;
  return `${base.replace(/\/$/, "")}/p/${encodeURIComponent(inviteToken)}`;
}

export function DoneCard({
  inviteToken,
  settings,
  identity,
  onStartInput,
}: {
  inviteToken: string;
  settings: StartedSettings;
  identity: Identity;
  onStartInput: () => void;
}) {
  useHeaderIdentity(identity);
  const [inviteUrl] = useState(() => inviteUrlOf(inviteToken));
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function later(fn: () => void) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, COPIED_MS);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setToast(null);
      setCopied(true);
      later(() => setCopied(false));
    } catch {
      // 클립보드 권한이 없으면 직접 복사할 수 있게 선택해 둔다
      inputRef.current?.select();
      setCopied(false);
      setToast("링크를 선택했어요. 길게 눌러 복사해 주세요");
      later(() => setToast(null));
    }
  }

  const { dateRange, dailyTimeRange } = settings;
  return (
    <>
      <Card center>
        <h1 className="text-[28px] font-bold leading-snug">약속이 만들어졌어요</h1>
        <p className="mt-2 text-sub">친구들에게 링크를 보내고, 가능한 시간을 함께 골라보세요.</p>
        <Badge size="status" className="mt-5">
          조율 중
        </Badge>
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
          className="mt-6 h-field w-full rounded-field border border-line bg-paper px-4 text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-4 space-y-3">
          <Button variant={copied ? "dark" : "secondary"} onClick={copy} aria-live="polite">
            {copied ? "링크를 복사했어요" : "초대 링크 복사"}
          </Button>
          <Button onClick={onStartInput}>내 가능 시간 입력하기</Button>
        </div>
      </Card>
      <div
        role="status"
        aria-live="polite"
        className={`fixed inset-x-4 bottom-6 mx-auto max-w-md rounded-field bg-text px-4 py-3 text-center text-sm text-white transition-opacity ${
          toast ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {toast}
      </div>
    </>
  );
}
