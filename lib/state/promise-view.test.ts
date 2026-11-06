import { describe, expect, it } from "vitest";
import { buildPromiseView, effectivePromiseStatus, type PromiseViewRow } from "./promise-view";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-10T12:00:00.500+09:00");
const ID = "7c1b2f40-8f6a-4c21-9d55-0d3b1a7e9c42";

function row(overrides: Partial<PromiseViewRow> = {}): PromiseViewRow {
  return {
    id: ID,
    status: "collecting",
    createdAt: at("2026-11-09T09:00:00.123+09:00"),
    participantLimit: 8,
    dateRangeStart: "2026-11-20",
    dateRangeEnd: "2026-11-30",
    dailyStartMinute: 9 * 60,
    dailyEndMinute: 18 * 60,
    durationMinutes: 60,
    votingDeadlineAt: at("2026-11-19T18:00:00+09:00"),
    confirmedStartAt: null,
    ...overrides,
  };
}

const view = (
  promise: PromiseViewRow,
  { role = "member", count = null as number | null, now = NOW } = {},
) => buildPromiseView({ promise, requesterRole: role, availableParticipantCount: count, now });

describe("effectivePromiseStatus (STATE-API-00)", () => {
  const deadline = at("2026-11-10T12:00:00+09:00");
  it("collecting이고 마감 = 판정 시각이면 closed (마감 시각 포함)", () => {
    expect(effectivePromiseStatus("collecting", deadline, deadline)).toBe("closed");
  });
  it("collecting이고 마감 1ms 전이면 collecting", () => {
    expect(effectivePromiseStatus("collecting", deadline, new Date(deadline.getTime() - 1))).toBe(
      "collecting",
    );
  });
  it.each(["draft", "closed", "confirmed"] as const)("%s는 마감과 무관하게 그대로", (status) => {
    expect(effectivePromiseStatus(status, deadline, new Date(deadline.getTime() + 1))).toBe(status);
  });
});

