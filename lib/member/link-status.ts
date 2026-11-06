import type { Promise as PromiseModel } from "@/prisma/generated/client";

// MEMBER-API-01 판정 로직. DB와 시계를 받지 않는 순수 함수로 두고 판정 시각은 호출자가 넘긴다

export const LINK_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // MEMBER-01-02
export const DRAFT_EXPIRY_MS = 10 * 60 * 1000; // STATE-02-02
export const DRAFT_POLL_AFTER_MS = 3000; // MEMBER-03-02 폴링 간격. 값은 명세 예시를 따른다

export type LinkPromise = Pick<
  PromiseModel,
  "id" | "status" | "createdAt" | "votingDeadlineAt" | "confirmedStartAt"
>;

export type LinkWithPromise = {
  inviteToken: string;
  createdAt: Date;
  promise: LinkPromise | null;
};

export type PromiseStatusView =
  "unclaimed" | "draft" | "collecting" | "closed" | "confirmed" | "cancelled";

export type NextAction = "register_host" | "wait_setup" | "join" | "view_result" | "cancelled";

export type LinkStatusBody = {
  inviteToken: string;
  promiseStatus: PromiseStatusView;
  promiseId: string | null;
  nextAction: NextAction;
  pollAfterMs: number | null;
  draftExpired: boolean;
};

export type LinkStatusResult = { kind: "expired" } | { kind: "ok"; body: LinkStatusBody };

// 만료 계산에 필요한 값만. LinkWithPromise도 그대로 넘길 수 있고, 세션 일괄 갱신은 갱신 뒤 새 상태를 넘긴다
export type AccessExpiryLink = {
  createdAt: Date;
  promise: Pick<LinkPromise, "status" | "votingDeadlineAt" | "confirmedStartAt"> | null;
};

// 링크 만료 기준 시각 (MEMBER-01-02). 재조율로 다시 모집하면 voting_deadline_at이 새 마감으로 바뀌어 있다
export function linkExpiryBase(link: AccessExpiryLink): Date {
  const promise = link.promise;
  if (!promise) return link.createdAt;
  if (promise.status === "confirmed" && promise.confirmedStartAt) return promise.confirmedStartAt;
  return promise.votingDeadlineAt ?? link.createdAt;
}

// 링크 만료 시각 = 로그인 가능 기간 끝 = draft를 뺀 모든 세션의 expires_at (R-11, R-13, C-10·C-11 잠정)
// 링크 410(MEMBER-API-01), 로그인 410·세션 발급(MEMBER-API-04), 참여자 등록 세션(MEMBER-API-03),
// 세션 일괄 갱신(session-expiry.ts)이 모두 이 함수 하나로 계산한다.
// draft 세션은 기준이 달라(발급 + 24시간) 여기서 다루지 않는다 — session.ts DRAFT_SESSION_TTL_SECONDS 참고
export function accessExpiresAt(link: AccessExpiryLink): Date {
  return new Date(linkExpiryBase(link).getTime() + LINK_EXPIRY_MS);
}

const NEXT_ACTION: Record<Exclude<PromiseStatusView, "unclaimed">, NextAction> = {
  draft: "wait_setup",
  collecting: "join",
  closed: "view_result",
  confirmed: "view_result",
  cancelled: "cancelled",
};

function unclaimed(inviteToken: string, draftExpired: boolean): LinkStatusResult {
  return {
    kind: "ok",
    body: {
      inviteToken,
      promiseStatus: "unclaimed",
      promiseId: null,
      nextAction: "register_host",
      pollAfterMs: null,
      draftExpired,
    },
  };
}

// 계산만 한다. 만료 draft의 삭제는 MEMBER-API-02가 잠금 후 수행한다 (STATE-02-02)
export function resolveLinkStatus(link: LinkWithPromise, now: Date): LinkStatusResult {
  // 경계값: 기준 시각 + 7일 ≤ 판정 시각이면 만료
  if (accessExpiresAt(link).getTime() <= now.getTime()) {
    return { kind: "expired" };
  }

  const promise = link.promise;
  if (!promise) return unclaimed(link.inviteToken, false);

  if (!Object.hasOwn(NEXT_ACTION, promise.status)) {
    throw new Error(`알 수 없는 약속 상태: ${promise.status}`);
  }
  const status = promise.status as keyof typeof NEXT_ACTION;

  if (status === "draft" && promise.createdAt.getTime() + DRAFT_EXPIRY_MS <= now.getTime()) {
    return unclaimed(link.inviteToken, true);
  }

  return {
    kind: "ok",
    body: {
      inviteToken: link.inviteToken,
      promiseStatus: status,
      promiseId: promise.id,
      nextAction: NEXT_ACTION[status],
      pollAfterMs: status === "draft" ? DRAFT_POLL_AFTER_MS : null,
      draftExpired: false,
    },
  };
}
