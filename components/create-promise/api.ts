// 같은 출처 fetch. 쿠키는 브라우저가 처리한다. 요청·응답 본문(PIN 포함)을 로그로 남기지 않는다

export type ApiFailure = {
  status: number;
  code: string | null;
  message: string | null;
  field: string | null;
};

export type ApiResult<T> = { ok: true; status: number; data: T } | ({ ok: false } & ApiFailure);

export async function callApi<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    // 네트워크 오류
    return { ok: false, status: 0, code: null, message: null, field: null };
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: json as T };

  const body = (json ?? {}) as { code?: unknown; message?: unknown; details?: unknown };
  const details = (body.details ?? {}) as { field?: unknown };
  return {
    ok: false,
    status: response.status,
    code: typeof body.code === "string" ? body.code : null,
    message: typeof body.message === "string" ? body.message : null,
    field: typeof details.field === "string" ? details.field : null,
  };
}

export type LinkStatus = {
  inviteToken: string;
  promiseStatus: string;
  promiseId: string | null;
  nextAction: "register_host" | "wait_setup" | "join" | "view_result" | "cancelled";
  pollAfterMs: number | null;
  draftExpired: boolean;
};

export type StartedSettings = {
  participantLimit: number;
  dateRange: { startDate: string; endDate: string };
  dailyTimeRange: { startTime: string; endTime: string };
  durationMinutes: number;
  votingDeadlineAt: string;
};

// 저장소 접근은 시크릿 모드 등에서 예외가 날 수 있다
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장하지 못하면 새로고침 복원만 되지 않는다
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 무시
  }
}
