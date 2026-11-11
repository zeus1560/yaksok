// 통합 테스트 DB 도우미 — e2e DB(.env.e2e)에 직접 붙어 준비(시각 조작·잠금)와 확인(행 조회)을 한다
// 화면·API로 만들 수 없는 상황(마감 지남, 7일 지난 링크, 잠금 대기 중 세션 변화)만 여기서 만든다
import { createHash } from "node:crypto";
import pg from "pg";
import { loadE2eEnv } from "./e2e-env";

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    // 유휴 연결은 빨리 닫는다(Neon 절전·PC 절전 뒤 끊긴 연결을 다시 쓰지 않게). 유휴 연결 오류로 작업자가 죽지 않게 받는다
    pool = new pg.Pool({
      connectionString: loadE2eEnv().DIRECT_URL,
      max: 4,
      idleTimeoutMillis: 5_000,
    });
    pool.on("error", () => {});
  }
  return pool;
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const { rows } = await db().query(sql, params);
  return rows[0] as T | undefined;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// ── 스냅샷: public 스키마의 모든 테이블 행 수·md5 (실행 전후 비교)
export async function snapshot(
  client: pg.Pool | pg.Client = db(),
): Promise<Record<string, string>> {
  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const out: Record<string, string> = {};
  for (const { table_name: t } of tables as { table_name: string }[]) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${t}" x`,
    );
    out[t] = `${rows[0].n}/${rows[0].h}`;
  }
  return out;
}

// ── 정리: 초대 토큰으로 링크와 그 하위 행(약속·참여자·슬롯·세션)을 지운다. 이미 없으면 아무것도 하지 않는다
export async function deleteLinks(
  inviteTokens: string[],
  client: pg.Pool | pg.Client = db(),
): Promise<number> {
  if (inviteTokens.length === 0) return 0;
  const { rows: links } = await client.query(
    `SELECT id FROM promise_links WHERE invite_token = ANY($1)`,
    [inviteTokens],
  );
  const linkIds = links.map((r) => r.id);
  if (linkIds.length === 0) return 0;
  const { rows: proms } = await client.query(
    `SELECT id FROM promises WHERE promise_link_id = ANY($1::uuid[])`,
    [linkIds],
  );
  const ids = proms.map((r) => r.id);
  const inPromises = `SELECT id FROM participants WHERE promise_id = ANY($1::uuid[])`;
  await client.query(
    `DELETE FROM participant_available_slots WHERE participant_id IN (${inPromises})`,
    [ids],
  );
  await client.query(`DELETE FROM participant_sessions WHERE participant_id IN (${inPromises})`, [
    ids,
  ]);
  await client.query(`DELETE FROM participants WHERE promise_id = ANY($1::uuid[])`, [ids]);
  await client.query(`DELETE FROM promises WHERE id = ANY($1::uuid[])`, [ids]);
  await client.query(`DELETE FROM promise_links WHERE id = ANY($1::uuid[])`, [linkIds]);
  return linkIds.length;
}

// ── 시각 조작 (DB 시각 clock_timestamp() 기준)
// 응답 마감을 방금 지난 시각으로
export const passDeadline = (promiseId: string) =>
  db().query(
    `UPDATE promises SET voting_deadline_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
    [promiseId],
  );
// 링크 발급 시각을 7일 + 1분 전으로(약속 없는 링크의 만료 기준, MEMBER-01-02)
export const ageLinkPastExpiry = (inviteToken: string) =>
  db().query(
    `UPDATE promise_links SET created_at = clock_timestamp() - interval '7 days 1 minute' WHERE invite_token = $1`,
    [inviteToken],
  );
// 모집 중 약속의 마감을 7일 + 1분 전으로(약속 있는 링크의 만료 기준 = 마감 + 7일)
export const agePromisePastLinkExpiry = (promiseId: string) =>
  db().query(
    `UPDATE promises SET voting_deadline_at = clock_timestamp() - interval '7 days 1 minute' WHERE id = $1`,
    [promiseId],
  );
// draft 생성 시각을 11분 전으로(설정 시간 10분 경과, STATE-02-02)
export const ageDraft = (promiseId: string) =>
  db().query(`UPDATE promises SET created_at = created_at - interval '11 minutes' WHERE id = $1`, [
    promiseId,
  ]);
// 세션 만료: 지금(또는 1분 전)으로
export const expireSession = (token: string, ago = "0 seconds") =>
  db().query(
    `UPDATE participant_sessions SET expires_at = clock_timestamp() - $2::interval WHERE session_token_hash = $1`,
    [hashToken(token), ago],
  );

// ── 조회
export type PromiseRow = {
  status: string;
  participant_limit: number | null;
  s: string | null;
  e: string | null;
  voting_deadline_at: Date | null;
  confirmed_start_at: Date | null;
  cancelled_at: Date | null;
};
export const promiseRow = (id: string) =>
  one<PromiseRow>(
    `SELECT status, participant_limit, date_range_start::text AS s, date_range_end::text AS e,
            voting_deadline_at, confirmed_start_at, cancelled_at FROM promises WHERE id = $1`,
    [id],
  );
export const promiseStatus = async (id: string) => (await promiseRow(id))?.status ?? null;
const md5Of = async (sql: string, params: unknown[]) =>
  (await one<{ h: string }>(
    `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM (${sql}) x`,
    params,
  ))!.h;
export const promiseMd5 = (id: string) => md5Of(`SELECT * FROM promises WHERE id = $1`, [id]);
export const participantsMd5 = (promiseId: string) =>
  md5Of(`SELECT * FROM participants WHERE promise_id = $1`, [promiseId]);
export const slotsMd5 = (promiseId: string) =>
  md5Of(
    `SELECT s.* FROM participant_available_slots s JOIN participants p ON p.id = s.participant_id WHERE p.promise_id = $1`,
    [promiseId],
  );
export const sessionsMd5 = (promiseId: string, exceptParticipantId?: string) =>
  md5Of(
    `SELECT s.* FROM participant_sessions s JOIN participants p ON p.id = s.participant_id
     WHERE p.promise_id = $1 AND p.id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [promiseId, exceptParticipantId ?? null],
  );
