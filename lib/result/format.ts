// 후보·확정 일정 표기와 후보 목록 처리 (018). 브라우저에서도 import하는 순수 함수다
// 시각은 epoch ms에 +9시간을 더해 UTC 메서드로 읽는다. 기기 시간대와 무관하다(TIME-01-01)

const MINUTE_MS = 60_000;
const SEOUL_OFFSET_MS = 9 * 60 * MINUTE_MS;
const SLOT_MS = 30 * MINUTE_MS;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function seoulParts(ms: number) {
  const d = new Date(ms + SEOUL_OFFSET_MS);
  return {
    ymd: d.toISOString().slice(0, 10),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: WEEKDAYS[d.getUTCDay()],
    hm: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function nextYmd(ymd: string): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + 24 * 60 * MINUTE_MS).toISOString().slice(0, 10);
}

// { date: "11월 10일 (화)", time: "14:00 – 16:00" }. 다음 날 00:00에 끝나면 "24:00"(TIME-05-02)
export function formatSeoulRange(startAt: string, endAt: string): { date: string; time: string } {
  const start = seoulParts(Date.parse(startAt));
  const end = seoulParts(Date.parse(endAt));
  let endLabel = end.hm;
  if (end.ymd !== start.ymd) {
    endLabel =
      end.hm === "00:00" && end.ymd === nextYmd(start.ymd)
        ? "24:00"
        : `${end.month}월 ${end.day}일 ${end.hm}`;
  }
  return {
    date: `${start.month}월 ${start.day}일 (${start.weekday})`,
    time: `${start.hm} – ${endLabel}`,
  };
}

export type CandidateItem = { startAt: string; endAt: string; availableParticipantCount: number };

// "더 보기"로 받은 다음 페이지를 붙인다. 페이지 사이에 계산 결과가 바뀌어 같은 시작 시각이 다시 오면 한 번만 둔다
// 겹치는 후보(RESULT-07-02 ❗미결)는 시작 시각이 다르므로 묶지 않고 각각 둔다
export function appendCandidates(
  current: readonly CandidateItem[],
  incoming: readonly CandidateItem[],
): CandidateItem[] {
  const seen = new Set(current.map((c) => Date.parse(c.startAt)));
  const next = [...current];
  for (const candidate of incoming) {
    const key = Date.parse(candidate.startAt);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(candidate);
  }
  return next;
}

// 방장이 이 구간 전체에 가능하다고 제출했는지 (RESULT-04-02 방장 불참 안내, RESULT-03-01 연속 충족)
// 제출하지 않았으면 집계에 들어가지 않으므로 불참으로 본다
export function isAvailableThroughout(
  me: { submitted: boolean; slots: readonly number[] },
  startAt: string,
  endAt: string,
): boolean {
  if (!me.submitted) return false;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false;
  const set = new Set(me.slots);
  for (let t = start; t < end; t += SLOT_MS) {
    if (!set.has(t)) return false;
  }
  return true;
}

export function inviteUrl(origin: string, inviteToken: string): string {
  return `${origin}/p/${encodeURIComponent(inviteToken)}`;
}
