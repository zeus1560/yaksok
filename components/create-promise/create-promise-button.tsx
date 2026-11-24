"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/common/ui";
import { callApi } from "@/components/create-promise/api";
import { RATE_LIMITED_MESSAGE } from "@/lib/limit/notice";

// MEMBER-API-09로 링크만 발급하고 /p/{token}으로 이동한다
export function CreatePromiseButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setFailure(null);
    const result = await callApi<{ inviteToken: string }>("/api/v1/links", { method: "POST" });
    if (result.ok && typeof result.data?.inviteToken === "string") {
      // 이동이 끝날 때까지 버튼은 비활성 상태로 둔다
      router.push(`/p/${encodeURIComponent(result.data.inviteToken)}`);
      return;
    }
    setPending(false);
    // 429 RATE_LIMITED(1분 10회, 035)는 따로 안내한다. 그 밖의 실패는 다시 시도
    setFailure(
      !result.ok && result.code === "RATE_LIMITED"
        ? RATE_LIMITED_MESSAGE
        : "잠시 후 다시 시도해 주세요",
    );
  }

  return (
    <>
      <Button onClick={create} disabled={pending} aria-busy={pending}>
        {pending ? "만드는 중…" : "새 약속 만들기"}
      </Button>
      {failure && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {failure}
        </p>
      )}
    </>
  );
}
