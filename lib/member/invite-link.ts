import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { inviteBaseUrl } from "@/lib/public-url";
import { Prisma } from "@/prisma/generated/client";

// 발급 출처. 클라이언트 입력으로 받지 않고 호출하는 서버 라우트가 고정값으로 넘긴다 (MEMBER-API-09)
export type InviteLinkSource = "web" | "kakao";

export type IssuedInviteLink = {
  inviteToken: string;
  inviteUrl: string;
};

// 128비트 암호학적 난수, base64url 22자
export function generateInviteToken(): string {
  return randomBytes(16).toString("base64url");
}

// generateInviteToken이 만드는 형식. 형식이 다르면 DB를 조회하지 않고 없는 토큰으로 본다
export function isInviteTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(token);
}

export function buildInviteUrl(baseUrl: string, inviteToken: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/p/${inviteToken}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// 링크만 만든다. 약속·참여자는 방장 등록(MEMBER-API-02) 때 생긴다 (STATE-02-01)
// requestOrigin: 웹은 허용 검사를 통과한 요청 Origin. 미리보기 배포에서는 그 주소로 링크를 만든다(032)
export async function issueInviteLink(
  source: InviteLinkSource,
  requestOrigin?: string | null,
): Promise<IssuedInviteLink> {
  const baseUrl = inviteBaseUrl(process.env, requestOrigin);
  if (!baseUrl) {
    throw new Error("초대 링크 기준 주소(NEXT_PUBLIC_BASE_URL)가 설정되지 않았습니다.");
  }

  // invite_token UNIQUE 위반이면 새 토큰으로 1회만 재시도한다
  for (let attempt = 0; ; attempt++) {
    const inviteToken = generateInviteToken();
    try {
      await prisma.promiseLink.create({ data: { inviteToken, source }, select: { id: true } });
      return { inviteToken, inviteUrl: buildInviteUrl(baseUrl, inviteToken) };
    } catch (error) {
      if (attempt === 0 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}
