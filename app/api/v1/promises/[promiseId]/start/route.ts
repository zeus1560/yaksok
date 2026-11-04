import {
  draftExpired,
  forbidden,
  internalError,
  invalidOrigin,
  invalidPromiseState,
  invalidRequest,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
  validationFailed,
} from "@/lib/api-error";
import { authenticatePromiseSession, withSessionCookie } from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";
import { startCollecting } from "@/lib/state/start-collecting";
import { minuteToTime, parseStartSettings } from "@/lib/state/start-settings";
import { toSeoulIsoString } from "@/lib/time/seoul";

// STATE-API-02 설정 완료와 모집 시작
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/start">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/start">,
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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return withSessionCookie(invalidRequest(), auth);
    }
    const input = parseStartSettings(body);
    if (!input) return withSessionCookie(invalidRequest(), auth);

    const result = await startCollecting(auth, input);
    const reply = (response: Response) => withSessionCookie(response, auth, result.session);
    switch (result.kind) {
      case "not_found":
        return reply(promiseNotFound());
      case "cancelled":
        return reply(promiseCancelled());
      case "forbidden":
        return reply(forbidden());
      case "invalid_state":
        return reply(invalidPromiseState(result.promiseStatus, ["draft"]));
      case "draft_expired":
        return reply(draftExpired());
      case "validation_failed":
        return reply(validationFailed(result.violation.field, result.violation.message));
      case "ok": {
        const s = result.settings;
        return reply(
          Response.json({
            promiseId: auth.promise.id,
            promiseStatus: "collecting",
            settings: {
              participantLimit: s.participantLimit,
              dateRange: { startDate: s.startDate, endDate: s.endDate },
              dailyTimeRange: {
                startTime: minuteToTime(s.startMinute),
                endTime: minuteToTime(s.endMinute),
              },
              durationMinutes: s.durationMinutes,
              votingDeadlineAt: toSeoulIsoString(s.votingDeadlineAt),
            },
          }),
        );
      }
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("모집 시작 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
