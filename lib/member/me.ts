import { prisma } from "@/lib/prisma";
import { computeMePermissions, isDeadlinePassed, type MePermissions } from "./me-permissions";
import type { PromiseSession } from "./session-auth";

export type MyParticipation = {
  participantId: string;
  nickname: string;
  role: string;
  status: string;
  availabilitySubmittedAt: Date | null; // participants.availability_submitted_at (ERD 3.3)
  promiseStatus: string;
  deadlinePassed: boolean;
  permissions: MePermissions;
  sessionExpiresAt: Date;
};

// session: 응답 시점의 세션 expires_at(행이 없으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type MyParticipationResult =
  ({ kind: "unauthenticated" } & SessionState) | ({ kind: "ok" } & MyParticipation & SessionState);

type Row = {
  expires_at: Date;
  participant_id: string;
  participant_promise_id: string;
  nickname: string;
  role: string;
  participant_status: string;
  availability_submitted_at: Date | null;
  promise_status: string;
  voting_deadline_at: Date | null;
  now: Date;
};

// MEMBER-API-05 내 참여 정보 조회. auth는 authenticatePromiseSession(allowCancelled) 성공 결과
// 세션·참여자·약속을 SQL 한 문장으로 다시 읽어 한 시점 기준으로 판정한다. 잠그지 않고 DB를 바꾸지 않는다
// 마감이 지난 collecting도 상태는 그대로 두고 deadlinePassed만 계산한다 (TIME-15-04)
export async function getMyParticipation(auth: PromiseSession): Promise<MyParticipationResult> {
  const [row] = await prisma.$queryRaw<Row[]>`
    SELECT s.expires_at, p.id AS participant_id, p.promise_id AS participant_promise_id,
           p.nickname, p.role, p.status AS participant_status, p.availability_submitted_at,
           pr.status AS promise_status, pr.voting_deadline_at, clock_timestamp() AS now
    FROM participant_sessions s
    JOIN participants p ON p.id = s.participant_id
    JOIN promises pr ON pr.id = p.promise_id
    WHERE s.id = ${auth.session.id}::uuid`;

  // 인증 뒤 세션 행이 지워졌다(만료 draft 정리 등). 쿠키도 지운다
  if (!row) return { kind: "unauthenticated", session: { expiresAt: null, now: auth.now } };

  const session = { expiresAt: row.expires_at, now: row.now };
  // 인증 뒤 세션 만료·탈퇴·내보내기가 일어났다. 세션 API의 cancelled 참여자는 401 (C-07)
  if (
    row.expires_at.getTime() <= row.now.getTime() ||
    row.participant_status !== "active" ||
    row.participant_promise_id !== auth.promise.id ||
    row.participant_id !== auth.participant.id
  ) {
    return { kind: "unauthenticated", session };
  }

  const deadlinePassed = isDeadlinePassed(row.voting_deadline_at, row.now);
  return {
    kind: "ok",
    participantId: row.participant_id,
    nickname: row.nickname,
    role: row.role,
    status: row.participant_status,
    availabilitySubmittedAt: row.availability_submitted_at,
    promiseStatus: row.promise_status,
    deadlinePassed,
    permissions: computeMePermissions({
      role: row.role,
      status: row.participant_status,
      promiseStatus: row.promise_status,
      deadlinePassed,
    }),
    sessionExpiresAt: row.expires_at,
    session,
  };
}
