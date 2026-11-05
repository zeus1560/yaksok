"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/common/ui";
import { callApi } from "@/components/create-promise/api";

// MEMBER-API-09로 링크만 발급하고 /p/{token}으로 이동한다
export function CreatePromiseButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function create() {
    setPending(true);
    setFailed(false);
    const result = await callApi<{ inviteToken: string }>("/api/v1/links", { method: "POST" });
    if (result.ok && typeof result.data?.inviteToken === "string") {
      // 이동이 끝날 때까지 버튼은 비활성 상태로 둔다
      router.push(`/p/${encodeURIComponent(result.data.inviteToken)}`);
      return;
    }
    setPending(false);
    setFailed(true);
  }

  return (
    <>
      <Button onClick={create} disabled={pending} aria-busy={pending}>
        {pending ? "만드는 중…" : "새 약속 만들기"}
      </Button>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-danger">
          잠시 후 다시 시도해 주세요
        </p>
      )}
    </>
  );
}
