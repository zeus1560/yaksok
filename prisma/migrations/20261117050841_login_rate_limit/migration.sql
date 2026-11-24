-- 035 PIN 시도 제한과 레이트 리밋 (DECISION_CONFLICTS R-41)
-- 추가형 변경만: 새 테이블 2개와 인덱스. 기존 테이블·컬럼은 바꾸거나 지우지 않는다
-- (미리보기 DB를 함께 쓰는 예전 배포 코드가 그대로 동작해야 한다). FK 없음 — 이유는 schema.prisma 주석

-- CreateTable
CREATE TABLE "login_failures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "promise_id" UUID NOT NULL,
    "normalized_nickname" VARCHAR NOT NULL,
    "ip_key" VARCHAR NOT NULL,
    "failed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bucket" VARCHAR NOT NULL,
    "ip_key" VARCHAR NOT NULL,
    "hit_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_failures_promise_id_normalized_nickname_failed_at_idx" ON "login_failures"("promise_id", "normalized_nickname", "failed_at");

-- CreateIndex
CREATE INDEX "login_failures_failed_at_idx" ON "login_failures"("failed_at");

-- CreateIndex
CREATE INDEX "rate_limit_hits_bucket_ip_key_hit_at_idx" ON "rate_limit_hits"("bucket", "ip_key", "hit_at");

-- CreateIndex
CREATE INDEX "rate_limit_hits_hit_at_idx" ON "rate_limit_hits"("hit_at");
