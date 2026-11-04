import {
  accessPeriodExpired,
  draftExpired,
  internalError,
  invalidCredentials,
  invalidOrigin,
  invalidRequest,
  participantCancelled,
  promiseCancelled,
  promiseNotFound,
  validationFailed,
} from "@/lib/api-error";
import { loginParticipant } from "@/lib/member/login";
import { validateNickname } from "@/lib/member/nickname";
import { isPinFormat } from "@/lib/member/pin";
import { sessionCookie } from "@/lib/member/session";
import { isAllowedOrigin } from "@/lib/origin";
import { toSeoulIsoString } from "@/lib/time/seoul";

// MEMBER-API-04 참여자 재인증. PIN·세션 토큰 원문은 로그와 오류 응답에 남기지 않는다
// 시도 제한은 구현하지 않는다(2026-10-12 결정). 429를 반환하지 않는다
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/auth/session">,
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

  // 등록과 같은 규칙으로 정규화·검증해야 저장된 normalized_nickname과 일치한다
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
    const result = await loginParticipant(promiseId, { nickname: checked.nickname, pin });
    if (result.kind === "invalid_request") return invalidRequest();
    if (result.kind === "not_found") return promiseNotFound();
    if (result.kind === "cancelled") return promiseCancelled();
    if (result.kind === "expired") return accessPeriodExpired();
    if (result.kind === "draft_expired") return draftExpired();
    if (result.kind === "invalid_credentials") return invalidCredentials();
    if (result.kind === "participant_cancelled") return participantCancelled();

    const response = Response.json({
      participantId: result.participantId,
      nickname: result.nickname,
      role: result.role,
      status: result.status,
      promiseStatus: result.promiseStatus,
      sessionExpiresAt: toSeoulIsoString(result.sessionExpiresAt),
    });
    response.headers.set(
      "Set-Cookie",
      sessionCookie(result.promiseId, result.sessionToken, result.sessionMaxAgeSeconds),
    );
    return response;
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("재인증 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
