import { rateLimited } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";
import { clientIpKey } from "./client-ip";
import {
  RATE_LIMITS,
  resolveRateLimit,
  type RateLimitBucket,
  type RateLimitDecision,
} from "./rate-limit";

// 레이트 리밋 기록은 DB(rate_limit_hits)에 둔다. 서버리스라 인스턴스 메모리는 요청마다 다를 수 있다
// 같은 (종류, IP)의 판정은 advisory lock으로 줄 세워 동시에 보낸 요청이 함께 통과하지 못하게 한다
// 오래된 행(10분 넘음)은 요청마다 최대 100개씩 지운다. 판정은 1분 창만 보므로 지우지 못한 행도 결과에 영향이 없다
const RETENTION_MS = 10 * 60 * 1000;
const CLEANUP_BATCH = 100;

export async function consumeRateLimit(
  bucket: RateLimitBucket,
  ipKey: string,
): Promise<RateLimitDecision> {
  const rule = RATE_LIMITS[bucket];
  return prisma.$transaction(async (tx) => {
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`
      SELECT clock_timestamp() AS now
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`rate:${bucket}:${ipKey}`}, 0))) AS l`;
    const hits = await tx.rateLimitHit.findMany({
      where: { bucket, ipKey, hitAt: { gt: new Date(now.getTime() - rule.windowMs) } },
      select: { hitAt: true },
    });
    const decision = resolveRateLimit(
      hits.map((h) => h.hitAt),
      now,
      rule,
    );
    if (decision.allowed) {
      await tx.rateLimitHit.create({ data: { bucket, ipKey, hitAt: now }, select: { id: true } });
    }
    await tx.$executeRaw`
      DELETE FROM rate_limit_hits WHERE id IN (
        SELECT id FROM rate_limit_hits WHERE hit_at < ${new Date(now.getTime() - RETENTION_MS)}
        LIMIT ${CLEANUP_BATCH})`;
    return decision;
  });
}

// Route Handler용: 넘었으면 429 RATE_LIMITED 응답, 아니면 null. DB 오류는 호출한 쪽의 500 처리로 던진다
export async function rateLimitResponse(
  request: Request,
  bucket: RateLimitBucket,
): Promise<Response | null> {
  const decision = await consumeRateLimit(bucket, clientIpKey(request.headers));
  return decision.allowed ? null : rateLimited(decision.retryAfterSeconds);
}
