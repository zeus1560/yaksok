import {
  forbidden,
  internalError,
  invalidOrigin,
  invalidRequest,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/api-error";
import { authenticatePromiseSession, withSessionCookie } from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";
import { withdrawParticipant } from "@/lib/state/withdraw-participant";
import { toSeoulIsoString } from "@/lib/time/seoul";

// STATE-API-08 본인 탈퇴와 자동 승계. 본문과 participantId는 받지 않는다 — 보낸 본문은 읽지 않는다
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/participants/me">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/participants/me">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  const { promiseId } = await ctx.params;
  try {
    // 형식 → 존재 → cancelled(세션보다 우선) → 세션. 잠금 없이 promise_link_id도 함께 읽는다 (처리 순서 1)
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다.
    // 성공하면 result.session.expiresAt이 탈퇴 시각이거나(세션 만료) null(draft 폐기로 행 삭제)이라 Max-Age=0이 된다
    const result = await withdrawParticipant(auth);
    const reply = (response: Response) => withSessionCookie(response, auth, result.session);
    switch (result.kind) {
      case "not_found":
        return reply(promiseNotFound());
      case "cancelled":
        return reply(promiseCancelled());
      case "unauthenticated":
        return reply(unauthenticated());
      case "forbidden":
        return reply(forbidden());
      case "draft_discarded":
        return reply(Response.json({ result: "draft_discarded", promiseId: null }));
      case "ok":
        return reply(
          Response.json({
            promiseId: auth.promise.id,
            promiseStatus: result.promiseStatus,
            participantStatus: result.participantStatus,
            participantCancelledAt: result.participantCancelledAt
              ? toSeoulIsoString(result.participantCancelledAt)
              : null,
            hostTransferred: result.hostTransferred,
            newHostParticipantId: result.newHostParticipantId,
            promiseCancelledAt: result.promiseCancelledAt
              ? toSeoulIsoString(result.promiseCancelledAt)
              : null,
          }),
        );
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("본인 탈퇴 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
