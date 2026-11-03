import {
  hostAlreadyRegistered,
  internalError,
  invalidOrigin,
  invalidRequest,
  linkExpired,
  linkNotFound,
  validationFailed,
} from "@/lib/api-error";
import { registerHost } from "@/lib/member/host-registration";
import { validateNickname } from "@/lib/member/nickname";
import { isPinFormat } from "@/lib/member/pin";
import { sessionCookie } from "@/lib/member/session";
import { isAllowedOrigin } from "@/lib/origin";
import { toSeoulIsoString } from "@/lib/time/seoul";

// MEMBER-API-02 방장 등록 (약속 생성). PIN·세션 토큰 원문은 로그와 오류 응답에 남기지 않는다
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/links/[inviteToken]/host">,
) {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }
  const { nickname, pin } = (body ?? {}) as { nickname?: unknown; pin?: unknown };
  if (typeof nickname !== "string" || typeof pin !== "string") return invalidRequest();

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

  const { inviteToken } = await ctx.params;
  try {
    const result = await registerHost(inviteToken, { nickname: checked.nickname, pin });
    if (result.kind === "not_found") return linkNotFound();
    if (result.kind === "expired") return linkExpired();
    if (result.kind === "already_registered") return hostAlreadyRegistered();

    const response = Response.json(
      {
        promiseId: result.promiseId,
        participantId: result.participantId,
        nickname: result.nickname,
        role: "host",
        promiseStatus: "draft",
        draftExpiresAt: toSeoulIsoString(result.draftExpiresAt),
      },
      { status: 201 },
    );
    response.headers.set(
      "Set-Cookie",
      sessionCookie(result.promiseId, result.sessionToken, result.sessionMaxAgeSeconds),
    );
    return response;
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("방장 등록 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
