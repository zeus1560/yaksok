import {
  forbidden,
  internalError,
  invalidConfirmationCandidate,
  invalidOrigin,
  invalidPromiseState,
  invalidRequest,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
  validationFailed,
} from "@/lib/api-error";
import {
  authenticatePromiseSession,
  isPromiseIdFormat,
  withSessionCookie,
} from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";
import { parseConfirmationBody } from "@/lib/state/confirm-input";
import { confirmSchedule } from "@/lib/state/confirm-schedule";
import { toSeoulIsoString } from "@/lib/time/seoul";

// STATE-API-05 최종 일정 확정. 이 약속의 현재 active host만
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/confirmation">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/confirmation">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  const { promiseId } = await ctx.params;
  // 형식 검사가 먼저다(처리 순서 1): promiseId 400 → 본문 400 → startAt 422 → 약속 존재 404 → 취소 409 → 세션 401·403
  if (!isPromiseIdFormat(promiseId)) return invalidRequest();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }
  const input = parseConfirmationBody(body);
  if (input.kind === "invalid_request") return invalidRequest();
  if (input.kind === "invalid_start_at") {
    return validationFailed("startAt", "확정 시작 시각을 확인해 주세요.");
  }

  try {
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const result = await confirmSchedule(auth, input.startAt);
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
        return reply(invalidPromiseState(result.promiseStatus, ["closed"]));
      case "invalid_candidate":
        return reply(invalidConfirmationCandidate());
      case "ok":
        return reply(
          Response.json({
            promiseId: auth.promise.id,
            promiseStatus: "confirmed",
            currentConfirmation: {
              startAt: toSeoulIsoString(result.startAt),
              endAt: toSeoulIsoString(result.endAt),
            },
          }),
        );
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("일정 확정 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
