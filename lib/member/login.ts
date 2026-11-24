import { UNKNOWN_IP_KEY } from "@/lib/limit/client-ip";
import { LOGIN_FAILURE_LOOKBACK_MS, resolveLoginLock } from "@/lib/limit/login-lock";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { accessExpiresAt, DRAFT_EXPIRY_MS, type LinkWithPromise } from "./link-status";
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
  | { kind: "too_many_attempts"; retryAfterSeconds: number }
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
// 로그인 가능 기간 = 링크 유효 기간. MEMBER-API-01과 같은 accessExpiresAt을 쓴다
export function resolveLoginAccess(link: LinkWithPromise, now: Date): LoginAccess {
  const promise = link.promise;
  if (!promise) return { kind: "not_found" };
  if (promise.status === "cancelled") return { kind: "cancelled" };

  if (promise.status === "draft") {
    // 10분 지난 draft는 410 DRAFT_EXPIRED(약속 기준 API 공통). 로그인은 잠그지 않으므로 삭제하지 않는다.
    // 삭제는 잠금을 잡는 MEMBER-API-02·STATE-API-02가 한다 (STATE-02-02)
    if (promise.createdAt.getTime() + DRAFT_EXPIRY_MS <= now.getTime())
      return { kind: "draft_expired" };
    // draft 세션만 기준이 다르다(발급 + 24시간, session.ts 참고)
    return {
      kind: "ok",
      sessionExpiresAt: new Date(now.getTime() + DRAFT_SESSION_TTL_SECONDS * 1000),
    };
  }

  // 확정된 약속은 confirmed_start_at 기준이라 마감 + 7일이 지나도 로그인할 수 있다
  const sessionExpiresAt = accessExpiresAt(link);
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

// 오래된 실패 기록은 실패를 남길 때 조금씩 지운다(판정에는 48시간 안의 기록만 쓴다 — 하루 상한의 24시간 창 + 24시간 잠금,
// 49시간 넘은 행을 한 번에 최대 100개)
const FAILURE_RETENTION_MS = LOGIN_FAILURE_LOOKBACK_MS + 60 * 60 * 1000;
const CLEANUP_BATCH = 100;

type PinCheck =
  | { kind: "invalid_credentials" }
  | { kind: "too_many_attempts"; retryAfterSeconds: number }
  | {
      kind: "verified";
      participant: { id: string; nickname: string; role: string; status: string };
    };

// PIN 시도 제한(MEMBER-06-04 잠정, R-41)과 PIN 비교. 같은 (약속, 닉네임)의 시도는 advisory lock으로 줄 세워
// 동시에 여러 번 보내 잠금 판정을 건너뛰지 못하게 한다. 잠금 판단 → PIN 비교 → 실패 기록·성공 초기화가 한 트랜잭션이다
async function checkPin(
  promiseId: string,
  input: { nickname: string; pin: string },
  ipKey: string,
): Promise<PinCheck> {
  const normalizedNickname = input.nickname;
  return prisma.$transaction(async (tx) => {
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`
      SELECT clock_timestamp() AS now
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`login:${promiseId}:${normalizedNickname}`}, 0))) AS l`;

    const failures = await tx.loginFailure.findMany({
      where: {
        promiseId,
        normalizedNickname,
        failedAt: { gt: new Date(now.getTime() - LOGIN_FAILURE_LOOKBACK_MS) },
      },
      select: { ipKey: true, failedAt: true },
    });
    const lock = resolveLoginLock(failures, ipKey, now);
    // 잠긴 동안에는 PIN이 맞아도 비교하지 않는다. 이 요청은 실패로 세지 않는다
    if (lock.locked)
      return { kind: "too_many_attempts", retryAfterSeconds: lock.retryAfterSeconds };

    const participant = await tx.participant.findUnique({
      where: { promiseId_normalizedNickname: { promiseId, normalizedNickname } },
      select: { id: true, nickname: true, role: true, status: true, passwordHash: true },
    });
    const pinMatches = await verifyPin(
      input.pin,
      participant?.passwordHash ?? (await dummyPinHash()),
    );
    // 인증 실패는 이 한 곳에서만 반환한다. 없는 닉네임도 같은 기록을 남겨 잠금이 똑같이 걸린다
    if (!participant || !pinMatches) {
      await tx.loginFailure.create({
        data: { promiseId, normalizedNickname, ipKey, failedAt: now },
        select: { id: true },
      });
      await tx.$executeRaw`
        DELETE FROM login_failures WHERE id IN (
          SELECT id FROM login_failures WHERE failed_at < ${new Date(now.getTime() - FAILURE_RETENTION_MS)}
          LIMIT ${CLEANUP_BATCH})`;
      return { kind: "invalid_credentials" };
    }

    // 성공: 이 IP의 연속 실패를 초기화한다. 다른 IP의 실패(참여자 전체 기준)는 남긴다
    await tx.loginFailure.deleteMany({ where: { promiseId, normalizedNickname, ipKey } });
    const { id, nickname, role, status } = participant;
    return { kind: "verified", participant: { id, nickname, role, status } };
  });
}

// MEMBER-API-04 참여자 재인증. nickname은 validateNickname을 통과한 값, pin은 형식 검사를 통과한 값이다
// 약속을 잠그지 않는다 (읽기 + 세션 생성). 판정 시각은 DB clock_timestamp() (API_CONVENTIONS 4.2)
// ipKey는 lib/limit/client-ip.ts로 구한 값이다. 순서: 약속 상태 → PIN 시도 제한 429 → PIN 비교 → 참여자 상태 → 세션
export async function loginParticipant(
  promiseId: string,
  input: { nickname: string; pin: string },
  options: { sessionToken?: string; ipKey?: string } = {},
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

  // 잠금 키는 DB의 id(소문자)로 만든다 — 주소의 대문자 UUID로 다른 잠금 줄을 만들지 못하게
  const attempt = await checkPin(promise.id, input, options.ipKey ?? UNKNOWN_IP_KEY);
  if (attempt.kind !== "verified") return attempt;
  const { participant } = attempt;

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
