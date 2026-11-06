// STATE-API-10 limit·offset 검증과 페이지 자르기. DB를 읽지 않는 순수 함수다

export const CANDIDATE_PAGE_DEFAULT_LIMIT = 5; // RESULT-06-01 상위 5개 기본 표시
export const CANDIDATE_PAGE_MAX_LIMIT = 5;

export type CandidatePageRequest = { limit: number; offset: number };

export type ParsedCandidatePage =
  | ({ kind: "ok" } & CandidatePageRequest)
  | { kind: "invalid"; field: "limit" | "offset" };

// 10진 정수 표기만 받는다. "1.0"·"1e1"·" 1"·"+1"·빈 값·같은 이름 반복은 거절한다 (422 VALIDATION_FAILED)
const INTEGER = /^(0|-?[1-9]\d*)$/;

export function parseCandidatePage(params: URLSearchParams): ParsedCandidatePage {
  const limit = readInteger(params, "limit", CANDIDATE_PAGE_DEFAULT_LIMIT);
  if (limit === null || limit < 1 || limit > CANDIDATE_PAGE_MAX_LIMIT) {
    return { kind: "invalid", field: "limit" };
  }
  const offset = readInteger(params, "offset", 0);
  if (offset === null || offset < 0) return { kind: "invalid", field: "offset" };
  return { kind: "ok", limit, offset };
}

// 없으면 기본값, 형식이 틀리거나 안전한 정수 범위를 넘으면 null
function readInteger(params: URLSearchParams, name: string, fallback: number): number | null {
  const values = params.getAll(name);
  if (values.length === 0) return fallback;
  if (values.length > 1 || !INTEGER.test(values[0])) return null;
  const value = Number(values[0]);
  return Number.isSafeInteger(value) ? value : null;
}

// offset이 전체 개수 이상이면 빈 배열·hasMore=false·nextOffset=null
export function sliceCandidatePage<T>(
  all: readonly T[],
  page: CandidatePageRequest,
): { total: number; hasMore: boolean; nextOffset: number | null; items: T[] } {
  const items = all.slice(page.offset, page.offset + page.limit);
  const end = page.offset + items.length;
  const hasMore = items.length > 0 && end < all.length;
  return { total: all.length, hasMore, nextOffset: hasMore ? end : null, items };
}
