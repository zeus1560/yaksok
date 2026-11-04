import {
  draftExpired,
  forbidden,
  internalError,
  invalidRequest,
  promiseCancelled,
  promiseNotFound,
  promiseNotOpen,
  unauthenticated,
} from "@/lib/api-error";
import { authenticatePromiseSession, withSessionCookie } from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { minuteToTime } from "@/lib/state/start-settings";
import { getAvailabilityStatus } from "@/lib/time/availability-status";
import { toSeoulIsoMillisString, toSeoulIsoString } from "@/lib/time/seoul";

// TIME-API-02 가능 시간 현황 조회. 입력 화면의 5초 폴링 대상이다
// 읽기 요청이라 Origin을 검사하지 않는다. 세션 토큰·쿠키 값은 로그에 남기지 않는다
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/availability">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/availability">,
): Promise<Response> {
  const { promiseId } = await ctx.params;
  try {
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const result = await getAvailabilityStatus(auth);
    const reply = (response: Response) => withSessionCookie(response, auth, result.session);
    switch (result.kind) {
      case "not_found":
        return reply(promiseNotFound());
      case "cancelled":
        return reply(promiseCancelled());
      case "draft_expired":
        return reply(draftExpired());
      case "not_open":
        return reply(promiseNotOpen());
      case "unauthenticated":
        return reply(unauthenticated());
      case "ok": {
        const { settings } = result;
        return reply(
          Response.json({
            status: result.status,
            serverTime: toSeoulIsoMillisString(result.serverTime),
            settings: {
              dateRangeStart: settings.dateRangeStart,
              dateRangeEnd: settings.dateRangeEnd,
              dailyStartTime: minuteToTime(settings.dailyStartMinute),
              dailyEndTime: minuteToTime(settings.dailyEndMinute),
              durationMinutes: settings.durationMinutes,
              votingDeadlineAt: toSeoulIsoString(settings.votingDeadlineAt),
            },
            totalParticipants: result.participants.length,
            participants: result.participants.map((person) => ({
              participantId: person.participantId,
              nickname: person.nickname,
              isHost: person.isHost,
              availableSlots: person.availableSlots.map(toSeoulIsoString),
            })),
            me: {
              participantId: result.me.participantId,
              version: result.me.version,
              submitted: result.me.submitted,
              slots: result.me.slots.map(toSeoulIsoString),
            },
          }),
        );
      }
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      "가능 시간 현황 조회 실패",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return internalError();
  }
}
