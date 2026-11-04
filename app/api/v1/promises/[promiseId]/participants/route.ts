import {
  alreadyParticipant,
  deadlinePassed,
  draftExpired,
  internalError,
  invalidOrigin,
  invalidPromiseState,
  invalidRequest,
  nicknameTaken,
  promiseCancelled,
  promiseFull,
  promiseNotFound,
  promiseNotOpen,
  validationFailed,
} from "@/lib/api-error";
import { validateNickname } from "@/lib/member/nickname";
import { registerParticipant } from "@/lib/member/participant-registration";
import { isPinFormat } from "@/lib/member/pin";
import { sessionCookie } from "@/lib/member/session";
import { isAllowedOrigin } from "@/lib/origin";

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
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
