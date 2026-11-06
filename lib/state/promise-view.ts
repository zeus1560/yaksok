import { DRAFT_EXPIRY_MS } from "@/lib/member/link-status";
import { isDeadlinePassed } from "@/lib/member/me-permissions";
import { toSeoulIsoString } from "@/lib/time/seoul";
import { minuteToTime } from "./start-settings";
import { MIN_CANDIDATE_PARTICIPANTS } from "./candidates";

// STATE-API-01 응답 조립. DB를 읽지 않는 순수 함수다
// 시각은 epoch 밀리초와 서울 고정 오프셋 헬퍼로만 다뤄 실행 기기의 시간대와 무관하다

export type PromiseViewStatus = "draft" | "collecting" | "closed" | "confirmed";

export type PromiseViewRow = {
  id: string;
  status: PromiseViewStatus; // DB status. cancelled는 호출 전에 걸러진다
  createdAt: Date;
  participantLimit: number | null;
  dateRangeStart: string | null; // YYYY-MM-DD
  dateRangeEnd: string | null;
  dailyStartMinute: number | null;
  dailyEndMinute: number | null;
  durationMinutes: number | null;
  votingDeadlineAt: Date | null;
  confirmedStartAt: Date | null;
};

export type PromiseViewBody = {
  promiseId: string;
  promiseStatus: PromiseViewStatus;
  draftExpiresAt: string | null;
  draftExpired: boolean;
  settings: {
    participantLimit: number | null;
    dateRange: { startDate: string | null; endDate: string | null };
    dailyTimeRange: { startTime: string | null; endTime: string | null };
    durationMinutes: number | null;
    votingDeadlineAt: string | null;
  };
  currentConfirmation: {
    startAt: string;
    endAt: string;
    availableParticipantCount: number;
    hostActionRequired: boolean;
  } | null;
};

const MINUTE_MS = 60_000;

// GET 응답의 promiseStatus. DB가 collecting이고 마감 시각 ≤ 판정 시각이면 closed로 계산만 한다 (STATE-API-00 effectiveStatus)
export function effectivePromiseStatus(
  status: PromiseViewStatus,
  votingDeadlineAt: Date | null,
  now: Date,
): PromiseViewStatus {
  return status === "collecting" && isDeadlinePassed(votingDeadlineAt, now) ? "closed" : status;
}

// requesterRole: 판정 시점의 요청자 participants.role
// availableParticipantCount: confirmed일 때 확정 구간 공통 가능 인원(countAvailableParticipants 결과), 그 외 null
export function buildPromiseView(input: {
  promise: PromiseViewRow;
  requesterRole: string;
  availableParticipantCount: number | null;
  now: Date;
}): PromiseViewBody {
  const { promise, now } = input;
  const isDraft = promise.status === "draft";
  // 만료 경계: created_at + 10분 ≤ 판정 시각이면 만료 (MEMBER·STATE 다른 API와 같은 경계). DB는 바꾸지 않는다
  const draftExpiresAt = isDraft ? new Date(promise.createdAt.getTime() + DRAFT_EXPIRY_MS) : null;

  return {
    promiseId: promise.id,
    promiseStatus: effectivePromiseStatus(promise.status, promise.votingDeadlineAt, now),
    draftExpiresAt: draftExpiresAt ? toSeoulIsoString(draftExpiresAt) : null,
    draftExpired: draftExpiresAt !== null && draftExpiresAt.getTime() <= now.getTime(),
    settings: {
      participantLimit: promise.participantLimit,
      dateRange: { startDate: promise.dateRangeStart, endDate: promise.dateRangeEnd },
      dailyTimeRange: {
        startTime:
          promise.dailyStartMinute === null ? null : minuteToTime(promise.dailyStartMinute),
        // 1440은 "24:00"
        endTime: promise.dailyEndMinute === null ? null : minuteToTime(promise.dailyEndMinute),
      },
      durationMinutes: promise.durationMinutes,
      votingDeadlineAt:
        promise.votingDeadlineAt === null ? null : toSeoulIsoString(promise.votingDeadlineAt),
    },
    currentConfirmation: buildConfirmation(input),
  };
}

function buildConfirmation(input: {
  promise: PromiseViewRow;
  requesterRole: string;
  availableParticipantCount: number | null;
}): PromiseViewBody["currentConfirmation"] {
  const { promise, availableParticipantCount: count } = input;
  if (promise.status !== "confirmed") return null;
  // DB CHECK(ck_promise_confirmed_start_at·설정 필수)가 보장하는 값이다. 어긋나면 데이터 오류(500)
  if (promise.confirmedStartAt === null || promise.durationMinutes === null || count === null) {
    throw new Error("확정 일정 값이 없는 confirmed 약속");
  }
  const startMs = promise.confirmedStartAt.getTime();
  return {
    startAt: toSeoulIsoString(promise.confirmedStartAt),
    // 종료는 저장하지 않는다. 현재 소요 시간으로 계산한다
    endAt: toSeoulIsoString(new Date(startMs + promise.durationMinutes * MINUTE_MS)),
    availableParticipantCount: count,
    // 방장에게만 재조율·취소 안내. 확정 상태와 confirmed_start_at은 바꾸지 않는다 (STATE-API-01 처리 순서 6)
    hostActionRequired: input.requesterRole === "host" && count < MIN_CANDIDATE_PARTICIPANTS,
  };
}
