import { internalError, invalidOrigin } from "@/lib/api-error";
import { rateLimitResponse } from "@/lib/limit/rate-limit-store";
import { issueInviteLink } from "@/lib/member/invite-link";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";

// MEMBER-API-09 초대 링크 발급 (웹). 요청 본문은 읽지 않는다
export async function POST(request: Request) {
  return noStore(await handle(request));
}

async function handle(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return invalidOrigin();
  }

  try {
    // IP 기준 1분 10회 (035, R-41)
    const limited = await rateLimitResponse(request, "links");
    if (limited) return limited;

    const { inviteToken, inviteUrl } = await issueInviteLink("web", request.headers.get("origin"));
    return Response.json({ inviteToken, inviteUrl, nextAction: "register_host" }, { status: 201 });
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      "초대 링크 발급 실패",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return internalError();
  }
}
