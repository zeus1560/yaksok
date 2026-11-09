import {
  cannotRemoveSelf,
  deadlinePassed,
  forbidden,
  internalError,
  invalidOrigin,
  invalidPromiseState,
  invalidRequest,
  participantNotFound,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/api-error";
import { removeParticipant } from "@/lib/member/remove-participant";
import {
  authenticatePromiseSession,
  isPromiseIdFormat,
  withSessionCookie,
} from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";

// MEMBER-API-08 방장의 참여자 내보내기. 본문은 읽지 않는다
// 같은 위치의 정적 경로 participants/me(STATE-API-08 본인 탈퇴)가 먼저 매칭되므로 participantId가 "me"인 요청은 여기 오지 않는다
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/participants/[participantId]">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/participants/[participantId]">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  const { promiseId, participantId } = await ctx.params;
  // 경로 형식은 약속 조회·세션 인증보다 먼저 본다 (STATE-API-09 공통 처리 1). 둘 다 UUID
  if (!isPromiseIdFormat(promiseId) || !isPromiseIdFormat(participantId)) return invalidRequest();

  try {
    // 존재 → cancelled(세션보다 우선, R-11) → 세션 → 다른 약속 세션
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다(잠금 후 다시 읽은 요청자 세션 기준)
    const result = await removeParticipant(auth, participantId);
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
        return reply(invalidPromiseState(result.promiseStatus, ["collecting"]));
      case "deadline_passed":
        return reply(deadlinePassed());
      case "participant_not_found":
        return reply(participantNotFound());
      case "cannot_remove_self":
        return reply(cannotRemoveSelf());
      case "ok":
        return reply(
          Response.json({
            participantId: result.participantId,
            participantStatus: "cancelled",
            currentParticipantCount: result.currentParticipantCount,
            participantLimit: result.participantLimit,
          }),
        );
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("참여자 내보내기 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
