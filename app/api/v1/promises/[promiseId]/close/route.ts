import {
  forbidden,
  internalError,
  invalidOrigin,
  invalidPromiseState,
  invalidRequest,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/api-error";
import { authenticatePromiseSession, withSessionCookie } from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";
import { closeVoting } from "@/lib/state/close-voting";

// STATE-API-04 방장 마감. 본문은 없다 — 보낸 본문은 읽지 않는다
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/close">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/close">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  const { promiseId } = await ctx.params;
  try {
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const result = await closeVoting(auth);
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
      case "invalid_state":
        return reply(invalidPromiseState(result.promiseStatus, ["collecting", "closed"]));
      case "ok":
        return reply(Response.json({ promiseId: auth.promise.id, promiseStatus: result.promiseStatus }));
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("방장 마감 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
