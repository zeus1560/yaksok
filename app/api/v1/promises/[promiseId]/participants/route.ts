import {
  alreadyParticipant,
  deadlinePassed,
  draftExpired,
  forbidden,
  internalError,
  invalidOrigin,
  invalidPromiseState,
  invalidRequest,
  nicknameTaken,
  promiseCancelled,
  promiseFull,
  promiseNotFound,
  promiseNotOpen,
  unauthenticated,
  validationFailed,
} from "@/lib/api-error";
import { validateNickname } from "@/lib/member/nickname";
import { getParticipantList } from "@/lib/member/participant-list";
import { registerParticipant } from "@/lib/member/participant-registration";
import { isPinFormat } from "@/lib/member/pin";
import { sessionCookie } from "@/lib/member/session";
import { authenticatePromiseSession, withSessionCookie } from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";

// MEMBER-API-06 참여자 명단 조회. 이 약속의 active 참여자만, draft는 방장 포함 403
// 읽기 요청이라 Origin을 검사하지 않는다. 세션 토큰·쿠키 값은 로그에 남기지 않는다
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/participants">,
) {
  return noStore(await handleList(request, ctx));
}

async function handleList(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/participants">,
): Promise<Response> {
  const { promiseId } = await ctx.params;

  try {
    // 순서: promiseId 400 → 약속 존재 404 → 취소 409(세션보다 우선, R-11) → 세션 401 → 다른 약속 403
    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const result = await getParticipantList(auth);
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
        // 제출 여부·status·PIN 해시·세션·정규화 닉네임은 담지 않는다 (MEMBER-08-02)
        return reply(
          Response.json({
            participantLimit: result.participantLimit,
            currentParticipantCount: result.participants.length,
            participants: result.participants,
          }),
        );
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      "참여자 명단 조회 실패",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return internalError();
  }
}

// MEMBER-API-03 참여자 등록. PIN·세션 토큰 원문은 로그와 응답 본문에 남기지 않는다
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/participants">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/participants">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }
  const { nickname, pin } = (body ?? {}) as { nickname?: unknown; pin?: unknown };
  if (typeof nickname !== "string" || typeof pin !== "string") return invalidRequest();

  // 저장된 normalized_nickname과 같은 규칙(trim → NFC)으로 정규화해야 중복 판정이 맞는다 (R-10)
  const checked = validateNickname(nickname);
  if (!checked.ok) {
    return validationFailed(
      "nickname",
      checked.reason === "emoji"
        ? "닉네임에 이모지는 사용할 수 없습니다."
        : "닉네임은 2자 이상 12자 이하여야 합니다.",
    );
  }
  if (!isPinFormat(pin)) return validationFailed("pin", "PIN은 숫자 4자리여야 합니다.");

  const { promiseId } = await ctx.params;
  try {
    const result = await registerParticipant(request, promiseId, {
      nickname: checked.nickname,
      pin,
    });
    switch (result.kind) {
      case "invalid_request":
        return invalidRequest();
      case "not_found":
        return promiseNotFound();
      case "cancelled":
        return promiseCancelled();
      case "already_participant":
        return alreadyParticipant();
      case "draft_expired":
        return draftExpired();
      case "not_open":
        return promiseNotOpen();
      case "invalid_state":
        return invalidPromiseState(result.promiseStatus, ["collecting"]);
      case "deadline_passed":
        return deadlinePassed();
      case "nickname_taken":
        return nicknameTaken();
      case "full":
        return promiseFull();
      case "created": {
        const response = Response.json(
          {
            participantId: result.participantId,
            nickname: result.nickname,
            role: "member",
            status: "active",
            availabilitySubmittedAt: null,
            currentParticipantCount: result.currentParticipantCount,
            participantLimit: result.participantLimit,
          },
          { status: 201 },
        );
        response.headers.set(
          "Set-Cookie",
          sessionCookie(result.promiseId, result.sessionToken, result.sessionMaxAgeSeconds),
        );
        return response;
      }
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("참여자 등록 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
