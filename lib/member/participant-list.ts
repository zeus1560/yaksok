import { prisma } from "@/lib/prisma";
import type { PromiseSession } from "@/lib/member/session-auth";

// session: 응답 시점의 요청자 세션 expires_at(행이 없으면 null)과 판정 시각. 쿠키 Max-Age 계산용
type SessionState = { session: { expiresAt: Date | null; now: Date } };

export type ParticipantListItem = {
  participantId: string;
  nickname: string;
  role: string;
  isMe: boolean;
};

export type ParticipantListResult =
  | ({ kind: "not_found" } & SessionState)
  | ({ kind: "cancelled" } & SessionState)
  | ({ kind: "unauthenticated" } & SessionState)
  | ({ kind: "forbidden" } & SessionState)
  | ({
      kind: "ok";
      participantLimit: number;
      participants: ParticipantListItem[]; // active만, 등록순. 길이 = currentParticipantCount
    } & SessionState);

type PromiseRow = { status: string; participant_limit: number | null };

// 명단을 보여 주는 상태. 마감 지난 collecting은 다른 GET에서 closed로 계산하지만
// 두 상태 모두 허용이고 응답에 상태가 없어 결과가 같으므로 따로 계산하지 않는다 (DB도 바꾸지 않는다)
const LIST_STATUSES: readonly string[] = ["collecting", "closed", "confirmed"];

// MEMBER-API-06 참여자 명단 조회. auth는 authenticatePromiseSession 성공 결과
// 약속·세션·참여자를 한 시점 기준으로 읽도록 REPEATABLE READ 읽기 트랜잭션 하나에서 조회하고 잠그지 않는다
// 판정 시각은 이 트랜잭션의 now() 하나다 (STATE-API-01·TIME-API-02와 같은 방식, R-14·R-21)
export async function getParticipantList(auth: PromiseSession): Promise<ParticipantListResult> {
  return prisma.$transaction(
    async (tx): Promise<ParticipantListResult> => {
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
      const [promise] = await tx.$queryRaw<PromiseRow[]>`
        SELECT status, participant_limit FROM promises WHERE id = ${auth.promise.id}::uuid`;
      const keep = { session: { expiresAt: auth.session.expiresAt, now } };

      // 인증 뒤 다른 요청이 draft를 삭제했다(만료 정리·방장 나가기). 요청자 세션도 함께 지워졌다
      if (!promise) return { kind: "not_found", session: { expiresAt: null, now } };
      if (promise.status === "cancelled") return { kind: "cancelled", ...keep };
      if (promise.status !== "draft" && !LIST_STATUSES.includes(promise.status)) {
        throw new Error(`알 수 없는 약속 상태: ${promise.status}`);
      }

      // 세션·참여자를 같은 스냅샷에서 다시 확인한다. 탈퇴·내보내기는 세션을 즉시 만료시킨다 (ERD 11절, C-07)
      const session = await tx.participantSession.findUnique({
        where: { id: auth.session.id },
        select: {
          expiresAt: true,
          participant: { select: { id: true, promiseId: true, status: true } },
        },
      });
      if (!session) return { kind: "unauthenticated", session: { expiresAt: null, now } };
      const current = { session: { expiresAt: session.expiresAt, now } };
      if (
        session.expiresAt.getTime() <= now.getTime() ||
        session.participant.status !== "active" ||
        session.participant.promiseId !== auth.promise.id ||
        session.participant.id !== auth.participant.id
      ) {
        return { kind: "unauthenticated", ...current };
      }

      // draft는 방장을 포함해 명단·정원을 보여 주지 않는다 (명세 허용 상태, MEMBER-03-01, R-29)
      if (promise.status === "draft") return { kind: "forbidden", ...current };

      if (promise.participant_limit === null) {
        throw new Error("정원 값이 없는 모집 이후 약속");
      }

      // active만, 등록순. role은 이 스냅샷의 최신 값이라 승계가 반영된다. 제출 여부·PIN·정규화 닉네임은 읽지 않는다
      const people = await tx.participant.findMany({
        where: { promiseId: auth.promise.id, status: "active" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, nickname: true, role: true },
      });

      return {
        kind: "ok",
        participantLimit: promise.participant_limit,
        participants: people.map((person) => ({
          participantId: person.id,
          nickname: person.nickname,
          role: person.role,
          isMe: person.id === auth.participant.id,
        })),
        ...current,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