export const participantRow = (id: string) =>
  one<{ role: string; status: string }>(`SELECT role, status FROM participants WHERE id = $1`, [
    id,
  ]);
export const participantByNick = (promiseId: string, nickname: string) =>
  one<{ id: string; role: string; status: string }>(
    `SELECT id, role, status FROM participants WHERE promise_id = $1 AND nickname = $2`,
    [promiseId, nickname],
  );
export const sessionExists = async (token: string) =>
  (await one(`SELECT 1 FROM participant_sessions WHERE session_token_hash = $1`, [
    hashToken(token),
  ])) !== undefined;
export const sessionRow = (token: string) =>
  one<{ expires_at: Date }>(
    `SELECT expires_at FROM participant_sessions WHERE session_token_hash = $1`,
    [hashToken(token)],
  );
export const sessionCount = async (participantId: string, liveOnly = false) =>
  (await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM participant_sessions WHERE participant_id = $1
     ${liveOnly ? "AND expires_at > clock_timestamp()" : ""}`,
    [participantId],
  ))!.n;
export const slotCount = async (promiseId: string) =>
  (await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM participant_available_slots s JOIN participants p ON p.id = s.participant_id WHERE p.promise_id = $1`,
    [promiseId],
  ))!.n;
export const participantSlotCount = async (participantId: string) =>
  (await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM participant_available_slots WHERE participant_id = $1`,
    [participantId],
  ))!.n;
export const promisesOfLink = async (inviteToken: string) =>
  (await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM promises p JOIN promise_links l ON l.id = p.promise_link_id WHERE l.invite_token = $1`,
    [inviteToken],
  ))!.n;

// ── 잠금: 다른 연결에서 행을 잠근 채로 요청을 보내고, 요청이 바로 그 잠금을 기다리기 시작하면
// between()을 실행한 뒤 잠금을 푼다. 기다림 판정은 잠금을 쥔 연결 pid로 막힌 연결이 있는가(pg_blocking_pids)
export type LockTarget = "link" | "promise";
const LOCK_SQL: Record<LockTarget, string> = {
  link: `SELECT l.id FROM promise_links l JOIN promises p ON p.promise_link_id = l.id WHERE p.id = $1 FOR UPDATE OF l`,
  promise: `SELECT id FROM promises WHERE id = $1 FOR UPDATE`,
};

export async function withRowLocked<T>(
  target: LockTarget,
  promiseId: string,
  send: () => Promise<T>,
  between: () => Promise<void>,
): Promise<{ result: T; waited: boolean }> {
  const locker = new pg.Client({ connectionString: loadE2eEnv().DIRECT_URL });
  await locker.connect();
  try {
    await locker.query("BEGIN");
    const { rows } = await locker.query(`SELECT pg_backend_pid() AS pid`);
    const lockerPid: number = rows[0].pid;
    await locker.query(LOCK_SQL[target], [promiseId]);
    const pending = send();
    let waited = false;
    for (let i = 0; i < 150 && !waited; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const blocked = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
        [lockerPid],
      );
      waited = (blocked?.n ?? 0) > 0;
    }
    if (waited) await between();
    await locker.query("COMMIT");
    return { result: await pending, waited };
  } catch (error) {
    await locker.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await locker.end();
  }
}
