import { callApi, type ApiResult } from "@/components/create-promise/api";
import type { CandidateItem } from "@/lib/result/format";
import type { PromiseSettings } from "@/lib/manage/settings-form";
import type { Confirmation } from "@/lib/result/view";

// STATE-API-01 응답 중 화면이 쓰는 부분 (실제 구현 lib/state/promise-view.ts)
// settings는 collecting·closed·confirmed에서 모든 값이 채워져 있다(draft만 null이 있고 이 화면은 draft를 그리지 않는다)
export type PromiseDetail = {
  promiseId: string;
  promiseStatus: string;
  settings: PromiseSettings;
  currentConfirmation: Confirmation | null;
};

// MEMBER-API-06 응답 (실제 구현 app/api/v1/promises/[promiseId]/participants/route.ts GET)
export type ParticipantRow = {
  participantId: string;
  nickname: string;
  role: "host" | "member";
  isMe: boolean;
};

export type ParticipantList = {
  participantLimit: number;
  currentParticipantCount: number;
  participants: ParticipantRow[];
};

// STATE-API-10 응답 (실제 구현 app/api/v1/promises/[promiseId]/candidates/route.ts)
export type CandidatePage = {
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  candidates: CandidateItem[];
};

// 폴링 응답이 쓰기 결과보다 먼저 시작했는지 비교하려고 시작 시각(단조 시계)을 함께 돌려준다
// 실패도 값으로 돌려준다(SWR은 에러 상태에서 주기 조회를 멈춘다, R-19)
export type Timed<T> = { result: ApiResult<T>; startedAt: number; finishedAt: number };

export async function fetchTimed<T>(path: string): Promise<Timed<T>> {
  const startedAt = performance.now();
  const result = await callApi<T>(path);
  return { result, startedAt, finishedAt: performance.now() };
}

export const PAGE_SIZE = 5; // RESULT-06-01 상위 5개, STATE-API-10 limit 최대 5

export function promisePath(promiseId: string, sub = ""): string {
  return `/api/v1/promises/${encodeURIComponent(promiseId)}${sub}`;
}
