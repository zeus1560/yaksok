"use client";

import { useRef, useState } from "react";
import { Badge, Button, Notice, PANEL } from "@/components/common/ui";
import { formatSeoulRange, inviteUrl } from "@/lib/result/format";
import type { Confirmation } from "@/lib/result/view";

// 결과 화면 (STATE-API-01 currentConfirmation). 확정 일정(한국 시간)·공통 가능 인원·초대 링크 복사(수동 공유)
// 인원은 현재 응답 기준으로 다시 계산한 값이다(RESULT-13-02). 2명 미만이어도 확정은 유지되고 방장에게만 알린다
export function ResultPanel({
  confirmation,
  showHostWarning,
  inviteToken,
}: {
  confirmation: Confirmation;
  showHostWarning: boolean;
  inviteToken: string;
}) {
  const { date, time } = formatSeoulRange(confirmation.startAt, confirmation.endAt);
  return (
    <section className={`${PANEL} p-5 sm:p-8`}>
      <h1 className="text-[28px] font-bold leading-snug">우리 이때 만나요!</h1>
      <p className="mt-2 text-sub">약속 시간이 확정됐어요.</p>
      <Badge size="status" className="mt-5">
        약속 확정
      </Badge>
      <p className="mt-5 text-[28px] font-bold leading-snug text-ink">{date}</p>
      <p className="mt-2 text-[28px] font-bold leading-snug">{time}</p>
      <p className="mt-4 text-sub">
        한국 시간 기준 · 함께 가능한 사람{" "}
        <span className="font-medium text-text">{confirmation.availableParticipantCount}명</span>
      </p>

      {showHostWarning && (
        <Notice tone="attention" role="alert" className="mt-4">
          <p className="font-medium">지금 참석 가능한 사람이 2명 미만이에요</p>
          <p className="mt-1">
            현재 응답 기준으로 다시 센 인원이에요. 확정한 일정은 그대로 유지돼요.
          </p>
        </Notice>
      )}

      <ShareLink inviteToken={inviteToken} />
    </section>
  );
}

function ShareLink({ inviteToken }: { inviteToken: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  // 이 화면은 브라우저에서 상태 조회를 받은 뒤에만 그려진다(서버 렌더링 없음)
  const url =
    typeof window === "undefined"
      ? `/p/${encodeURIComponent(inviteToken)}`
      : inviteUrl(window.location.origin, inviteToken);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // 권한·비보안 환경: 입력란을 선택해 직접 복사하게 한다
      setState("manual");
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="text-sm font-medium">초대 링크로 결과 공유하기</p>
      <p className="mt-1 text-sm text-sub">
        링크를 복사해 카카오톡 채팅방에 붙여 넣으면 참여자가 이 결과를 볼 수 있어요.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label="초대 링크"
          onFocus={(e) => e.currentTarget.select()}
          className="h-control min-w-0 flex-1 rounded-field border border-line bg-paper px-4 text-sm text-text"
        />
        <div className="sm:w-40">
          {/* 복사 완료는 버튼이 어두워지며 알린다 (Figma 04 "링크 복사 완료 상태") */}
          <Button variant={state === "copied" ? "dark" : "primary"} onClick={() => void copy()}>
            {state === "copied" ? "복사했어요" : "링크 복사"}
          </Button>
        </div>
      </div>
      <p aria-live="polite" className="mt-2 text-sm text-sub empty:hidden">
        {state === "copied"
          ? "초대 링크를 복사했어요."
          : state === "manual"
            ? "자동으로 복사하지 못했어요. 링크를 길게 눌러 복사해 주세요."
            : ""}
      </p>
    </div>
  );
}
