"use client";

import { useState, type SubmitEvent } from "react";
import { Button, Card, FIELD, FieldError, Notice } from "@/components/common/ui";
import { callApi, writeStorage } from "@/components/create-promise/api";
import {
  createSetupRecord,
  setupStorageKey,
  type SetupRecord,
} from "@/lib/create-promise/countdown";
import { RATE_LIMITED_MESSAGE } from "@/lib/limit/notice";
import { validateNickname } from "@/lib/member/nickname";

// 방장 등록 (MEMBER-API-02). Figma 35:399 첫 참여 카드를 재사용한다 (DECISION_CONFLICTS R-15)
// PIN은 상태로만 들고 있다가 요청 본문으로 보내며 로그·저장소에 남기지 않는다

type Field = "nickname" | "pin";

const PIN = /^[0-9]{4}$/;

const INPUT = FIELD;

export function RegisterHostCard(props: {
  inviteToken: string;
  notice: string | null;
  onRegistered: (record: SetupRecord, nickname: string) => void;
  onConflict: () => void;
  onLinkGone: (kind: "invalid" | "expired") => void;
}) {
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function check(): Partial<Record<Field, string>> {
    const next: Partial<Record<Field, string>> = {};
    const result = validateNickname(nickname);
    if (!result.ok) {
      next.nickname =
        result.reason === "emoji"
          ? "닉네임에 이모지는 사용할 수 없어요."
          : "닉네임은 2자 이상 12자 이하로 입력해 주세요.";
    }
    if (!PIN.test(pin)) next.pin = "PIN은 숫자 4자리로 입력해 주세요.";
    return next;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    const result = await callApi<{ promiseId: string }>(
      `/api/v1/links/${encodeURIComponent(props.inviteToken)}/host`,
      { method: "POST", body: { nickname, pin } },
    );
    if (result.ok) {
      // 응답을 받은 순간의 기기 시각 + 10분 (서버 시각과 비교하지 않는다)
      const record = createSetupRecord(result.data.promiseId, Date.now());
      writeStorage(setupStorageKey(props.inviteToken), JSON.stringify(record));
      props.onRegistered(record, nickname.trim().normalize("NFC"));
      return;
    }
    setPending(false);
    if (result.code === "RATE_LIMITED") {
      // 1분 30회(035). 상태 코드보다 먼저 에러 코드로 고른다
      setFormError(RATE_LIMITED_MESSAGE);
    } else if (result.status === 422 && (result.field === "nickname" || result.field === "pin")) {
      setErrors({ [result.field]: result.message ?? "입력값을 확인해 주세요." });
    } else if (result.status === 409) {
      props.onConflict();
    } else if (result.status === 404) {
      props.onLinkGone("invalid");
    } else if (result.status === 410) {
      props.onLinkGone("expired");
    } else {
      setFormError("잠시 후 다시 시도해 주세요");
    }
  }

  return (
    <Card center>
      <h1 className="text-[28px] font-bold leading-snug">새 약속을 만들어 볼까요</h1>
      <p className="mt-2 text-sub">닉네임과 PIN을 정하면 바로 약속 설정을 시작해요.</p>
      {props.notice && (
        <Notice tone="info" role="alert" className="mt-4">
          {props.notice}
        </Notice>
      )}

      <form onSubmit={submit} noValidate className="mt-6 space-y-5">
        <div>
          <label htmlFor="nickname" className="mb-2 block text-sm font-medium">
            닉네임
          </label>
          <input
            id="nickname"
            className={INPUT}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="닉네임을 입력하세요"
            autoComplete="nickname"
            aria-invalid={errors.nickname ? true : undefined}
            aria-describedby={errors.nickname ? "nickname-error" : undefined}
          />
          <FieldError id="nickname-error" message={errors.nickname} />
        </div>
        <div>
          <label htmlFor="pin" className="mb-2 block text-sm font-medium">
            내 응답 수정용 PIN (숫자 4자리)
          </label>
          <input
            id="pin"
            className={`${INPUT} !text-lg tracking-[0.4em]`}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="••••"
            aria-invalid={errors.pin ? true : undefined}
            aria-describedby={errors.pin ? "pin-error" : "pin-hint"}
          />
          <FieldError id="pin-error" message={errors.pin} />
          <p id="pin-hint" className="mt-2 text-xs text-sub">
            다시 방문할 때 같은 닉네임과 PIN으로 응답을 수정해요.
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "등록하는 중…" : "방장으로 시작하기"}
        </Button>
        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}
      </form>
    </Card>
  );
}
