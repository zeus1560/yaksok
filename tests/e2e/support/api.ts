// 통합 테스트 API 도우미 — 약속 준비는 API로 하고 화면 동작은 브라우저로 본다
// 테스트 서버(https 프록시, 자체 서명 인증서)에 Node https로 직접 요청한다. 세션 토큰·쿠키 값은 출력하지 않는다
import https from "node:https";
import { E2E_BASE_URL } from "./e2e-env";
import { deleteLinks } from "./db";
import { recordLink } from "./ledger";

export const BASE = E2E_BASE_URL;
export const ORIGIN = E2E_BASE_URL;
export const HOST_PIN = "1357";
export const MEMBER_PIN = "2468";

// keep-alive를 끈다: 서버가 닫은 유휴 소켓을 다시 써서 ECONNRESET이 나는 경쟁을 피한다
const agent = new https.Agent({ keepAlive: false, rejectUnauthorized: false });

export type ApiResponse = {
  status: number;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 응답 본문은 테스트에서 자유롭게 읽는다
  json: any;
  setCookies: string[];
  cacheControl: string | null;
  headers: Record<string, string | string[] | undefined>;
};

export function call(
  method: string,
  path: string,
  opts: { cookie?: string; origin?: string | null; body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = https.request(`${BASE}${path}`, { method, headers, agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {}
        const cc = res.headers["cache-control"];
        resolve({
          status: res.statusCode ?? 0,
          text,
          json,
          setCookies: res.headers["set-cookie"] ?? [],
          cacheControl: typeof cc === "string" ? cc : null,
          headers: res.headers,
        });
      });
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

export const cookieName = (promiseId: string) => `ys_session_${promiseId}`;
export const cookieOf = (promiseId: string, token: string) => `${cookieName(promiseId)}=${token}`;
export function tokenOf(res: ApiResponse, promiseId: string): string {
  const line = res.setCookies.find((c) => c.startsWith(`${cookieName(promiseId)}=`));
  if (!line) throw new Error(`세션 쿠키 없음 (${res.status})`);
  return line.split(";")[0].slice(`${cookieName(promiseId)}=`.length);
}
export const setCookieOf = (res: ApiResponse, promiseId: string) =>
  res.setCookies.find((c) => c.startsWith(`${cookieName(promiseId)}=`)) ?? "";
export const isClearedCookie = (res: ApiResponse, promiseId: string) => {
  const line = setCookieOf(res, promiseId);
  return line.startsWith(`${cookieName(promiseId)}=;`) && /Max-Age=0(;|$)/.test(line);
};

// ── 날짜 (한국 시간)
const SEOUL = 9 * 3600e3;
export const seoulDate = (offsetDays: number) =>
  new Date(Date.now() + SEOUL + offsetDays * 86400e3).toISOString().slice(0, 10);
export const seoulIso = (ms: number) => `${new Date(ms + SEOUL).toISOString().slice(0, 19)}+09:00`;
export const slotAt = (offsetDays: number, hhmm: string) =>
  `${seoulDate(offsetDays)}T${hhmm}:00+09:00`;
export const slotMs = (offsetDays: number, hhmm: string) => Date.parse(slotAt(offsetDays, hhmm));

let seq = 0;
const suffix = Math.random().toString(36).slice(2, 5);
// 닉네임은 2~12자. 실행·작업자마다 겹치지 않게 접두어 + 무작위 + 순번
export const nick = (prefix: string) => `${prefix}${suffix}${(seq++).toString(36)}`.slice(0, 12);

export type Member = { nickname: string; token: string; id: string };
export type Draft = {
  inviteToken: string;
  promiseId: string;
  hostNick: string;
  hostToken: string;
  hostId: string;
};
export type Collecting = Draft & { members: Member[] };

export type StartBody = {
  participantLimit: number;
  dateRange: { startDate: string; endDate: string };
  dailyTimeRange: { startTime: string; endTime: string };
  durationMinutes: number;
  votingDeadlineAt: string;
};

// 기본 설정: 날짜 내일~4일 뒤, 하루 09~18시, 60분, 정원 6, 마감 내일 12:00(한국 시간)
export function startBody(over: Partial<StartBody> = {}): StartBody {
  return {
    participantLimit: 6,
    dateRange: { startDate: seoulDate(1), endDate: seoulDate(4) },
    dailyTimeRange: { startTime: "09:00", endTime: "18:00" },
    durationMinutes: 60,
    votingDeadlineAt: `${seoulDate(1)}T12:00:00+09:00`,
    ...over,
  };
}

// 테스트 하나가 만든 데이터. 끝나면 cleanup()으로 지운다
export class Seed {
  readonly links = new Set<string>();

  track(inviteToken: string) {
    if (this.links.has(inviteToken)) return;
    this.links.add(inviteToken);
    recordLink(inviteToken);
  }

  async cleanup() {
    await deleteLinks([...this.links]);
  }

  async link(): Promise<string> {
    const res = await call("POST", "/api/v1/links");
    if (res.status !== 201) throw new Error(`링크 발급 실패 ${res.status} ${res.text}`);
    this.track(res.json.inviteToken);
    return res.json.inviteToken;
  }

  async draft(hostNick = nick("h")): Promise<Draft> {
    const inviteToken = await this.link();
    const host = await call("POST", `/api/v1/links/${inviteToken}/host`, {
      body: { nickname: hostNick, pin: HOST_PIN },
    });
    if (host.status !== 201) throw new Error(`방장 등록 실패 ${host.status} ${host.text}`);
    const promiseId: string = host.json.promiseId;
    return {
      inviteToken,
      promiseId,
      hostNick,
      hostToken: tokenOf(host, promiseId),
      hostId: host.json.participantId,
    };
  }

  async collecting(opts: { members?: number; settings?: Partial<StartBody> } = {}) {
    const D = await this.draft();
    const started = await call("POST", `/api/v1/promises/${D.promiseId}/start`, {
      cookie: cookieOf(D.promiseId, D.hostToken),
      body: startBody(opts.settings),
    });
    if (started.status !== 200) throw new Error(`설정 완료 실패 ${started.status} ${started.text}`);
    const members: Member[] = [];
    for (let i = 0; i < (opts.members ?? 1); i += 1) members.push(await join(D.promiseId));
    return { ...D, members } satisfies Collecting;
  }
}

export async function join(promiseId: string, nickname = nick("m")): Promise<Member> {
  const res = await call("POST", `/api/v1/promises/${promiseId}/participants`, {
    body: { nickname, pin: MEMBER_PIN },
  });
  if (res.status !== 201) throw new Error(`참여자 등록 실패 ${res.status} ${res.text}`);
  return { nickname, token: tokenOf(res, promiseId), id: res.json.participantId };
}

export async function login(promiseId: string, nickname: string, pin = MEMBER_PIN) {
  const res = await call("POST", `/api/v1/promises/${promiseId}/auth/session`, {
    body: { nickname, pin },
  });
  return { res, token: res.status === 200 ? tokenOf(res, promiseId) : null };
}

// 세션 쿠키로 약속 API 호출
export const as = (promiseId: string, token: string) => ({
  get: (sub = "") =>
    call("GET", `/api/v1/promises/${promiseId}${sub}`, {
      cookie: cookieOf(promiseId, token),
      origin: null,
    }),
  send: (method: string, sub: string, body?: unknown) =>
    call(method, `/api/v1/promises/${promiseId}${sub}`, {
      cookie: cookieOf(promiseId, token),
      body,
    }),
  submit: (slots: string[], baseVersion = 0) =>
    call("PUT", `/api/v1/promises/${promiseId}/me/availability`, {
      cookie: cookieOf(promiseId, token),
      body: { baseVersion, slots },
    }),
});
