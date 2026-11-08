import {
  forbidden,
  internalError,
  invalidOrigin,
  invalidPromiseState,
  invalidRequest,
  promiseCancelled,
  promiseNotFound,
  settingsViolation,
  unauthenticated,
} from "@/lib/api-error";
import {
  authenticatePromiseSession,
  isPromiseIdFormat,
  withSessionCookie,
} from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";
import { buildSettingsView } from "@/lib/state/promise-view";
import { parseSettingsUpdate } from "@/lib/state/settings-patch";
import { updateSettings } from "@/lib/state/update-settings";

// STATE-API-03 모집 중 설정 변경. 이 약속의 현재 active host만
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/settings">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/settings">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  const { promiseId } = await ctx.params;
  // 형식 검사가 먼저다: promiseId 400 → 본문 400(빈 요청 포함) → 약속 존재 404 → 취소 409 → 세션 401·403
  if (!isPromiseIdFormat(promiseId)) return invalidRequest();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }
  const input = parseSettingsUpdate(body);
  if (!input) return invalidRequest();

  try {
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const result = await updateSettings(auth, input);
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
      case "validation_failed":
        return reply(settingsViolation(result.violation));
      case "ok": {
        const s = result.settings;
        return reply(
          Response.json({
            promiseId: auth.promise.id,
            promiseStatus: "collecting",
            settings: buildSettingsView({
              participantLimit: s.participantLimit,
              dateRangeStart: s.startDate,
              dateRangeEnd: s.endDate,
              dailyStartMinute: s.startMinute,
              dailyEndMinute: s.endMinute,
              durationMinutes: s.durationMinutes,
              votingDeadlineAt: s.votingDeadlineAt,
            }),
            changeImpact: result.changeImpact,
          }),
        );
      }
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("설정 변경 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
