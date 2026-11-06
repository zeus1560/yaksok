import { classifyPollFailure, type Failure } from "./failure";

// 가능 시간 폴링(TIME-API-02) 응답 하나를 화면이 어떻게 다룰지. 브라우저에서도 import하는 순수 함수다
// fetcher는 실패도 값으로 돌려주므로(SWR은 에러 상태에서 주기 조회를 멈춘다) 이 함수가 성공·실패를 모두 받는다

export type PollResult<T> = { ok: true; data: T } | ({ ok: false } & Failure);

export type PollContext = {
  startedAt: number; // 이 조회를 시작한 단조 시각
  lastWriteAt: number; // 제출 결과(200·409)를 반영한 단조 시각
  dragging: boolean;
  submitting: boolean;
};

export type PollOutcome<T> =
  // 제출 결과보다 먼저 시작한 낡은 응답: 버린다
  | { kind: "stale" }
  // 약속 상태·세션이 바뀜: 링크 재조회
  | { kind: "relink" }
  // 일시 실패: 마지막 성공 응답(그리드·모두의 시간·남은 시간)과 로컬 입력을 그대로 두고 "연결 불안정"만 표시.
  // 버전 비교를 하지 않으므로 로컬 입력이 버려지지 않는다
  | { kind: "keep_last" }
  // 제출 중: 제출 결과가 더 새로운 값을 준다
  | { kind: "skip" }
  // 드래그 중: 다시 그리지 않고 드래그가 끝난 뒤 반영
  | { kind: "defer"; data: T }
  // 반영: 버전 비교(decideDraft) 후 화면 갱신
  | { kind: "apply"; data: T };

export function decidePoll<T>(result: PollResult<T>, ctx: PollContext): PollOutcome<T> {
  if (ctx.startedAt < ctx.lastWriteAt) return { kind: "stale" };
  if (!result.ok) {
    return classifyPollFailure(result).kind === "relink"
      ? { kind: "relink" }
      : { kind: "keep_last" };
  }
  if (ctx.submitting) return { kind: "skip" };
  if (ctx.dragging) return { kind: "defer", data: result.data };
  return { kind: "apply", data: result.data };
}
