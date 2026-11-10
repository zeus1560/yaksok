import { Card, PageShell } from "@/components/common/ui";
import { CreatePromiseButton } from "@/components/create-promise/create-promise-button";

export default function Home() {
  return (
    <PageShell>
      <Card center>
        <h1 className="text-[28px] font-bold leading-snug">우리 언제 만날까요?</h1>
        <p className="mt-2 text-sub">링크 하나로 모두가 가능한 시간을 함께 찾아요.</p>
        <div className="mt-8">
          <CreatePromiseButton />
        </div>
      </Card>
    </PageShell>
  );
}
