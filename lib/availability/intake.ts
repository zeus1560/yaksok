// SWR data로 받은 폴링 응답을 화면 하나가 "새 응답마다 정확히 한 번" 처리하게 거르는 함수 (fix). 브라우저에서도 import하는 순수 함수다
//
// 왜 onSuccess가 아니라 data인가: SWR(2.5.1)은 같은 주소 요청이 진행 중이거나 막 끝났으면(dedupingInterval 안) 새로 그려진
// 화면이 그 요청에 합류해 data는 받지만 onSuccess는 요청을 시작한 화면에만 부른다. onSuccess로만 화면 값을 채우면 합류한 화면은
// 다음 주기(5초)까지 "불러오고 있어요"에 머문다
//
// - 같은 data(같은 객체)는 다시 넘기지 않는다: 다시 그려지기만 할 때 버전 비교·로컬 입력 정리가 반복되지 않는다
//   (fetcher가 시작·받은 시각을 함께 돌려주므로 응답마다 새 객체이고, SWR 깊은 비교에서도 같은 값이 되지 않는다)
// - joined: 이 화면이 생기기 전에 시작된 요청의 응답이다. 그 사이 상태가 바뀌었을 수 있어 호출자는 화면만 채우고 새로 조회한다
// - 마운트 훨씬 전에 받은 캐시(합류 창 밖)는 넘기지 않는다. SWR이 마운트 때 새로 조회하므로 그 응답을 기다린다
//   합류 창은 dedupingInterval(1초)보다 넉넉히 잡는다 — 창을 좁게 잡아 합류한 응답을 버리면 원래 문제가 다시 생긴다

export type Timing = { startedAt: number; receivedAt: number }; // 단조 시계(performance.now)

export type Taken<T> = { data: T; joined: boolean };

export const JOIN_WINDOW_MS = 3000;

export function createIntake<T extends Timing>(
  mountedAt: number,
  joinWindowMs = JOIN_WINDOW_MS,
): (data: T | undefined) => Taken<T> | null {
  let handled: T | undefined;
  return (data) => {
    if (data === undefined || data === handled) return null;
    handled = data;
    if (data.receivedAt < mountedAt - joinWindowMs) return null;
    return { data, joined: data.startedAt < mountedAt };
  };
}
