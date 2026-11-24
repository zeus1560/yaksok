// 429 화면 안내 (035, R-41). 브라우저에서도 import하는 순수 함수다. 분기는 에러 코드로 한다(CLAUDE.md 4절)
// 남은 시도 횟수는 서버도 화면도 알려 주지 않는다(공격자에게 힌트가 된다)

export const RATE_LIMITED_MESSAGE = "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";

// 에러 응답 details.retryAfterSeconds. 없거나 숫자가 아니면 null
export function retryAfterSecondsOf(details: unknown): number | null {
  const value = (details as { retryAfterSeconds?: unknown } | null | undefined)?.retryAfterSeconds;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

// 남은 시간: 1시간 미만은 분으로 올림(1초 남아도 1분), 1시간 이상은 시간으로 올림(하루 상한 24시간 잠금 — R-41).
// 값이 없으면 "잠시 뒤에"
export function loginLockedMessage(retryAfterSeconds: number | null): string {
  let when = "잠시 뒤에";
  if (retryAfterSeconds !== null) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    when = minutes <= 60 ? `${minutes}분 뒤에` : `${Math.ceil(minutes / 60)}시간 뒤에`;
  }
  return `PIN을 여러 번 틀려 잠시 막혔어요. ${when} 다시 시도해 주세요.`;
}
