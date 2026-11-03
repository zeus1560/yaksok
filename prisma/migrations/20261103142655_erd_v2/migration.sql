/*
  Warnings:

  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "users";

-- CreateTable
CREATE TABLE "promise_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invite_token" VARCHAR NOT NULL,
    "source" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promise_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "promise_link_id" UUID NOT NULL,
    "participant_limit" INTEGER,
    "date_range_start" DATE,
    "date_range_end" DATE,
    "daily_start_minute" SMALLINT,
    "daily_end_minute" SMALLINT,
    "duration_minutes" INTEGER,
    "voting_deadline_at" TIMESTAMPTZ(3),
    "status" VARCHAR NOT NULL DEFAULT 'draft',
    "confirmed_start_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "promise_id" UUID NOT NULL,
    "nickname" VARCHAR NOT NULL,
    "normalized_nickname" VARCHAR NOT NULL,
    "password_hash" VARCHAR NOT NULL,
    "role" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "availability_submitted_at" TIMESTAMPTZ(3),
    "availability_version" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_available_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participant_id" UUID NOT NULL,
    "slot_start_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_available_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participant_id" UUID NOT NULL,
    "session_token_hash" VARCHAR NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promise_links_invite_token_key" ON "promise_links"("invite_token");

-- CreateIndex
CREATE UNIQUE INDEX "promises_promise_link_id_key" ON "promises"("promise_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_promise_id_normalized_nickname_key" ON "participants"("promise_id", "normalized_nickname");

-- CreateIndex
CREATE UNIQUE INDEX "participant_available_slots_participant_id_slot_start_at_key" ON "participant_available_slots"("participant_id", "slot_start_at");

-- CreateIndex
CREATE UNIQUE INDEX "participant_sessions_session_token_hash_key" ON "participant_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "participant_sessions_participant_id_idx" ON "participant_sessions"("participant_id");

-- AddForeignKey
ALTER TABLE "promises" ADD CONSTRAINT "promises_promise_link_id_fkey" FOREIGN KEY ("promise_link_id") REFERENCES "promise_links"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_promise_id_fkey" FOREIGN KEY ("promise_id") REFERENCES "promises"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "participant_available_slots" ADD CONSTRAINT "participant_available_slots_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ============================================================
-- 아래는 Prisma 스키마로 표현할 수 없어 직접 작성한 제약이다 (DATABASE.md 4.1·4.2).
-- 이후 마이그레이션에서 이 제약을 DROP하는 줄이 생기면 지우고 적용한다.
-- ============================================================

-- 방장은 약속당 최대 한 명 (부분 UNIQUE 인덱스)
CREATE UNIQUE INDEX uq_one_host_per_promise ON participants (promise_id) WHERE role = 'host';

-- promise_links
ALTER TABLE promise_links ADD CONSTRAINT ck_promise_link_source
  CHECK (source IN ('web', 'kakao'));

-- promises
ALTER TABLE promises ADD CONSTRAINT ck_promise_status
  CHECK (status IN ('draft', 'collecting', 'closed', 'confirmed', 'cancelled'));

ALTER TABLE promises ADD CONSTRAINT ck_promise_participant_limit
  CHECK (participant_limit IS NULL OR participant_limit BETWEEN 2 AND 30);

ALTER TABLE promises ADD CONSTRAINT ck_promise_date_range
  CHECK (date_range_start IS NULL OR date_range_end IS NULL OR date_range_start <= date_range_end);

ALTER TABLE promises ADD CONSTRAINT ck_promise_daily_start_minute
  CHECK (daily_start_minute IS NULL OR (daily_start_minute BETWEEN 0 AND 1410 AND daily_start_minute % 30 = 0));

ALTER TABLE promises ADD CONSTRAINT ck_promise_daily_end_minute
  CHECK (daily_end_minute IS NULL OR (daily_end_minute BETWEEN 30 AND 1440 AND daily_end_minute % 30 = 0));

ALTER TABLE promises ADD CONSTRAINT ck_promise_daily_range
  CHECK (daily_start_minute IS NULL OR daily_end_minute IS NULL OR daily_start_minute < daily_end_minute);

ALTER TABLE promises ADD CONSTRAINT ck_promise_duration_minutes
  CHECK (duration_minutes IS NULL OR (
    duration_minutes >= 30 AND duration_minutes % 30 = 0
    AND (daily_start_minute IS NULL OR daily_end_minute IS NULL
         OR duration_minutes <= daily_end_minute - daily_start_minute)));

ALTER TABLE promises ADD CONSTRAINT ck_promise_cancelled_at
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));

-- collecting·closed·confirmed는 모집 설정이 모두 있어야 한다
ALTER TABLE promises ADD CONSTRAINT ck_promise_required_settings
  CHECK (status NOT IN ('collecting', 'closed', 'confirmed') OR (
    participant_limit IS NOT NULL AND date_range_start IS NOT NULL AND date_range_end IS NOT NULL
    AND daily_start_minute IS NOT NULL AND daily_end_minute IS NOT NULL
    AND duration_minutes IS NOT NULL AND voting_deadline_at IS NOT NULL));

-- confirmed면 필수, draft·collecting·closed면 NULL, cancelled는 이전 값 유지 가능
ALTER TABLE promises ADD CONSTRAINT ck_promise_confirmed_start_at
  CHECK (status = 'cancelled' OR (status = 'confirmed') = (confirmed_start_at IS NOT NULL));

-- participants
ALTER TABLE participants ADD CONSTRAINT ck_participant_role
  CHECK (role IN ('host', 'member'));

ALTER TABLE participants ADD CONSTRAINT ck_participant_status
  CHECK (status IN ('active', 'cancelled'));

ALTER TABLE participants ADD CONSTRAINT ck_host_must_be_active
  CHECK (role <> 'host' OR status = 'active');

ALTER TABLE participants ADD CONSTRAINT ck_participant_cancelled_at
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));

-- participant_available_slots: 00분·30분, 초·소수 초 0 (KST는 UTC+9 고정이라 UTC 기준 판정과 같다)
ALTER TABLE participant_available_slots ADD CONSTRAINT ck_slot_start_at_boundary
  CHECK (extract(second FROM slot_start_at) = 0 AND extract(minute FROM slot_start_at) IN (0, 30));
