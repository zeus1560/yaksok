import { describe, expect, it } from "vitest";
import { decidePoll, type PollResult } from "./poll";
import { decideDraft, type LocalDraft, type ServerMe } from "./sync";

type Data = { status: "collecting"; me: ServerMe; deadlineMs: number; cells: number };
const ok = (version: number, cells = 210): PollResult<Data> => ({
  ok: true,
  data: {
    status: "collecting",
    me: { version, submitted: true, slots: [1] },
    deadlineMs: 9_999,
    cells,
  },
});
const fail = (status: number, code: string | null): PollResult<Data> => ({
  ok: false,
  status,
  code,
});
const ctx = { startedAt: 10, lastWriteAt: 0, dragging: false, submitting: false };

describe("decidePoll", () => {
  it.each([
    [500, "INTERNAL_ERROR"],
    [502, null],
    [0, null],
    [418, "UNKNOWN_CODE"],
  ])("일시 실패 %s %s → 마지막 성공 응답 유지", (status, code) => {
    expect(decidePoll(fail(status, code), ctx)).toEqual({ kind: "keep_last" });
  });
  it.each([
    [401, "UNAUTHENTICATED"],
    [409, "PROMISE_CANCELLED"],
    [409, "PROMISE_NOT_OPEN"],
  ])("%s %s → 링크 재조회", (status, code) => {
    expect(decidePoll(fail(status, code), ctx)).toEqual({ kind: "relink" });
  });
  it("성공은 반영, 드래그 중은 보류, 제출 중은 건너뜀", () => {
    expect(decidePoll(ok(3), ctx).kind).toBe("apply");
    expect(decidePoll(ok(3), { ...ctx, dragging: true }).kind).toBe("defer");
    expect(decidePoll(ok(3), { ...ctx, submitting: true }).kind).toBe("skip");
  });
  it("제출 결과보다 먼저 시작한 응답은 성공·실패 모두 버린다", () => {
    expect(decidePoll(ok(2), { ...ctx, lastWriteAt: 20 })).toEqual({ kind: "stale" });
    expect(decidePoll(fail(500, null), { ...ctx, lastWriteAt: 20 })).toEqual({ kind: "stale" });
  });
});

// 화면(availability-board)이 하는 처리를 그대로 흉내 낸다: apply일 때만 마지막 응답 교체 + 버전 비교
function run(results: PollResult<Data>[], draft: LocalDraft | null) {
  let last: Data | null = null;
  let local = draft;
  let offline = false;
  for (const result of results) {
    const outcome = decidePoll(result, ctx);
    if (outcome.kind === "keep_last") {
      offline = true;
      continue;
    }
    if (outcome.kind !== "apply") continue;
    offline = false;
    if (decideDraft(local, outcome.data.me, outcome.data.status, 0).kind === "drop") local = null;
    last = outcome.data;
  }
  return { last, local, offline };
}

describe("500 연속 뒤 복귀", () => {
  const draft: LocalDraft = { baseVersion: 3, slots: [1, 2] };

  it("실패 동안 마지막 성공 응답(그리드·모두의 시간·마감)과 로컬 입력을 유지한다", () => {
    const first = ok(3);
    const state = run(
      [first, fail(500, "INTERNAL_ERROR"), fail(500, "INTERNAL_ERROR"), fail(0, null)],
      draft,
    );
    expect(state.last).toBe((first as { data: Data }).data);
    expect(state.local).toEqual(draft);
    expect(state.offline).toBe(true);
  });

  it("복귀하면 연결 불안정 표시를 끄고, 버전이 같으면 로컬 입력을 유지한다", () => {
    const state = run([ok(3), fail(500, null), fail(500, null), ok(3, 211)], draft);
    expect(state.offline).toBe(false);
    expect(state.last?.cells).toBe(211);
    expect(state.local).toEqual(draft);
  });

  it("첫 조회부터 실패해도 로컬 입력을 버리지 않는다", () => {
    const state = run([fail(500, null), fail(500, null)], draft);
    expect(state.last).toBeNull();
    expect(state.local).toEqual(draft);
  });
});
