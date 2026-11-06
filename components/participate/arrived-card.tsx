import { AvailabilityBoard } from "@/components/availability/availability-board";
import type { MyParticipation } from "@/components/create-promise/api";

// 등록·로그인 뒤 도착 화면 = 가능 시간 입력 화면 (012). /me(MEMBER-API-05)로 닉네임·방장을 표시하고
// 약속 설정 값과 가능 시간은 TIME-API-02에서 받는다. role은 표시용이며 권한 판정은 서버가 한다
// 화면이 맞지 않게 되면(draft·취소·세션 만료 등) onRelink로 링크를 다시 조회한다(011 흐름)

export function ArrivedCard({
  promiseId,
  me,
  onRelink,
}: {
  promiseId: string;
  me: MyParticipation;
  onRelink: () => void;
}) {
  return <AvailabilityBoard promiseId={promiseId} me={me} onRelink={onRelink} />;
}
