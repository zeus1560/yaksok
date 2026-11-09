import { prisma } from "@/lib/prisma";
import { hashSessionToken } from "./session";
import { readCookie, sessionCookieName } from "./session-auth";

// MEMBER-API-07 로그아웃. 탈퇴가 아니므로 참여자·가능 시간·제출 상태는 건드리지 않고 세션 행만 삭제한다 (ERD 3.5)
// 공통 세션 인증(session-auth.ts)을 쓰지 않는다. 로그아웃은 브라우저 쿠키를 정리하는 동작이라
// 만료·탈퇴자 세션과 취소된 약속도 204로 끝내야 한다(R-11 예외, DECISION_CONFLICTS R-31)

export type LogoutResult =
  | { kind: "not_found" } // 약속 없음
  | { kind: "unauthenticated" } // 이 약속 이름의 쿠키가 아예 없음
  | { kind: "forbidden" } // 쿠키의 세션이 다른 약속 소속. 그 세션은 지우지 않는다
  | { kind: "ok"; promiseId: string }; // 204. promiseId는 DB 값(쿠키 이름·Path에 쓴다)

// allDevices 쿼리: 없으면 false, "true"·"false" 한 개만 받는다. 그 외(대소문자·"1"·빈 값·반복)는 null → 400
export function parseAllDevices(params: URLSearchParams): boolean | null {
  const values = params.getAll("allDevices");
  if (values.length === 0) return false;
  if (values.length > 1) return null;
  if (values[0] === "true") return true;
  if (values[0] === "false") return false;
  return null;
}

type SessionRow = {
  id: string;
  participant_id: string;
  expires_at: Date;
  promise_id: string;
  participant_status: string;
  now: Date;
};

// 잠금을 잡지 않는다(명세 「동시성: 잠금 불필요」). 다른 쓰기 API는 세션 행이 사라지면 잠금 후 재확인에서 401·쿠키 Max-Age=0으로 처리한다
export async function logoutSession(
  request: Request,
  promiseId: string,
  options: { allDevices: boolean },
): Promise<LogoutResult> {
  const promise = await prisma.promise.findUnique({
    where: { id: promiseId },
    select: { id: true },
  });
  if (!promise) return { kind: "not_found" };

  // 쿠키 이름은 DB의 약속 id(소문자 UUID)로 고른다. 발급할 때도 같은 값을 썼다
  const token = readCookie(request, sessionCookieName(promise.id));
  if (!token) return { kind: "unauthenticated" };

  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<SessionRow[]>`
      SELECT s.id, s.participant_id, s.expires_at, p.promise_id, p.status AS participant_status,
             clock_timestamp() AS now
      FROM participant_sessions AS s JOIN participants AS p ON p.id = s.participant_id
      WHERE s.session_token_hash = ${hashSessionToken(token)}`;

    // 행이 없다: 이미 로그아웃했거나 만료 draft와 함께 지워졌거나 위조 토큰. 멱등 204
    if (!row) return { kind: "ok", promiseId: promise.id };
    // 다른 약속의 세션은 이 경로로 지우지 않는다
    if (row.promise_id !== promise.id) return { kind: "forbidden" };

    // 전체 로그아웃은 아직 유효한 세션(만료 전·active 참여자)으로만 한다.
    // 만료된 쿠키나 탈퇴·내보내진 참여자의 쿠키는 자기 행만 지운다 — 옛 토큰으로 다른 기기를 끊지 못하게 한다
    const valid =
      row.expires_at.getTime() > row.now.getTime() && row.participant_status === "active";
    await tx.participantSession.deleteMany({
      where: options.allDevices && valid ? { participantId: row.participant_id } : { id: row.id },
    });
    return { kind: "ok", promiseId: promise.id };
  });
}
