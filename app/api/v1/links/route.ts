import { internalError, invalidOrigin } from "@/lib/api-error";
import { issueInviteLink } from "@/lib/member/invite-link";
import { isAllowedOrigin } from "@/lib/origin";

// MEMBER-API-09 초대 링크 발급 (웹). 요청 본문은 읽지 않는다
export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return invalidOrigin();
  }

  try {
    const { inviteToken, inviteUrl } = await issueInviteLink("web");
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
