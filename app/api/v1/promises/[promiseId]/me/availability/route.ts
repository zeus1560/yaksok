import {
  availabilityVersionConflict,
  draftExpired,
  forbidden,
  internalError,
  invalidOrigin,
  invalidRequest,
  invalidSlotFormat,
  payloadTooLarge,
  promiseCancelled,
  promiseNotFound,
  promiseNotOpen,
  slotLimitExceeded,
  unauthenticated,
  votingClosed,
} from "@/lib/api-error";
import { authenticatePromiseSession, withSessionCookie } from "@/lib/member/session-auth";
import { noStore } from "@/lib/no-store";
import { isAllowedOrigin } from "@/lib/origin";
import { parseSlotStrings } from "@/lib/time/slots";
import { toSeoulIsoMillisString, toSeoulIsoString } from "@/lib/time/seoul";
import { submitAvailability } from "@/lib/time/submit-availability";

// 5,000칸 × 약 30바이트에 여유를 둔 본문 상한 (TIME-API-01 보안 정보)
const MAX_BODY_BYTES = 256 * 1024;

// TIME-API-01 가능 시간 제출. 세션 토큰·쿠키 값은 로그에 남기지 않는다
export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/me/availability">,
) {
  return noStore(await handle(request, ctx));
}

async function handle(
  request: Request,
  ctx: RouteContext<"/api/v1/promises/[promiseId]/me/availability">,
): Promise<Response> {
  if (!isAllowedOrigin(request)) return invalidOrigin();

  const { promiseId } = await ctx.params;
  try {
    const text = await readBodyWithLimit(request);
    if (text === null) return payloadTooLarge();

    const auth = await authenticatePromiseSession(request, promiseId);
    if (auth.kind === "invalid_request") return invalidRequest();
    if (auth.kind === "not_found") return promiseNotFound();
    if (auth.kind === "cancelled") return promiseCancelled();
    if (auth.kind === "unauthenticated") return unauthenticated();
    if (auth.kind === "forbidden") return forbidden();

    // 여기부터는 세션 인증에 성공했으므로 모든 응답에 쿠키를 다시 보낸다
    const body = parseBody(text);
    if (!body) return withSessionCookie(invalidRequest(), auth);
    const parsed = parseSlotStrings(body.slots);
    if (parsed.kind === "limit_exceeded") return withSessionCookie(slotLimitExceeded(), auth);
    if (parsed.kind === "invalid_format") return withSessionCookie(invalidSlotFormat(), auth);

    const result = await submitAvailability(auth, {
      baseVersion: body.baseVersion,
      slots: parsed.slots,
    });
    const reply = (response: Response) => withSessionCookie(response, auth, result.session);
    switch (result.kind) {
      case "not_found":
        return reply(promiseNotFound());
      case "cancelled":
        return reply(promiseCancelled());
      case "draft_expired":
        return reply(draftExpired());
      case "not_open":
        return reply(promiseNotOpen());
      case "voting_closed":
        return reply(votingClosed());
      case "unauthenticated":
        return reply(unauthenticated());
      case "version_conflict":
        return reply(
          availabilityVersionConflict({
            currentVersion: result.currentVersion,
            submitted: result.submitted,
            slots: result.slots.map(toSeoulIsoString),
          }),
        );
      case "ok":
        return reply(
          Response.json({
            version: result.version,
            submitted: true,
            submittedAt: toSeoulIsoMillisString(result.submittedAt),
            slots: result.slots.map(toSeoulIsoString),
            droppedSlotCount: result.droppedSlotCount,
          }),
        );
    }
  } catch (error) {
    // 연결 문자열이 섞일 수 있는 원문 메시지 대신 오류 종류만 남긴다
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      "가능 시간 제출 실패",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return internalError();
  }
}

// Content-Length를 먼저 보고, 헤더가 없거나 틀려도 실제로 읽은 바이트로 다시 막는다. 초과하면 null
async function readBodyWithLimit(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseBody(text: string): { baseVersion: number; slots: string[] } | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { baseVersion, slots } = body as { baseVersion?: unknown; slots?: unknown };
  if (typeof baseVersion !== "number" || !Number.isSafeInteger(baseVersion) || baseVersion < 0) {
    return null;
  }
  if (!Array.isArray(slots) || !slots.every((slot) => typeof slot === "string")) return null;
  return { baseVersion, slots };
}
