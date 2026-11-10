"use client";

import { useState, type SubmitEvent } from "react";
import { Button, Card, FIELD, FieldError } from "@/components/common/ui";
import { callApi } from "@/components/create-promise/api";
import { validateNickname } from "@/lib/member/nickname";
import {
  classifyLoginFailure,
  classifyRegisterFailure,
  resolveNicknameTaken,
  type AuthField,
  type BlockedReason,
  type FailureAction,
} from "@/lib/participate/failure";

// 참여자 등록(MEMBER-API-03)과 로그인(MEMBER-API-04) 카드
// PIN은 이 컴포넌트 상태로만 들고 요청 본문으로 보낸다. 저장소·콘솔·URL에 남기지 않는다
// 시도 제한은 MVP에서 구현하지 않는다(MEMBER-06-04 미결, 공개 배포 전 팀 안건)

export type AuthMode = "register" | "login";

const PIN = /^[0-9]{4}$/;

const INPUT = FIELD;

const TEXT: Record<AuthMode, { title: string; intro: string; submit: string; pending: string }> = {
  register: {
    title: "약속에 참여해 볼까요",
    intro: "닉네임과 PIN을 정하면 바로 참여할 수 있어요. 약속 내용은 참여한 뒤에 보여요.",
    submit: "참여하고 시간 선택하기",
    pending: "참여하는 중…",
  },
  login: {
    title: "다시 로그인하기",
    intro: "처음 참여할 때 쓴 닉네임과 PIN을 입력해 주세요.",
    submit: "로그인",
    pending: "확인하는 중…",
  },
};

export function ParticipantAuthCard(props: {
  promiseId: string;
  initialMode: AuthMode;
  initialNickname?: string;
  // false면 로그인만 연다(대기 화면의 방장 로그인, 마감 안내의 로그인)
  allowRegister: boolean;
  title?: string;
  intro?: string;
  onAuthenticated: () => void; // 세션 쿠키를 받았다. 링크 조회·/me로 다음 화면을 정한다
  onReload: () => void; // 약속 상태가 바뀌었다
  onBlocked: (reason: BlockedReason) => void;
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>(props.initialMode);
  const [nickname, setNickname] = useState(props.initialNickname ?? "");
  const [pin, setPin] = useState("");
  const [errors, setErrors] = useState<Partial<Record<AuthField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // 닉네임 중복 안내. 닉네임을 채운 로그인 화면으로 바꿀 수 있다
  const [takenNotice, setTakenNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const base = `/api/v1/promises/${encodeURIComponent(props.promiseId)}`;
  const text = TEXT[mode];

  function switchMode(next: AuthMode, keepNickname: string) {
    setMode(next);
    setNickname(keepNickname);
    setPin("");
    setErrors({});
    setFormError(null);
    setTakenNotice(null);
  }

  function check(): Partial<Record<AuthField, string>> {
    const next: Partial<Record<AuthField, string>> = {};
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

  function apply(action: FailureAction) {
    switch (action.kind) {
      case "field":
        setErrors({ [action.field]: action.message });
        return;
      case "form":
        setFormError(action.message);
        return;
      case "reload":
        props.onReload();
        return;
      case "blocked":
        props.onBlocked(action.reason);
        return;
      case "nickname_taken":
        // classifyRegisterFailure에서만 나오며 submit에서 먼저 처리한다
        return;
    }
  }

  function login(body: { nickname: string; pin: string }) {
    return callApi<{ role: string; promiseStatus: string }>(`${base}/auth/session`, {
      method: "POST",
      body,
    });
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    const found = check();
    setErrors(found);
    setFormError(null);
    setTakenNotice(null);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    const body = { nickname, pin };

    if (mode === "login") {
      const result = await login(body);
      if (result.ok) return props.onAuthenticated();
      setPending(false);
      apply(classifyLoginFailure(result));
      return;
    }

    const result = await callApi(`${base}/participants`, { method: "POST", body });
    if (result.ok) return props.onAuthenticated();

    const action = classifyRegisterFailure(result);
    if (action.kind !== "nickname_taken") {
      setPending(false);
      apply(action);
      return;
    }

    // 409 NICKNAME_TAKEN: 남의 닉네임인지, 본인이 등록하고 응답만 못 받았는지 구분할 수 없다
    // 같은 값으로 로그인을 한 번만 시도한다(등록 시도 1회당 1회). 성공하면 응답 유실 복구다
    const retry = await login(body);
    if (retry.ok) return props.onAuthenticated();
    setPending(false);
    const resolved = resolveNicknameTaken(retry);
    if (resolved.kind === "taken") setTakenNotice(resolved.message);
    else apply(resolved);
  }

  return (
    <Card center>
      <h1 className="text-[28px] font-bold leading-snug">{props.title ?? text.title}</h1>
      <p className="mt-2 text-sub">{props.intro ?? text.intro}</p>

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
            autoComplete="off"
            aria-invalid={errors.nickname || takenNotice ? true : undefined}
            aria-describedby={
              errors.nickname ? "nickname-error" : takenNotice ? "nickname-taken" : undefined
            }
          />
          <FieldError id="nickname-error" message={errors.nickname} />
          {/* 닉네임 중복(06-1): 입력란 바로 아래 빨간 안내. 본인일 수 있어 로그인 전환을 함께 둔다(R-18) */}
          {takenNotice && (
            <div id="nickname-taken" role="alert" className="mt-1.5 text-xs text-danger">
              <p>{takenNotice}</p>
              <button
                type="button"
                onClick={() => switchMode("login", nickname)}
                className="mt-1 font-medium text-ink underline underline-offset-2"
              >
                이 닉네임으로 로그인하기
              </button>
            </div>
          )}
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
          {mode === "register" && (
            <p id="pin-hint" className="mt-2 text-xs text-sub">
              다시 방문할 때 같은 닉네임과 PIN으로 응답을 수정해요.
            </p>
          )}
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? text.pending : text.submit}
        </Button>
        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}
      </form>

      {/* 05-2: 로그인·참여 전환은 전체 폭 보조 버튼(Figma 05 "이미 참여했어요 · 내 응답 찾기") */}
      <div className="mt-4 space-y-3">
        {props.allowRegister && mode === "register" && (
          <Button variant="secondary" disabled={pending} onClick={() => switchMode("login", "")}>
            이미 참여했어요 · 다시 로그인
          </Button>
        )}
        {props.allowRegister && mode === "login" && (
          <Button variant="secondary" disabled={pending} onClick={() => switchMode("register", "")}>
            처음이에요 · 참여하기
          </Button>
        )}
        {props.onBack && (
          <Button variant="secondary" disabled={pending} onClick={props.onBack}>
            돌아가기
          </Button>
        )}
      </div>
    </Card>
  );
}
