import {
  draftExpired,
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
import { cancelPromise } from "@/lib/state/cancel-promise";
import { toSeoulIsoString } from "@/lib/time/seoul";

// STATE-API-07 약속 취소. 본문은 없다 — 보낸 본문은 읽지 않는다
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/cancel">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/cancel">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  const { promiseId } = await ctx.params;
  try {
    // 이미 cancelled면 세션 검사보다 먼저 409 (처리 순서 1·8)
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다.
    // 성공하면 result.session.expiresAt = 취소 시각이라 같은 헬퍼가 값을 비우고 Max-Age=0을 낸다
    const result = await cancelPromise(auth);
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
      case "draft_expired":
        return reply(draftExpired());
      case "ok":
        return reply(
          Response.json({
            promiseId: auth.promise.id,
            promiseStatus: result.promiseStatus,
            cancelledAt: toSeoulIsoString(result.cancelledAt),
            message: "취소된 약속입니다.",
          }),
        );
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("약속 취소 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
