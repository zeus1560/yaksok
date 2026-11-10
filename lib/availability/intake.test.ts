import { describe, expect, it, vi } from "vitest";
import { createIntake, JOIN_WINDOW_MS } from "./intake";
import { decidePoll } from "./poll";

const response = (startedAt: number, receivedAt: number) => ({
  result: { ok: true as const, data: { status: "collecting" } },
  startedAt,
  receivedAt,
});
const ctx = { startedAt: 0, lastWriteAt: 0, dragging: false, submitting: false };

describe("createIntake", () => {
  it("같은 주소 요청이 진행 중일 때 새로 그려진 시간 입력 화면도 그 응답으로 채워진다", () => {
    // 다른 화면이 100ms에 시작한 요청이 진행 중일 때 150ms에 새로 그려졌고, 응답은 400ms에 왔다
    const take = createIntake<ReturnType<typeof response>>(150);
    const shared = response(100, 400);
    expect(take(shared)).toEqual({ data: shared, joined: true });
  });

  it("같은 응답으로 다시 그려져도 decidePoll은 한 번만 실행된다", () => {
    const take = createIntake<ReturnType<typeof response>>(0);
    const decide = vi.fn(decidePoll);
    const shared = response(10, 50);
    for (let render = 0; render < 3; render += 1) {
      const taken = take(shared);
      if (taken) decide(taken.data.result, { ...ctx, startedAt: taken.data.startedAt });
    }
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("화면이 생긴 뒤 시작한 요청의 응답은 합류가 아니다", () => {
    const take = createIntake<ReturnType<typeof response>>(150);
    const own = response(200, 300);
    expect(take(own)).toEqual({ data: own, joined: false });
  });

  it("새 응답(다른 객체)은 내용이 같아도 각각 한 번씩 넘긴다", () => {
    const take = createIntake<ReturnType<typeof response>>(0);
    const first = response(10, 50);
    const second = response(5010, 5050);
    expect(take(first)?.data).toBe(first);
    expect(take(first)).toBeNull();
    expect(take(second)?.data).toBe(second);
    expect(take(second)).toBeNull();
  });

  it("막 끝난 요청(마운트 직전에 받은 응답)에 합류해도 넘긴다", () => {
    const take = createIntake<ReturnType<typeof response>>(10_000);
    const justDone = response(9_000, 9_500); // dedupingInterval(1초) 안
    expect(take(justDone)).toEqual({ data: justDone, joined: true });
  });

  it("합류 창 밖의 오래된 캐시는 넘기지 않고, 그 뒤 새 응답은 넘긴다", () => {
    const take = createIntake<ReturnType<typeof response>>(10_000);
    const old = response(1_000, 10_000 - JOIN_WINDOW_MS - 1);
    expect(take(old)).toBeNull();
    const fresh = response(10_010, 10_100);
    expect(take(fresh)).toEqual({ data: fresh, joined: false });
  });

  it("합류 창 경계(마운트 - 창)에서 받은 응답은 넘긴다", () => {
    const take = createIntake<ReturnType<typeof response>>(10_000);
    const edge = response(6_000, 10_000 - JOIN_WINDOW_MS);
    expect(take(edge)).toEqual({ data: edge, joined: true });
  });

  it("아직 응답이 없으면(undefined) 넘기지 않는다", () => {
    expect(createIntake(0)(undefined)).toBeNull();
  });
});
