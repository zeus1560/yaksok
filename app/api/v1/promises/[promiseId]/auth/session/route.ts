import {
  accessPeriodExpired,
  draftExpired,
  forbidden,
  internalError,
  invalidCredentials,
  invalidOrigin,
  invalidRequest,
  participantCancelled,
  promiseCancelled,
  promiseNotFound,
  tooManyAttempts,
  unauthenticated,
  validationFailed,
} from "@/lib/api-error";
import { clientIpKey } from "@/lib/limit/client-ip";
import { rateLimitResponse } from "@/lib/limit/rate-limit-store";
import { loginParticipant } from "@/lib/member/login";
import { logoutSession, parseAllDevices } from "@/lib/member/logout";
import { isPromiseIdFormat } from "@/lib/member/session-auth";
import { validateNickname } from "@/lib/member/nickname";
import { isPinFormat } from "@/lib/member/pin";
import { sessionCookie } from "@/lib/member/session";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";
import { toSeoulIsoString } from "@/lib/time/seoul";

// MEMBER-API-04 참여자 재인증. PIN·세션 토큰 원문은 로그와 오류 응답에 남기지 않는다
// 429 두 가지(035, R-41): IP 기준 요청 수 RATE_LIMITED(1분 30회), PIN 시도 제한 TOO_MANY_ATTEMPTS(약속 상태 판정 뒤, PIN 비교 전)
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/auth/session">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/auth/session">,
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
    // 입력 형식 검사 뒤, DB·scrypt를 쓰기 전에 센다
    const limited = await rateLimitResponse(request, "login");
    if (limited) return limited;

    const result = await loginParticipant(
      promiseId,
      { nickname: checked.nickname, pin },
      { ipKey: clientIpKey(request.headers) },
    );
    if (result.kind === "invalid_request") return invalidRequest();
    if (result.kind === "not_found") return promiseNotFound();
    if (result.kind === "cancelled") return promiseCancelled();
    if (result.kind === "expired") return accessPeriodExpired();
    if (result.kind === "draft_expired") return draftExpired();
    if (result.kind === "invalid_credentials") return invalidCredentials();
    if (result.kind === "too_many_attempts") return tooManyAttempts(result.retryAfterSeconds);
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

// MEMBER-API-07 로그아웃. 탈퇴가 아니다 — 세션 행만 지운다. 본문은 읽지 않는다
// 검사 순서: Origin 403 → promiseId 400 → allDevices 400 → 404 → 쿠키 없음 401 → 다른 약속 세션 403 → 삭제 204
// 취소된 약속·만료 세션·행 없음도 204와 쿠키 제거다(R-11 예외, DECISION_CONFLICTS R-31)
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/auth/session">,
) {
  return noStore(await handleLogout(request, ctx));
}

async function handleLogout(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/auth/session">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  const { promiseId } = await ctx.params;
  if (!isPromiseIdFormat(promiseId)) return invalidRequest();
  const allDevices = parseAllDevices(new URL(request.url).searchParams);
  if (allDevices === null) return invalidRequest();

  try {
    const result = await logoutSession(request, promiseId, { allDevices });
    if (result.kind === "not_found") return promiseNotFound();
    if (result.kind === "unauthenticated") return unauthenticated();
    if (result.kind === "forbidden") return forbidden();

    const response = new Response(null, { status: 204 });
    response.headers.set("Set-Cookie", sessionCookie(result.promiseId, "", 0));
    return response;
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error("로그아웃 실패", error instanceof Error ? error.name : "unknown", code ?? "");
    return internalError();
  }
}
