import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import {
  DRAFT_EXPIRY_MS,
  LINK_EXPIRY_MS,
  linkExpiryBase,
  type LinkWithPromise,
} from "./link-status";
import { hashPin, verifyPin } from "./pin";
import {
  DRAFT_SESSION_TTL_SECONDS,
  generateSessionToken,
  hashSessionToken,
  sessionMaxAgeSeconds,
} from "./session";

export type LoginAccess =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "expired" }
  | { kind: "draft_expired" }
  | { kind: "ok"; sessionExpiresAt: Date };

export type LoginResult =
  | Exclude<LoginAccess, { kind: "ok" }>
  | { kind: "invalid_request" }
  | { kind: "invalid_credentials" }
  | { kind: "participant_cancelled" }
  | {
      kind: "ok";
      promiseId: string;
      participantId: string;
      nickname: string;
      role: string;
      status: string;
      promiseStatus: string;
      sessionExpiresAt: Date;
      sessionToken: string;
      sessionMaxAgeSeconds: number;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 약속 상태로 로그인 가능 여부와 세션 만료를 정한다. PIN 검증보다 먼저 한다 (MEMBER-API-04)
// 로그인 가능 기간 = 링크 유효 기간. 기준 시각은 MEMBER-API-01과 같은 linkExpiryBase를 쓴다
export function resolveLoginAccess(link: LinkWithPromise, now: Date): LoginAccess {
  const promise = link.promise;
  if (!promise) return { kind: "not_found" };
  if (promise.status === "cancelled") return { kind: "cancelled" };

  if (promise.status === "draft") {
    // 10분 지난 draft는 410 DRAFT_EXPIRED(약속 기준 API 공통). 로그인은 잠그지 않으므로 삭제하지 않는다.
    // 삭제는 잠금을 잡는 MEMBER-API-02·STATE-API-02가 한다 (STATE-02-02)
    if (promise.createdAt.getTime() + DRAFT_EXPIRY_MS <= now.getTime())
      return { kind: "draft_expired" };
    return {
      kind: "ok",
      sessionExpiresAt: new Date(now.getTime() + DRAFT_SESSION_TTL_SECONDS * 1000),
    };
  }

  // 확정된 약속은 confirmed_start_at 기준이라 마감 + 7일이 지나도 로그인할 수 있다
  const sessionExpiresAt = new Date(linkExpiryBase(link).getTime() + LINK_EXPIRY_MS);
  if (sessionExpiresAt.getTime() <= now.getTime()) return { kind: "expired" };
  return { kind: "ok", sessionExpiresAt };
}

// 없는 닉네임도 같은 scrypt 매개변수로 한 번 계산해 응답 시간으로 닉네임 존재가 드러나지 않게 한다
let dummyHash: Promise<string> | undefined;
function dummyPinHash(): Promise<string> {
  dummyHash ??= hashPin("0000");
  return dummyHash;
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

// MEMBER-API-04 참여자 재인증. nickname은 validateNickname을 통과한 값, pin은 형식 검사를 통과한 값이다
// 약속을 잠그지 않는다 (읽기 + 세션 생성). 판정 시각은 DB clock_timestamp() (API_CONVENTIONS 4.2)
export async function loginParticipant(
  promiseId: string,
  input: { nickname: string; pin: string },
  options: { sessionToken?: string } = {},
): Promise<LoginResult> {
  // 약속 기준 API는 형식 오류를 400으로 구분한다 (STATE 명세와 통일, R-12)
  if (!UUID.test(promiseId)) return { kind: "invalid_request" };

  const [promise, [{ now }]] = await Promise.all([
    prisma.promise.findUnique({
      where: { id: promiseId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        votingDeadlineAt: true,
        confirmedStartAt: true,
        promiseLink: { select: { inviteToken: true, createdAt: true } },
      },
    }),
    prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`,
  ]);
  if (!promise) return { kind: "not_found" };

  const { promiseLink, ...linkPromise } = promise;
  const access = resolveLoginAccess({ ...promiseLink, promise: linkPromise }, now);
  if (access.kind !== "ok") return access;

  const participant = await prisma.participant.findUnique({
    where: { promiseId_normalizedNickname: { promiseId, normalizedNickname: input.nickname } },
    select: { id: true, nickname: true, role: true, status: true, passwordHash: true },
  });
  const pinMatches = await verifyPin(
    input.pin,
    participant?.passwordHash ?? (await dummyPinHash()),
  );
  // 인증 실패는 이 한 곳에서만 반환한다. 시도 제한(MEMBER-06-04)을 넣을 때 이 지점에 붙인다
  if (!participant || !pinMatches) return { kind: "invalid_credentials" };

  if (participant.status === "cancelled") return { kind: "participant_cancelled" };

  // 기존 기기의 세션은 그대로 두고 새 행을 만든다 (MEMBER-04-02)
  const sessionToken = options.sessionToken ?? generateSessionToken();
  try {
    await prisma.participantSession.create({
      data: {
        participantId: participant.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt: access.sessionExpiresAt,
      },
      select: { id: true },
    });
  } catch (error) {
    // 판정 직후 만료 draft가 삭제되면 참여자 FK가 사라진다
    if (isForeignKeyViolation(error)) return { kind: "not_found" };
    throw error;
  }

  return {
    kind: "ok",
    promiseId: promise.id,
    participantId: participant.id,
    nickname: participant.nickname,
    role: participant.role,
    status: participant.status,
    promiseStatus: promise.status,
    sessionExpiresAt: access.sessionExpiresAt,
    sessionToken,
    sessionMaxAgeSeconds: sessionMaxAgeSeconds(access.sessionExpiresAt, now),
  };
}
