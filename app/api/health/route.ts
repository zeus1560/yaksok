import { noStore } from "@/lib/no-store";
import { prisma } from "@/lib/prisma";

// 서버·DB 연결 확인. 다른 API처럼 Cache-Control: no-store (031 메모, 032)
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return noStore(Response.json({ ok: true }));
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    console.error("health 확인 실패", error instanceof Error ? error.name : "unknown");
    return noStore(Response.json({ ok: false }, { status: 503 }));
  }
}
