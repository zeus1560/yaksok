import {
  forbidden,
  internalError,
  invalidRequest,
  promiseNotFound,
  unauthenticated,
} from "@/lib/api-error";
import { getMyParticipation } from "@/lib/member/me";
import { authenticatePromiseSession, withSessionCookie } from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { toSeoulIsoMillisString, toSeoulIsoString } from "@/lib/time/seoul";

// MEMBER-API-05 내 참여 정보 조회. 화면 진입 시 "지금 보는 사람이 누구인지"를 서버 세션으로 확인한다
// 읽기 요청이라 Origin을 검사하지 않는다. 허용 상태는 전체(cancelled 포함)
// 세션 토큰·쿠키 값은 로그에 남기지 않는다
export async function GET(request: Request, ctx: RouteContext<"/api/v1/promises/[promiseId]/me">) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/me">,
): Promise<Response> {
  const { promiseId } = await ctx.params;
  try {
    const auth = await authenticatePromiseSession(request, promiseId, { allowCancelled: true });
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    // allowCancelled이므로 cancelled는 오지 않는다. 오면 세션 없이 취소된 것으로 보고 401
    if (auth.kind === "unauthenticated" || auth.kind === "cancelled") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const result = await getMyParticipation(auth);
    const reply = (response: Response) => withSessionCookie(response, auth, result.session);
    if (result.kind === "unauthenticated") return reply(unauthenticated());

    return reply(
      Response.json({
        participantId: result.participantId,
        nickname: result.nickname,
        role: result.role,
        status: result.status,
        // 제출 시각은 TIME-API-01 submittedAt과 같은 밀리초 표기 (R-14)
        availabilitySubmittedAt:
          result.availabilitySubmittedAt === null
            ? null
            : toSeoulIsoMillisString(result.availabilitySubmittedAt),
        promiseStatus: result.promiseStatus,
        deadlinePassed: result.deadlinePassed,
        permissions: result.permissions,
        sessionExpiresAt: toSeoulIsoString(result.sessionExpiresAt),
      }),
    );
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      "내 참여 정보 조회 실패",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return internalError();
  }
}
