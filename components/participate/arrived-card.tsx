import { Card } from "@/components/common/ui";
import type { MyParticipation } from "@/components/create-promise/api";

// 등록·로그인 뒤 도착 화면. /me(MEMBER-API-05) 응답만으로 그린다
// 약속 설정 값은 가능 시간 입력 화면(PR 3, TIME-API-02)에서 처음 받는다. role은 표시용이다

export function ArrivedCard({ me }: { me: MyParticipation }) {
  const isHost = me.role === "host";
  const open = me.permissions.canEditAvailability;

  return (
    <Card className="mx-auto max-w-lg">
      <p className="text-sm font-medium text-blue">참여 완료</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-[28px] font-bold leading-snug">{me.nickname}님</h1>
        {isHost && (
          <span className="rounded-full bg-blue-soft px-2.5 py-0.5 text-sm font-medium text-ink">
            방장
          </span>
        )}
      </div>
      <p className="mt-2 text-sub">
        {open
          ? "이 약속에 참여했어요. 가능한 시간 입력은 곧 이 화면에서 할 수 있어요."
          : "응답이 마감된 약속이에요. 결과 화면은 준비 중이에요."}
      </p>

      {/* PR 3(가능 시간 입력 그리드)에서 연결한다 */}
      <div className="mt-6 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-sub">
        {open ? "가능 시간 입력 화면 준비 중" : "결과 화면 준비 중"}
      </div>
    </Card>
  );
}
