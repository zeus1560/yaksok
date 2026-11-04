import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { DRAFT_EXPIRY_MS, LINK_EXPIRY_MS, linkExpiryBase } from "./link-status";
import { hashPin } from "./pin";
import { generateSessionToken, hashSessionToken, sessionMaxAgeSeconds } from "./session";
import { findActivePromiseSession } from "./session-auth";

// 잠금 후 상태 판정 결과. 정원·닉네임은 트랜잭션 안에서 따로 본다
export type JoinRejection =
  | { kind: "cancelled" }
  | { kind: "draft_expired" }
  | { kind: "not_open" }
  | { kind: "invalid_state"; promiseStatus: string }
  | { kind: "deadline_passed" };

export type ParticipantRegistrationResult =
  | { kind: "invalid_request" }
  | { kind: "not_found" }
  | { kind: "already_participant" }
  | JoinRejection
  | { kind: "nickname_taken" }
  | { kind: "full" }
  | {
      kind: "created";
      promiseId: string;
      participantId: string;
      nickname: string;
      currentParticipantCount: number;
      participantLimit: number;
      sessionToken: string;
      sessionMaxAgeSeconds: number;
    };

export type JoinPromise = {
  status: string;
  createdAt: Date;
  votingDeadlineAt: Date | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 잠금 후 다시 읽은 약속으로 참여 가능 여부를 판정한다. now는 잠금 후 clock_timestamp() (API_CONVENTIONS 4.2)
export function resolveJoinAccess(promise: JoinPromise, now: Date): JoinRejection | null {
  if (promise.status === "cancelled") return { kind: "cancelled" };
  if (promise.status === "draft") {
    // 10분 지난 draft는 410. 이 API는 링크를 잠그지 않으므로 삭제하지 않는다 (STATE-02-02, R-12)
    return promise.createdAt.getTime() + DRAFT_EXPIRY_MS <= now.getTime()
      ? { kind: "draft_expired" }
      : { kind: "not_open" };
  }
  if (promise.status !== "collecting") return { kind: "invalid_state", promiseStatus: promise.status };
  // 경계값: 판정 시각 = 마감이면 거절. DB 상태는 바꾸지 않는다 (마감 처리는 STATE 담당)
  if (!promise.votingDeadlineAt) throw new Error("마감 시각이 없는 collecting 약속");
  if (promise.votingDeadlineAt.getTime() <= now.getTime()) return { kind: "deadline_passed" };
  return null;
}

type LockedPromise = {
  id: string;
  status: string;
  created_at: Date;
  voting_deadline_at: Date | null;
  confirmed_start_at: Date | null;
  participant_limit: number | null;
  link_created_at: Date;
};

// 트랜잭션 안의 UNIQUE 위반은 트랜잭션을 롤백시킨 뒤 409로 바꾼다
class NicknameTaken extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// MEMBER-API-03 참여자 등록. nickname은 validateNickname을 통과한 값, pin은 형식 검사를 통과한 값이다
// 약속(promiseId) 기준이고 draft를 삭제하지 않으므로 promises 행만 잠근다 (API_CONVENTIONS 4.1-3)
export async function registerParticipant(
  request: Request,
  promiseId: string,
  input: { nickname: string; pin: string },
  options: { sessionToken?: string } = {},
): Promise<ParticipantRegistrationResult> {
  if (!UUID.test(promiseId)) return { kind: "invalid_request" };

  // 잠금 전 확인: 존재 → 취소 → 이미 참여 중인 브라우저 (EXCEPTION-10-02, R-13)
  const [found, [{ now }]] = await Promise.all([
    prisma.promise.findUnique({ where: { id: promiseId }, select: { id: true, status: true } }),
    prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`,
  ]);
  if (!found) return { kind: "not_found" };
  if (found.status === "cancelled") return { kind: "cancelled" };
  if (await findActivePromiseSession(request, found.id, now)) return { kind: "already_participant" };

  // 해시 계산은 수백 ms 걸리므로 잠금을 잡기 전에 끝낸다
  const passwordHash = await hashPin(input.pin);
  const sessionToken = options.sessionToken ?? generateSessionToken();

  try {
    return await prisma.$transaction(async (tx): Promise<ParticipantRegistrationResult> => {
      const [promise] = await tx.$queryRaw<LockedPromise[]>`
        SELECT p.id, p.status, p.created_at, p.voting_deadline_at, p.confirmed_start_at,
               p.participant_limit, l.created_at AS link_created_at
        FROM promises AS p JOIN promise_links AS l ON l.id = p.promise_link_id
        WHERE p.id = ${found.id}::uuid
        FOR UPDATE OF p`;
      const [{ now: lockedNow }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;

      // 사전 확인과 잠금 사이에 만료 draft가 정리됐다
      if (!promise) return { kind: "not_found" };

      const rejection = resolveJoinAccess(
        {
          status: promise.status,
          createdAt: promise.created_at,
          votingDeadlineAt: promise.voting_deadline_at,
        },
        lockedNow,
      );
      if (rejection) return rejection;
      if (promise.participant_limit === null) throw new Error("정원이 없는 collecting 약속");

      // 닉네임을 정원보다 먼저 본다. 마지막 자리를 차지한 사람이 응답을 못 받고 재시도해도
      // PROMISE_FULL이 아니라 NICKNAME_TAKEN을 받아야 로그인 복구(MEMBER-API-04)로 넘어갈 수 있다 (R-13)
      // cancelled 행도 중복으로 본다 — 재참여 불가 (MEMBER-05-06, 11-01, 11-02)
      const taken = await tx.participant.findUnique({
        where: {
          promiseId_normalizedNickname: { promiseId: promise.id, normalizedNickname: input.nickname },
        },
        select: { id: true },
      });
      if (taken) return { kind: "nickname_taken" };

      const activeCount = await tx.participant.count({
        where: { promiseId: promise.id, status: "active" },
      });
      if (activeCount >= promise.participant_limit) return { kind: "full" };

      const participant = await tx.participant
        .create({
          data: {
            promiseId: promise.id,
            nickname: input.nickname,
            normalizedNickname: input.nickname,
            passwordHash,
            role: "member",
            status: "active",
          },
          select: { id: true },
        })
        .catch((error: unknown) => {
          // 잠금 밖 경로(다른 API)와의 경합에 대한 최종 방어. 이 API끼리는 약속 잠금으로 직렬화된다
          throw isUniqueViolation(error) ? new NicknameTaken() : error;
        });

      // 세션 만료 = 링크 만료와 같은 기준 시각 + 7일. collecting이므로 voting_deadline_at + 7일 (5.2)
      const sessionExpiresAt = new Date(
        linkExpiryBase({
          inviteToken: "",
          createdAt: promise.link_created_at,
          promise: {
            id: promise.id,
            status: promise.status,
            createdAt: promise.created_at,
            votingDeadlineAt: promise.voting_deadline_at,
            confirmedStartAt: promise.confirmed_start_at,
          },
        }).getTime() + LINK_EXPIRY_MS,
      );
      await tx.participantSession.create({
        data: {
          participantId: participant.id,
          sessionTokenHash: hashSessionToken(sessionToken),
          expiresAt: sessionExpiresAt,
        },
        select: { id: true },
      });

      return {
        kind: "created",
        promiseId: promise.id,
        participantId: participant.id,
        nickname: input.nickname,
        currentParticipantCount: activeCount + 1,
        participantLimit: promise.participant_limit,
        sessionToken,
        sessionMaxAgeSeconds: sessionMaxAgeSeconds(sessionExpiresAt, lockedNow),
      };
    });
  } catch (error) {
    if (error instanceof NicknameTaken) return { kind: "nickname_taken" };
    throw error;
  }
}
