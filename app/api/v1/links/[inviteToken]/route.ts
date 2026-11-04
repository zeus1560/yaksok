import { internalError, linkExpired, linkNotFound } from "@/lib/api-error";
import { lookupInviteLink } from "@/lib/member/link-lookup";
import { noStore } from "@/lib/no-store";

// MEMBER-API-01 초대 링크 조회. 인증·Origin 검증 없음
// 폴링 대상이고 재조율로 새 마감이 생기면 410도 풀릴 수 있으므로 어떤 응답도 캐시하지 않는다
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/links/[inviteToken]">) {
  const { inviteToken } = await ctx.params;
  return noStore(await respond(inviteToken));
}

async function respond(inviteToken: string): Promise<Response> {
  try {
    const result = await lookupInviteLink(inviteToken);
    if (result.kind === "not_found") return linkNotFound();
    if (result.kind === "expired") return linkExpired();
    return Response.json(result.body);
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      "초대 링크 조회 실패",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return internalError();
  }
}