describe("buildPromiseView (STATE-API-01 응답 조립)", () => {
  it("collecting: 명세 본문 형태, 초 단위 +09:00, draft 필드는 null·false, 확정 null", () => {
    expect(view(row())).toEqual({
      promiseId: ID,
      promiseStatus: "collecting",
      draftExpiresAt: null,
      draftExpired: false,
      settings: {
        participantLimit: 8,
        dateRange: { startDate: "2026-11-20", endDate: "2026-11-30" },
        dailyTimeRange: { startTime: "09:00", endTime: "18:00" },
        durationMinutes: 60,
        votingDeadlineAt: "2026-11-19T18:00:00+09:00",
      },
      currentConfirmation: null,
    });
  });

  it("하루 범위 00:00~24:00: 0은 00:00, 1440은 24:00", () => {
    const body = view(row({ dailyStartMinute: 0, dailyEndMinute: 1440 }));
    expect(body.settings.dailyTimeRange).toEqual({ startTime: "00:00", endTime: "24:00" });
  });

  it("30분 단위 분 값: 570 → 09:30, 1410 → 23:30", () => {
    const body = view(row({ dailyStartMinute: 570, dailyEndMinute: 1410 }));
    expect(body.settings.dailyTimeRange).toEqual({ startTime: "09:30", endTime: "23:30" });
  });

  it("마감 지난 collecting: promiseStatus만 closed, 설정은 그대로", () => {
    const body = view(row({ votingDeadlineAt: at("2026-11-10T12:00:00+09:00") }));
    expect(body.promiseStatus).toBe("closed");
    expect(body.settings.votingDeadlineAt).toBe("2026-11-10T12:00:00+09:00");
    expect(body.currentConfirmation).toBeNull();
  });

  it("마감 시각의 밀리초는 버린다 (다른 API와 같은 초 단위 표기)", () => {
    const body = view(row({ votingDeadlineAt: at("2026-11-19T17:59:59.999+09:00") }));
    expect(body.settings.votingDeadlineAt).toBe("2026-11-19T17:59:59+09:00");
  });

  describe("draft", () => {
    const draft = row({
      status: "draft",
      createdAt: at("2026-11-10T11:50:00.700+09:00"),
      participantLimit: null,
      dateRangeStart: null,
      dateRangeEnd: null,
      dailyStartMinute: null,
      dailyEndMinute: null,
      durationMinutes: null,
      votingDeadlineAt: null,
    });

    it("미설정 값은 각각 null, draftExpiresAt = created_at + 10분", () => {
      const body = view(draft, { role: "host", now: at("2026-11-10T11:59:00+09:00") });
      expect(body).toEqual({
        promiseId: ID,
        promiseStatus: "draft",
        draftExpiresAt: "2026-11-10T12:00:00+09:00",
        draftExpired: false,
        settings: {
          participantLimit: null,
          dateRange: { startDate: null, endDate: null },
          dailyTimeRange: { startTime: null, endTime: null },
          durationMinutes: null,
          votingDeadlineAt: null,
        },
        currentConfirmation: null,
      });
    });

    it("만료 경계: created_at + 10분 = 판정 시각이면 draftExpired true, 1ms 전이면 false", () => {
      const expiry = draft.createdAt.getTime() + 10 * 60_000;
      expect(view(draft, { role: "host", now: new Date(expiry) }).draftExpired).toBe(true);
      expect(view(draft, { role: "host", now: new Date(expiry - 1) }).draftExpired).toBe(false);
    });

    it("10분이 지나도 promiseStatus는 draft (GET은 DB를 바꾸지 않는다)", () => {
      const body = view(draft, { role: "host", now: at("2026-11-10T13:00:00+09:00") });
      expect(body.promiseStatus).toBe("draft");
      expect(body.draftExpired).toBe(true);
    });

    it("일부만 설정된 draft는 있는 값만 채운다", () => {
      const body = view({ ...draft, participantLimit: 5, dailyEndMinute: 1440 }, { role: "host" });
      expect(body.settings.participantLimit).toBe(5);
      expect(body.settings.dailyTimeRange).toEqual({ startTime: null, endTime: "24:00" });
    });
  });

  describe("confirmed", () => {
    const confirmed = row({
      status: "confirmed",
      votingDeadlineAt: at("2026-11-09T18:00:00+09:00"),
      confirmedStartAt: at("2026-11-20T23:00:00+09:00"),
      durationMinutes: 90,
    });

    it("startAt·endAt(시작 + 현재 소요 시간, 날짜를 넘어가도 계산)·인원", () => {
      expect(view(confirmed, { count: 3 }).currentConfirmation).toEqual({
        startAt: "2026-11-20T23:00:00+09:00",
        endAt: "2026-11-21T00:30:00+09:00",
        availableParticipantCount: 3,
        hostActionRequired: false,
      });
    });

    it("promiseStatus는 confirmed (마감이 지났어도)", () => {
      expect(view(confirmed, { count: 3 }).promiseStatus).toBe("confirmed");
    });

    it.each([
      ["host", 0, true],
      ["host", 1, true],
      ["host", 2, false],
      ["member", 0, false],
      ["member", 1, false],
    ])("요청자 %s·인원 %i → hostActionRequired %s", (role, count, expected) => {
      expect(view(confirmed, { role, count }).currentConfirmation?.hostActionRequired).toBe(
        expected,
      );
    });

    it("확정 시각·소요 시간·인원이 없으면 데이터 오류로 예외", () => {
      expect(() => view({ ...confirmed, confirmedStartAt: null }, { count: 2 })).toThrow();
      expect(() => view({ ...confirmed, durationMinutes: null }, { count: 2 })).toThrow();
      expect(() => view(confirmed, { count: null })).toThrow();
    });
  });

  it.each(["collecting", "closed"] as const)(
    "%s는 confirmed_start_at이 있어도 확정 null",
    (status) => {
      const body = view(row({ status, confirmedStartAt: at("2026-11-20T10:00:00+09:00") }), {
        count: 3,
      });
      expect(body.currentConfirmation).toBeNull();
    },
  );

  it("실행 기기 시간대와 무관: 서울 자정 경계 날짜·시각이 그대로", () => {
    const body = view(
      row({
        status: "confirmed",
        confirmedStartAt: at("2026-11-20T00:00:00+09:00"),
        durationMinutes: 30,
        votingDeadlineAt: at("2026-11-19T23:59:00+09:00"),
      }),
      { count: 2 },
    );
    expect(body.settings.votingDeadlineAt).toBe("2026-11-19T23:59:00+09:00");
    expect(body.currentConfirmation?.startAt).toBe("2026-11-20T00:00:00+09:00");
    expect(body.currentConfirmation?.endAt).toBe("2026-11-20T00:30:00+09:00");
  });
});
