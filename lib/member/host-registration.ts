import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { deleteDraftPromise } from "./draft-discard";
import { isInviteTokenFormat } from "./invite-link";
import { DRAFT_EXPIRY_MS, resolveLinkStatus, type LinkPromise } from "./link-status";
import { hashPin } from "./pin";
import { DRAFT_SESSION_TTL_SECONDS, generateSessionToken, hashSessionToken } from "./session";

export type HostRegistrationResult =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_registered" }
  | {
      kind: "created";
      promiseId: string;
      participantId: string;
      nickname: string;
      draftExpiresAt: Date;
      sessionToken: string;
      sessionMaxAgeSeconds: number;
    };

type LinkRow = { id: string; created_at: Date };
type PromiseRow = {
  id: string;
  status: string;
  created_at: Date;
  voting_deadline_at: Date | null;
  confirmed_start_at: Date | null;
};

// promise_link_id UNIQUE 위반은 트랜잭션을 롤백시킨 뒤 409로 바꾼다
class LinkAlreadyClaimed extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function toLinkPromise(row: PromiseRow): LinkPromise {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    votingDeadlineAt: row.voting_deadline_at,
    confirmedStartAt: row.confirmed_start_at,
  };
}

// MEMBER-API-02 방장 등록. nickname은 validateNickname을 통과한 값, pin은 형식 검사를 통과한 값이다
// 잠금 순서는 promise_links → promises (API_CONVENTIONS 4.1), 판정 시각은 잠금 후 clock_timestamp() (4.2)
export async function registerHost(
  inviteToken: string,
  input: { nickname: string; pin: string },
  options: { sessionToken?: string } = {},
): Promise<HostRegistrationResult> {
  if (!isInviteTokenFormat(inviteToken)) return { kind: "not_found" };

  // 해시 계산은 수백 ms 걸리므로 잠금을 잡기 전에 끝낸다
  const passwordHash = await hashPin(input.pin);
  const sessionToken = options.sessionToken ?? generateSessionToken();

  try {
    return await prisma.$transaction(async (tx) => {
      const [link] = await tx.$queryRaw<LinkRow[]>`
        SELECT id, created_at FROM promise_links WHERE invite_token = ${inviteToken} FOR UPDATE`;
      if (!link) return { kind: "not_found" } as const;

      const [promiseRow] = await tx.$queryRaw<PromiseRow[]>`
        SELECT id, status, created_at, voting_deadline_at, confirmed_start_at
        FROM promises WHERE promise_link_id = ${link.id}::uuid FOR UPDATE`;
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;

      // 판정은 MEMBER-API-01과 같은 함수로 한다. 잠금 후 다시 읽은 값이므로 설정 완료와 경쟁해도 안전하다
      const status = resolveLinkStatus(
        {
          inviteToken,
          createdAt: link.created_at,
          promise: promiseRow ? toLinkPromise(promiseRow) : null,
        },
        now,
      );
      if (status.kind === "expired") return { kind: "expired" } as const;

      if (promiseRow && status.body.draftExpired) {
        // 만료 draft 물리 삭제: 세션 → 방장 참여자 → promise. 링크는 남겨 재사용한다 (STATE-02-02, ERD 10절)
        await deleteDraftPromise(tx, promiseRow.id);
      } else if (status.body.promiseStatus !== "unclaimed") {
        return { kind: "already_registered" } as const;
      }

      // created_at을 판정 시각으로 둬서 draft 10분이 잠금 대기 시간만큼 줄지 않게 한다
      const promise = await tx.promise
        .create({
          data: { promiseLinkId: link.id, status: "draft", createdAt: now },
          select: { id: true, createdAt: true },
        })
        .catch((error: unknown) => {
          throw isUniqueViolation(error) ? new LinkAlreadyClaimed() : error;
        });

      const participant = await tx.participant.create({
        data: {
          promiseId: promise.id,
          nickname: input.nickname,
          normalizedNickname: input.nickname,
          passwordHash,
          role: "host",
          status: "active",
        },
        select: { id: true },
      });

      await tx.participantSession.create({
        data: {
          participantId: participant.id,
          sessionTokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(now.getTime() + DRAFT_SESSION_TTL_SECONDS * 1000),
        },
        select: { id: true },
      });

      return {
        kind: "created",
        promiseId: promise.id,
        participantId: participant.id,
        nickname: input.nickname,
        draftExpiresAt: new Date(promise.createdAt.getTime() + DRAFT_EXPIRY_MS),
        sessionToken,
        sessionMaxAgeSeconds: DRAFT_SESSION_TTL_SECONDS,
      } as const;
    });
  } catch (error) {
    if (error instanceof LinkAlreadyClaimed) return { kind: "already_registered" };
    throw error;
  }
}
