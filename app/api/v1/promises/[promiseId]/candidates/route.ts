import {
  forbidden,
  internalError,
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
import { parseCandidatePage, sliceCandidatePage } from "@/lib/state/candidate-page";
import { getPromiseCandidates } from "@/lib/state/promise-candidates";
import { toSeoulIsoString } from "@/lib/time/seoul";

// STATE-API-10 공식 시간 후보 조회. 이 약속의 active 참여자면 누구나(방장만이 아님) 조회한다
// 읽기 요청이라 Origin을 검사하지 않는다. 세션 토큰·쿠키 값은 로그에 남기지 않는다
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/candidates">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/candidates">,
): Promise<Response> {
  const { promiseId } = await ctx.params;
  // 형식 검사가 먼저다: promiseId 400 → limit·offset 422 → 약속 존재 404 → 취소 409 → 세션 401·403
  if (!isPromiseIdFormat(promiseId)) return invalidRequest();
  const page = parseCandidatePage(new URL(request.url).searchParams);
  if (page.kind === "invalid") {
    return validationFailed(page.field, "후보 조회 범위를 확인해 주세요.");
  }

  try {
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const result = await getPromiseCandidates(auth);
    const reply = (response: Response) => withSessionCookie(response, auth, result.session);
    switch (result.kind) {
      case "not_found":
        return reply(promiseNotFound());
      case "cancelled":
        return reply(promiseCancelled());
      case "unauthenticated":
        return reply(unauthenticated());
      case "invalid_state":
        return reply(invalidPromiseState(result.promiseStatus, ["closed"]));
      case "ok": {
        const sliced = sliceCandidatePage(result.candidates, page);
        // 참여자별 슬롯·제출 여부·닉네임은 담지 않는다. 후보는 startAt으로 식별하고 ID·순위를 만들지 않는다
        return reply(
          Response.json({
            promiseId: auth.promise.id,
            promiseStatus: "closed",
            calculatedAt: toSeoulIsoString(result.calculatedAt),
            limit: page.limit,
            offset: page.offset,
            total: sliced.total,
            hasMore: sliced.hasMore,
            nextOffset: sliced.nextOffset,
            candidates: sliced.items.map((candidate) => ({
              startAt: toSeoulIsoString(candidate.startAt),
              endAt: toSeoulIsoString(candidate.endAt),
              availableParticipantCount: candidate.availableParticipantCount,
            })),
          }),
        );
      }
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      "공식 시간 후보 조회 실패",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return internalError();
  }
}
