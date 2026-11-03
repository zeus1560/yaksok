import { prisma } from "@/lib/prisma";
import { isInviteTokenFormat } from "./invite-link";
import { resolveLinkStatus, type LinkStatusResult } from "./link-status";

export type LinkLookupResult = { kind: "not_found" } | LinkStatusResult;

// 판정은 DB 시각으로 한다 (API_CONVENTIONS 4.2). 잠그지 않는 GET이므로 clock_timestamp()를 조회와 함께 읽는다
async function dbNow(): Promise<Date> {
  const [row] = await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return row.now;
}

// MEMBER-API-01. 읽기만 하며 잠금·쓰기·삭제를 하지 않는다. now를 넘기면 그 시각으로 판정한다
export async function lookupInviteLink(inviteToken: string, now?: Date): Promise<LinkLookupResult> {
  if (!isInviteTokenFormat(inviteToken)) return { kind: "not_found" };

  const [link, judgedAt] = await Promise.all([
    prisma.promiseLink.findUnique({
      where: { inviteToken },
      select: {
        inviteToken: true,
        createdAt: true,
        promise: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            votingDeadlineAt: true,
            confirmedStartAt: true,
          },
        },
      },
    }),
    now ? Promise.resolve(now) : dbNow(),
  ]);

  if (!link) return { kind: "not_found" };
  return resolveLinkStatus(link, judgedAt);
}
