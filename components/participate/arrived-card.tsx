import type { MyParticipation } from "@/components/create-promise/api";
import { PromiseRoom } from "@/components/result/promise-room";

// 등록·로그인 뒤 도착 화면. 상태 조회(STATE-API-01) 폴링으로 시간 입력(012)·후보·결과(018) 화면을 고른다
// /me(MEMBER-API-05)의 role·permissions는 버튼 표시용이며 권한 판정은 서버가 한다
// 화면이 맞지 않게 되면(draft·취소·세션 만료 등) onRelink로 링크를 다시 조회한다(011 흐름)

export function ArrivedCard({
  promiseId,
  inviteToken,
  me,
  onRelink,
}: {
  promiseId: string;
  inviteToken: string;
  me: MyParticipation;
  onRelink: () => void;
}) {
  return <PromiseRoom promiseId={promiseId} inviteToken={inviteToken} me={me} onRelink={onRelink} />;
}
