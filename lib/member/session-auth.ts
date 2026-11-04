import { prisma } from "@/lib/prisma";
import { hashSessionToken, sessionCookie, sessionMaxAgeSeconds } from "./session";

// 약속별 세션 인증 공통 모듈 (STATE-API-00 「요청 시 상태·마감 판정」 1~3, API_CONVENTIONS 5절)
// 순서: promiseId 형식 → 약속 존재 → cancelled(세션보다 우선) → 쿠키 해시 조회 → 만료·active → 약속 소속
// 잠금 없이 읽는다. 쓰기 API는 이 결과로 대상을 고른 뒤 잠금 후 상태·권한을 다시 확인한다

export type PromiseSession = {
  promise: { id: string; status: string; promiseLinkId: string };
  participant: { id: string; role: string };
  session: { id: string; token: string; expiresAt: Date };
  now: Date; // 인증 판정에 쓴 DB clock_timestamp()
};

export type SessionAuthResult =
  | { kind: "invalid_request" }
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | ({ kind: "ok" } & PromiseSession);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionCookieName(promiseId: string): string {
  return `ys_session_${promiseId}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}

export async function authenticatePromiseSession(
  request: Request,
  promiseId: string,
): Promise<SessionAuthResult> {
  if (!UUID.test(promiseId)) return { kind: "invalid_request" };

  const [promise, [{ now }]] = await Promise.all([
    prisma.promise.findUnique({
      where: { id: promiseId },
      select: { id: true, status: true, promiseLinkId: true },
    }),
    prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`,
  ]);
  if (!promise) return { kind: "not_found" };
  // 취소된 약속은 세션이 없거나 만료돼도 취소 사실만 알린다 (STATE-API-00)
  if (promise.status === "cancelled") return { kind: "cancelled" };

  const found = await lookupCookieSession(request, promise.id, now);
  if (found.kind === "none") return { kind: "unauthenticated" };
  if (found.kind === "other_promise") return { kind: "forbidden" };

  return { kind: "ok", promise, participant: found.participant, session: found.session, now };
}

type CookieSession =
  | { kind: "none" } // 쿠키 없음·위조·만료·cancelled 참여자
  | { kind: "other_promise" }
  | {
      kind: "ok";
      participant: { id: string; role: string };
      session: { id: string; token: string; expiresAt: Date };
    };

// promiseId는 DB에서 읽은 약속 id. now는 DB clock_timestamp()
async function lookupCookieSession(
  request: Request,
  promiseId: string,
  now: Date,
): Promise<CookieSession> {
  // 쿠키 이름은 DB의 약속 id(소문자 UUID)로 고른다. 발급할 때도 같은 값을 썼다
  const token = readCookie(request, sessionCookieName(promiseId));
  if (!token) return { kind: "none" };

  const session = await prisma.participantSession.findUnique({
    where: { sessionTokenHash: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      participant: { select: { id: true, promiseId: true, role: true, status: true } },
    },
  });
  if (!session || session.expiresAt.getTime() <= now.getTime()) return { kind: "none" };
  // cancelled 참여자는 세션 API에서 401로 응답한다 (DECISION_CONFLICTS C-07 안)
  if (session.participant.status !== "active") return { kind: "none" };
  if (session.participant.promiseId !== promiseId) return { kind: "other_promise" };

  return {
    kind: "ok",
    participant: { id: session.participant.id, role: session.participant.role },
    session: { id: session.id, token, expiresAt: session.expiresAt },
  };
}

// 선택적 확인 모드: 인증을 요구하지 않는 API(MEMBER-API-03)가 "이미 이 약속의 active 참여자인 브라우저"인지만 본다.
// 쿠키가 없거나 무효·만료·cancelled 참여자·다른 약속 세션이면 null — 401을 내지 않고 호출자가 그대로 진행한다
// 약속 존재·취소 판정은 호출자가 먼저 한다. promiseId는 DB에서 읽은 약속 id, now는 DB clock_timestamp()
export async function findActivePromiseSession(
  request: Request,
  promiseId: string,
  now: Date,
): Promise<{ participantId: string } | null> {
  const found = await lookupCookieSession(request, promiseId, now);
  return found.kind === "ok" ? { participantId: found.participant.id } : null;
}

// 세션 인증에 성공한 응답은 모두 쿠키를 다시 보낸다. Max-Age는 응답 시점의 DB expires_at까지 남은 초다
// 서버가 세션을 연장해도 브라우저 쿠키가 먼저 사라지는 문제를 막는다 (API_CONVENTIONS 5.2)
// expiresAt이 null이면 세션 행이 지워진 것이므로 쿠키도 즉시 지운다
export function withSessionCookie(
  response: Response,
  auth: PromiseSession,
  current: { expiresAt: Date | null; now: Date } = {
    expiresAt: auth.session.expiresAt,
    now: auth.now,
  },
): Response {
  const maxAge = current.expiresAt ? sessionMaxAgeSeconds(current.expiresAt, current.now) : 0;
  response.headers.set(
    "Set-Cookie",
    sessionCookie(auth.promise.id, maxAge > 0 ? auth.session.token : "", maxAge),
  );
  return response;
}
