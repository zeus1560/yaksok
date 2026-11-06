import {
  forbidden,
  internalError,
  invalidRequest,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/api-error";
import { authenticatePromiseSession, withSessionCookie } from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { getPromiseDetail } from "@/lib/state/promise-detail";
import { buildPromiseView } from "@/lib/state/promise-view";

// STATE-API-01 약속 상태와 설정 조회. 이 약속의 active 참여자, draft는 현재 host만
// 읽기 요청이라 Origin을 검사하지 않는다. 세션 토큰·쿠키 값은 로그에 남기지 않는다
export async function GET(request: Request, ctx: RouteContext<"/api/v1/promises/[promiseId]">) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]">,
): Promise<Response> {
  const { promiseId } = await ctx.params;

  try {
    // 순서: promiseId 400 → 약속 존재 404 → 취소 409(세션보다 우선) → 세션 401 → 다른 약속 403
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const result = await getPromiseDetail(auth);
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
      case "ok":
        // 다른 참여자의 개별 슬롯·제출 여부·닉네임은 담지 않는다. 본인 정보는 MEMBER-API-05
        return reply(
          Response.json(
            buildPromiseView({
              promise: result.promise,
              requesterRole: result.requesterRole,
              availableParticipantCount: result.availableParticipantCount,
              now: result.now,
            }),
          ),
        );
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      "약속 상태 조회 실패",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return internalError();
  }
}
