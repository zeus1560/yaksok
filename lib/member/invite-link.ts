import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
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

export function buildInviteUrl(baseUrl: string, inviteToken: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/p/${inviteToken}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// 링크만 만든다. 약속·참여자는 방장 등록(MEMBER-API-02) 때 생긴다 (STATE-02-01)
export async function issueInviteLink(source: InviteLinkSource): Promise<IssuedInviteLink> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_BASE_URL이 설정되지 않았습니다.");
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
