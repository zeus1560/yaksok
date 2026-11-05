import type { Metadata } from "next";
import { PageShell } from "@/components/common/ui";
import { InviteFlow } from "@/components/create-promise/invite-flow";

export const metadata: Metadata = {
  title: "약속 잡기",
  // 초대 토큰이 담긴 주소가 검색에 노출되지 않게 한다
  robots: { index: false, follow: false },
};

// 링크 상태는 브라우저 저장소(설정 진행 정보)와 폴링에 의존하므로 화면 분기는 클라이언트가 맡는다
export default async function InvitePage(props: PageProps<"/p/[inviteToken]">) {
  const { inviteToken } = await props.params;
  return (
    <PageShell>
      <InviteFlow inviteToken={inviteToken} />
    </PageShell>
  );
}
