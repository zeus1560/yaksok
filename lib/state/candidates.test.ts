import { describe, expect, it } from "vitest";
import {
  computeCandidates,
  countAvailableParticipants,
  validateCandidateStart,
  type CandidateParticipant,
  type CandidateSettings,
} from "./candidates";

const at = (iso: string) => new Date(iso);
const SUBMITTED = at("2026-11-09T10:00:00+09:00");
// 계산 시각: 범위 전날이라 모든 칸이 미래
const BEFORE_RANGE = at("2026-11-09T12:00:00+09:00");

function settings(overrides: Partial<CandidateSettings> = {}): CandidateSettings {
  return {
    dateRangeStart: "2026-11-10",
    dateRangeEnd: "2026-11-10",
    dailyStartMinute: 9 * 60,
    dailyEndMinute: 12 * 60,
    durationMinutes: 60,
    ...overrides,
  };
}

// "HH:MM" 목록을 그날의 슬롯으로 만든다
function slotsOn(day: string, ...times: string[]): Date[] {
  return times.map((time) => at(`${day}T${time}:00+09:00`));
}

function person(slots: Date[], overrides: Partial<CandidateParticipant> = {}): CandidateParticipant {
  return { status: "active", submittedAt: SUBMITTED, slots, ...overrides };
}

// 결과를 비교하기 쉬운 문자열로
function summary(result: ReturnType<typeof computeCandidates>): string[] {
  return result.map(
    (c) =>
      `${c.startAt.toISOString()}~${c.endAt.toISOString()}:${c.availableParticipantCount}`,
  );
}
const iso = (s: string) => at(s).toISOString();
const row = (start: string, end: string, count: number) => `${iso(start)}~${iso(end)}:${count}`;

describe("computeCandidates (STATE-API-00 후보 계산 계약)", () => {
  describe("공통 가능 인원 = 슬롯별 참여자 집합의 교집합", () => {
    it("슬롯 A에 1·2번, 슬롯 B에 2·3번: 슬롯별 최솟값은 2명이지만 공통 가능은 1명이라 후보 아님 (ERD 11절)", () => {
      const result = computeCandidates({
        settings: settings({ dailyStartMinute: 10 * 60, dailyEndMinute: 11 * 60 }),
        participants: [
          person(slotsOn("2026-11-10", "10:00")),
          person(slotsOn("2026-11-10", "10:00", "10:30")),
          person(slotsOn("2026-11-10", "10:30")),
        ],
        now: BEFORE_RANGE,
      });
      expect(result).toEqual([]);
    });

    it("슬롯별 인원 합(4명)·최솟값(3명)과 다르게 공통 2명으로 센다", () => {
      // A: 1·2·3번, B: 1·2·4번 → 교집합 {1, 2}
      const result = computeCandidates({
        settings: settings({ dailyStartMinute: 10 * 60, dailyEndMinute: 11 * 60 }),
        participants: [
          person(slotsOn("2026-11-10", "10:00", "10:30")),
          person(slotsOn("2026-11-10", "10:00", "10:30")),
          person(slotsOn("2026-11-10", "10:00")),
          person(slotsOn("2026-11-10", "10:30")),
        ],
        now: BEFORE_RANGE,
      });
      expect(summary(result)).toEqual([
        row("2026-11-10T10:00:00+09:00", "2026-11-10T11:00:00+09:00", 2),
      ]);
    });

    it("구간 중간 슬롯 하나라도 비면 그 사람은 빠진다 (RESULT-03-01)", () => {
      // 90분 후보: 1번은 10:30이 빠짐
      const result = computeCandidates({
        settings: settings({ durationMinutes: 90, dailyStartMinute: 10 * 60, dailyEndMinute: 11 * 60 + 30 }),
        participants: [
          person(slotsOn("2026-11-10", "10:00", "11:00")),
          person(slotsOn("2026-11-10", "10:00", "10:30", "11:00")),
          person(slotsOn("2026-11-10", "10:00", "10:30", "11:00")),
        ],
        now: BEFORE_RANGE,
      });
      expect(summary(result)).toEqual([
        row("2026-11-10T10:00:00+09:00", "2026-11-10T11:30:00+09:00", 2),
      ]);
    });

    it("33명 이상이어도(비트 집합 여러 워드) 교집합을 정확히 센다", () => {
      // 0~39번 중 짝수는 10:00·10:30, 홀수는 10:00만 → 공통 20명
      const people = Array.from({ length: 40 }, (_, i) =>
        person(slotsOn("2026-11-10", ...(i % 2 === 0 ? ["10:00", "10:30"] : ["10:00"]))),
      );
      const result = computeCandidates({
        settings: settings({ dailyStartMinute: 10 * 60, dailyEndMinute: 11 * 60 }),
        participants: people,
        now: BEFORE_RANGE,
      });
      expect(result.map((c) => c.availableParticipantCount)).toEqual([20]);
    });
  });

  describe("소요 시간", () => {
    it("30분: 슬롯 하나가 후보 하나", () => {
      const result = computeCandidates({
        settings: settings({ durationMinutes: 30, dailyStartMinute: 10 * 60, dailyEndMinute: 11 * 60 }),
        participants: [
          person(slotsOn("2026-11-10", "10:00", "10:30")),
          person(slotsOn("2026-11-10", "10:30")),
        ],
        now: BEFORE_RANGE,
      });
      expect(summary(result)).toEqual([
        row("2026-11-10T10:30:00+09:00", "2026-11-10T11:00:00+09:00", 2),
      ]);
    });

    it("120분(슬롯 4개): 30분 간격으로 겹치는 시작점을 모두 만든다", () => {
      const all = slotsOn("2026-11-10", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30");
      const result = computeCandidates({
        settings: settings({ durationMinutes: 120 }),
        participants: [person(all), person(all)],
        now: BEFORE_RANGE,
      });
      expect(summary(result)).toEqual([
        row("2026-11-10T09:00:00+09:00", "2026-11-10T11:00:00+09:00", 2),
        row("2026-11-10T09:30:00+09:00", "2026-11-10T11:30:00+09:00", 2),
        row("2026-11-10T10:00:00+09:00", "2026-11-10T12:00:00+09:00", 2),
      ]);
    });

    it("소요 시간이 하루 범위보다 길면 후보 없음", () => {
      const all = slotsOn("2026-11-10", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30");
      const result = computeCandidates({
        settings: settings({ durationMinutes: 210 }),
        participants: [person(all), person(all)],
        now: BEFORE_RANGE,
      });
      expect(result).toEqual([]);
    });
  });

  describe("하루 경계 (같은 날짜의 하루 선택 범위 안)", () => {
    it("종료 24:00: 23:00 시작 60분 후보(끝 = 다음 날 00:00)는 포함, 23:30 시작은 범위를 넘어 제외", () => {
      const result = computeCandidates({
        settings: settings({
          dateRangeEnd: "2026-11-11",
          dailyStartMinute: 22 * 60,
          dailyEndMinute: 24 * 60,
        }),
        participants: [
          // 다음 날 00:00 슬롯이 있어도 23:30~00:30처럼 날짜를 넘는 후보는 만들지 않는다
          person([...slotsOn("2026-11-10", "22:00", "22:30", "23:00", "23:30"), ...slotsOn("2026-11-11", "00:00")]),
          person([...slotsOn("2026-11-10", "23:00", "23:30"), ...slotsOn("2026-11-11", "00:00")]),
        ],
        now: BEFORE_RANGE,
      });
      expect(summary(result)).toEqual([
        row("2026-11-10T23:00:00+09:00", "2026-11-11T00:00:00+09:00", 2),
      ]);
    });

    it("종료 12:00이면 11:30 시작 60분 후보는 제외(12:00 슬롯은 범위 밖)", () => {
      const result = computeCandidates({
        settings: settings(),
        participants: [
          person(slotsOn("2026-11-10", "11:30", "12:00")),
          person(slotsOn("2026-11-10", "11:30", "12:00")),
        ],
        now: BEFORE_RANGE,
      });
      expect(result).toEqual([]);
    });

    it("하루 시작 전·날짜 범위 밖에 저장된 슬롯은 후보가 되지 않는다", () => {
      const result = computeCandidates({
        settings: settings({ durationMinutes: 30 }),
        participants: [
          person([...slotsOn("2026-11-10", "08:30"), ...slotsOn("2026-11-11", "09:00")]),
          person([...slotsOn("2026-11-10", "08:30"), ...slotsOn("2026-11-11", "09:00")]),
        ],
        now: BEFORE_RANGE,
      });
      expect(result).toEqual([]);
    });

    it("날짜 범위 전체(여러 날, 화면의 한 주로 제한하지 않음)를 대상으로 한다", () => {
      const days = ["2026-11-10", "2026-11-20", "2026-12-31"];
      const slots = days.flatMap((day) => slotsOn(day, "09:00"));
      const result = computeCandidates({
        settings: settings({ dateRangeEnd: "2026-12-31", durationMinutes: 30 }),
        participants: [person(slots), person(slots)],
        now: BEFORE_RANGE,
      });
      expect(result.map((c) => c.startAt.toISOString())).toEqual(
        days.map((day) => iso(`${day}T09:00:00+09:00`)),
      );
    });
  });

  describe("지난 시작점 제외 (시작 > 계산 시각)", () => {
    const all = slotsOn("2026-11-10", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30");
    const run = (now: string) =>
      computeCandidates({
        settings: settings({ durationMinutes: 60 }),
        participants: [person(all), person(all)],
        now: at(now),
      }).map((c) => c.startAt.toISOString());

    it("시작 = 계산 시각이면 지난 것으로 보고 제외한다", () => {
      expect(run("2026-11-10T10:00:00+09:00")).toEqual([
        iso("2026-11-10T10:30:00+09:00"),
        iso("2026-11-10T11:00:00+09:00"),
      ]);
    });

    it("시작 1ms 전이면 포함한다", () => {
      expect(run("2026-11-10T09:59:59.999+09:00")[0]).toBe(iso("2026-11-10T10:00:00+09:00"));
    });

    it("구간 도중(시작은 지났고 끝은 미래)인 후보도 제외한다", () => {
      expect(run("2026-11-10T10:15:00+09:00")[0]).toBe(iso("2026-11-10T10:30:00+09:00"));
    });

    it("모든 시작점이 지났으면 빈 배열", () => {
      expect(run("2026-11-10T11:00:00+09:00")).toEqual([]);
    });
  });

  describe("집계 대상 (active + 제출 시각 있음)", () => {
    const both = slotsOn("2026-11-10", "10:00", "10:30");
    const base = settings({ dailyStartMinute: 10 * 60, dailyEndMinute: 11 * 60 });
    const count = (participants: CandidateParticipant[]) =>
      computeCandidates({ settings: base, participants, now: BEFORE_RANGE }).map(
        (c) => c.availableParticipantCount,
      );

    it("기준: 제출한 active 3명 → 3명", () => {
      expect(count([person(both), person(both), person(both)])).toEqual([3]);
    });

    it("미제출자(제출 시각 null)의 저장 슬롯은 세지 않는다 — 제출 해제 포함", () => {
      expect(count([person(both), person(both), person(both, { submittedAt: null })])).toEqual([2]);
    });

    it("탈퇴자(cancelled)의 보존 슬롯은 세지 않는다", () => {
      expect(count([person(both), person(both), person(both, { status: "cancelled" })])).toEqual([2]);
    });

    it("빈 선택 제출자는 가능 인원에 기여하지 않는다 (ERD 11절)", () => {
      expect(count([person(both), person([]), person(both)])).toEqual([2]);
    });

    it("1명만 가능한 구간은 후보가 아니다 (RESULT-04-01)", () => {
      expect(count([person(both), person([]), person(both, { submittedAt: null })])).toEqual([]);
    });

    it("집계 대상이 1명 이하이면 빈 배열", () => {
      expect(count([person(both)])).toEqual([]);
      expect(count([])).toEqual([]);
    });

    it("방장 여부는 입력에 없다 — 방장이 불가능해도 다른 2명이 가능하면 후보 (RESULT-04-02)", () => {
      // 방장(첫 번째)은 빈 제출, 나머지 둘이 가능
      expect(count([person([]), person(both), person(both)])).toEqual([2]);
    });
  });

  describe("정렬 (인원 내림차순 → 시작 오름차순)", () => {
    it("인원이 많은 후보가 먼저, 동점은 날짜·시작 시각이 빠른 순 (RESULT-06-01·06-02)", () => {
      const result = computeCandidates({
        settings: settings({ dateRangeEnd: "2026-11-11", durationMinutes: 30 }),
        participants: [
          person([...slotsOn("2026-11-10", "09:00", "11:00"), ...slotsOn("2026-11-11", "09:00", "10:00")]),
          person([...slotsOn("2026-11-10", "09:00", "11:00"), ...slotsOn("2026-11-11", "09:00", "10:00")]),
          person([...slotsOn("2026-11-10", "11:00"), ...slotsOn("2026-11-11", "10:00")]),
        ],
        now: BEFORE_RANGE,
      });
      expect(summary(result)).toEqual([
        row("2026-11-10T11:00:00+09:00", "2026-11-10T11:30:00+09:00", 3),
        row("2026-11-11T10:00:00+09:00", "2026-11-11T10:30:00+09:00", 3),
        row("2026-11-10T09:00:00+09:00", "2026-11-10T09:30:00+09:00", 2),
        row("2026-11-11T09:00:00+09:00", "2026-11-11T09:30:00+09:00", 2),
      ]);
    });

    it("입력 순서(참여자·슬롯 순서)가 달라도 결과가 같다", () => {
      const a = slotsOn("2026-11-10", "09:00", "09:30", "10:00");
      const b = slotsOn("2026-11-10", "09:30", "10:00", "10:30");
      const base = { settings: settings({ durationMinutes: 30 }), now: BEFORE_RANGE };
      const forward = computeCandidates({ ...base, participants: [person(a), person(b)] });
      const reversed = computeCandidates({
        ...base,
        participants: [person([...b].reverse()), person([...a].reverse())],
      });
      expect(summary(reversed)).toEqual(summary(forward));
    });
  });

  it("후보 객체에는 시작·끝·인원만 있다 (참여자 정보 없음)", () => {
    const both = slotsOn("2026-11-10", "10:00", "10:30");
    const [candidate] = computeCandidates({
      settings: settings(),
      participants: [person(both), person(both)],
      now: BEFORE_RANGE,
    });
    expect(Object.keys(candidate).sort()).toEqual(["availableParticipantCount", "endAt", "startAt"]);
  });

  it.each([
    ["소요 시간 0", { durationMinutes: 0 }],
    ["소요 시간 45", { durationMinutes: 45 }],
    ["하루 시작 ≥ 종료", { dailyStartMinute: 600, dailyEndMinute: 600 }],
    ["하루 종료 1470", { dailyEndMinute: 1470 }],
    ["날짜 역순", { dateRangeStart: "2026-11-11", dateRangeEnd: "2026-11-10" }],
    ["없는 날짜", { dateRangeEnd: "2026-02-30" }],
  ])("설정 값 오류(%s) → 예외", (_, overrides) => {
    expect(() =>
      computeCandidates({ settings: settings(overrides), participants: [], now: BEFORE_RANGE }),
    ).toThrow();
  });

  it("참여자 30명·날짜 범위 3개월·00:00~24:00(전원 전 칸 가능)에서도 빠르게 계산한다", () => {
    const start = "2026-11-10";
    const end = "2027-02-10";
    const first = at(`${start}T00:00:00+09:00`).getTime();
    const last = at(`${end}T23:30:00+09:00`).getTime();
    const all: Date[] = [];
    for (let t = first; t <= last; t += 30 * 60_000) all.push(new Date(t));
    // 사람마다 조금씩 다르게 비워 교집합이 실제로 계산되게 한다
    const people = Array.from({ length: 30 }, (_, i) =>
      person(all.filter((_, k) => (k + i) % 37 !== 0)),
    );

    for (const durationMinutes of [30, 120, 720]) {
      const began = performance.now();
      const result = computeCandidates({
        settings: settings({
          dateRangeStart: start,
          dateRangeEnd: end,
          dailyStartMinute: 0,
          dailyEndMinute: 24 * 60,
          durationMinutes,
        }),
        participants: people,
        now: BEFORE_RANGE,
      });
      const elapsed = performance.now() - began;

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].availableParticipantCount).toBeLessThanOrEqual(30);
      // 정렬 불변식
      for (let k = 1; k < result.length; k += 1) {
        const prev = result[k - 1];
        const cur = result[k];
        expect(
          prev.availableParticipantCount > cur.availableParticipantCount ||
            (prev.availableParticipantCount === cur.availableParticipantCount &&
              prev.startAt.getTime() < cur.startAt.getTime()),
        ).toBe(true);
      }
      // 실측은 수십 ms 이하. CI 편차를 감안해 넉넉히 잡는다
      expect(elapsed).toBeLessThan(1000);
    }
  });
});

describe("countAvailableParticipants (STATE-API-01 확정 구간 공통 가능 인원)", () => {
  const count = (participants: CandidateParticipant[], startAt: string, durationMinutes = 60) =>
    countAvailableParticipants({ participants, startAt: at(startAt), durationMinutes });

  it("교집합으로 센다: 슬롯 A에 1·2번, 슬롯 B에 2·3번이면 1명", () => {
    expect(
      count(
        [
          person(slotsOn("2026-11-10", "10:00")),
          person(slotsOn("2026-11-10", "10:00", "10:30")),
          person(slotsOn("2026-11-10", "10:30")),
        ],
        "2026-11-10T10:00:00+09:00",
      ),
    ).toBe(1);
  });

  it("active이고 제출 시각이 있는 참여자만: 탈퇴자·제출 해제자 슬롯은 빠진다", () => {
    const full = slotsOn("2026-11-10", "10:00", "10:30");
    expect(
      count(
        [
          person(full),
          person(full, { status: "cancelled" }),
          person(full, { submittedAt: null }),
          person([]),
        ],
        "2026-11-10T10:00:00+09:00",
      ),
    ).toBe(1);
  });

  it("2명 미만도 그대로 센다 (0·1명)", () => {
    expect(count([], "2026-11-10T10:00:00+09:00")).toBe(0);
    expect(count([person(slotsOn("2026-11-10", "10:00"))], "2026-11-10T10:00:00+09:00", 30)).toBe(
      1,
    );
  });

  it("미래 필터가 없다: 계산 시각과 무관하게 지난 구간도 센다", () => {
    const full = slotsOn("2026-01-05", "10:00", "10:30");
    expect(count([person(full), person(full)], "2026-01-05T10:00:00+09:00")).toBe(2);
  });

  it("범위 검사가 없다: 자정을 넘는 구간(23:30~00:30)도 슬롯만 맞으면 센다", () => {
    const slots = [at("2026-11-10T23:30:00+09:00"), at("2026-11-11T00:00:00+09:00")];
    expect(count([person(slots), person(slots)], "2026-11-10T23:30:00+09:00")).toBe(2);
  });

  it("구간의 마지막 슬롯이 없으면 그 사람은 빠진다", () => {
    expect(
      count(
        [
          person(slotsOn("2026-11-10", "10:00", "10:30", "11:00")),
          person(slotsOn("2026-11-10", "10:00", "10:30")),
        ],
        "2026-11-10T10:00:00+09:00",
        90,
      ),
    ).toBe(1);
  });

  it("30분 경계가 아닌 시작은 맞는 슬롯이 없어 0", () => {
    const full = slotsOn("2026-11-10", "10:00", "10:30");
    expect(count([person(full), person(full)], "2026-11-10T10:15:00+09:00")).toBe(0);
  });

  it("소요 시간이 30분 배수가 아니거나 30 미만이면 예외", () => {
    expect(() => count([], "2026-11-10T10:00:00+09:00", 45)).toThrow();
    expect(() => count([], "2026-11-10T10:00:00+09:00", 0)).toThrow();
  });

  it("33명 이상(비트 집합 2워드)도 정확히 센다", () => {
    const full = slotsOn("2026-11-10", "10:00", "10:30");
    const people = Array.from({ length: 40 }, (_, i) =>
      person(i % 4 === 0 ? slotsOn("2026-11-10", "10:00") : full),
    );
    expect(count(people, "2026-11-10T10:00:00+09:00")).toBe(30);
  });

  it("computeCandidates의 각 후보 인원과 같은 값 (같은 기준)", () => {
    const participants = [
      person(slotsOn("2026-11-10", "09:00", "09:30", "10:00", "10:30")),
      person(slotsOn("2026-11-10", "09:30", "10:00", "10:30", "11:00")),
      person(slotsOn("2026-11-10", "10:00", "10:30", "11:00", "11:30")),
      person(slotsOn("2026-11-10", "09:00", "10:00", "10:30"), { status: "cancelled" }),
    ];
    const candidates = computeCandidates({
      settings: settings(),
      participants,
      now: BEFORE_RANGE,
    });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(
        countAvailableParticipants({
          participants,
          startAt: candidate.startAt,
          durationMinutes: 60,
        }),
      ).toBe(candidate.availableParticipantCount);
    }
  });
});

describe("validateCandidateStart (STATE-API-05 확정 재검증) — computeCandidates와 같은 판정", () => {
  const MIN_MS = 60_000;
  const DAY_MS = 24 * 60 * MIN_MS;

  // 결정적 의사 난수 (mulberry32)
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  type Dataset = {
    name: string;
    settings: CandidateSettings;
    participants: CandidateParticipant[];
    now: Date;
  };

  // 날짜 범위 앞뒤 하루까지 30분 칸에 무작위로 가능 시간을 넣는다(범위 밖 저장 슬롯도 섞인다).
  // 탈퇴자·미제출자도 섞고, now는 범위 전·첫날 하루 범위 도중(경계 아님)·정확히 경계·둘째 날 새벽에서 고른다
  function dataset(seed: number): Dataset {
    const random = rng(seed);
    const pick = <T,>(values: T[]): T => values[Math.floor(random() * values.length)];
    const startDay = pick(["2026-11-10", "2026-12-31", "2027-02-27"]);
    const days = 1 + Math.floor(random() * 3);
    const dailyStartMinute = pick([0, 9 * 60, 13 * 60 + 30, 22 * 60]);
    const dailyEndMinute = pick(
      [dailyStartMinute + 60, dailyStartMinute + 150, 24 * 60].filter((m) => m <= 24 * 60),
    );
    const durationMinutes = pick(
      [30, 60, 90, 120].filter((d) => d <= dailyEndMinute - dailyStartMinute),
    );
    const first = at(`${startDay}T00:00:00+09:00`).getTime();
    const endDay = new Date(first + (days - 1) * DAY_MS + 9 * 3600_000).toISOString().slice(0, 10);
    const participants: CandidateParticipant[] = [];
    const count = 2 + Math.floor(random() * 6);
    for (let i = 0; i < count; i += 1) {
      const slots: Date[] = [];
      for (let t = first - DAY_MS; t < first + (days + 1) * DAY_MS; t += 30 * MIN_MS) {
        if (random() < 0.55) slots.push(new Date(t));
      }
      const kind = random();
      participants.push(
        kind < 0.12
          ? { status: "cancelled", submittedAt: SUBMITTED, slots }
          : kind < 0.22
            ? { status: "active", submittedAt: null, slots }
            : { status: "active", submittedAt: SUBMITTED, slots },
      );
    }
    const now = pick([
      new Date(first - 3 * DAY_MS),
      new Date(first + dailyStartMinute * MIN_MS + 45 * MIN_MS + 123),
      new Date(first + dailyStartMinute * MIN_MS + 30 * MIN_MS),
      new Date(first + DAY_MS + 7 * MIN_MS),
    ]);
    return {
      name: `seed ${seed} (${startDay}~${endDay}, ${dailyStartMinute}~${dailyEndMinute}분, ${durationMinutes}분, ${count}명)`,
      settings: {
        dateRangeStart: startDay,
        dateRangeEnd: endDay,
        dailyStartMinute,
        dailyEndMinute,
        durationMinutes,
      },
      participants,
      now,
    };
  }

  const datasets = Array.from({ length: 40 }, (_, i) => dataset(i + 1));

  it.each(datasets.map((d) => [d.name, d] as const))(
    "%s: 후보 목록의 모든 후보는 통과하고, 목록에 없는 시작점은 모두 거부된다",
    (_name, d) => {
      const candidates = computeCandidates(d);
      const byStart = new Map(candidates.map((c) => [c.startAt.getTime(), c]));

      for (const candidate of candidates) {
        expect(validateCandidateStart({ ...d, startAt: candidate.startAt })).toEqual({
          ok: true,
          candidate,
        });
      }

      // 범위 앞뒤 하루까지 10분 간격(30분 경계 아닌 점 포함) + 각 점에서 1밀리초 어긋난 점
      const first = at(`${d.settings.dateRangeStart}T00:00:00+09:00`).getTime();
      const last = at(`${d.settings.dateRangeEnd}T00:00:00+09:00`).getTime();
      for (let t = first - DAY_MS; t <= last + 2 * DAY_MS; t += 10 * MIN_MS) {
        for (const start of [t, t + 1]) {
          const verdict = validateCandidateStart({ ...d, startAt: new Date(start) });
          const listed = byStart.get(start);
          if (listed) expect(verdict).toEqual({ ok: true, candidate: listed });
          else expect(verdict.ok).toBe(false);
        }
      }
    },
  );

  it("40개 데이터 전체에서 거부 이유 다섯 가지가 모두 나오고 통과도 충분히 있다 (검사 범위 확인)", () => {
    const seen = new Set<string>();
    let accepted = 0;
    for (const d of datasets) {
      const first = at(`${d.settings.dateRangeStart}T00:00:00+09:00`).getTime();
      const last = at(`${d.settings.dateRangeEnd}T00:00:00+09:00`).getTime();
      for (let t = first - DAY_MS; t <= last + 2 * DAY_MS; t += 10 * MIN_MS) {
        const verdict = validateCandidateStart({ ...d, startAt: new Date(t) });
        if (verdict.ok) accepted += 1;
        else seen.add(verdict.reason);
      }
    }
    expect([...seen].sort()).toEqual([
      "not_future",
      "not_slot_boundary",
      "out_of_daily_range",
      "out_of_date_range",
      "too_few_participants",
    ]);
    expect(accepted).toBeGreaterThan(100);
  });

  describe("후보 목록에 없는 시작점", () => {
    // 2026-11-10 09:00~12:00, 60분. 1번 09:00~11:00, 2번 09:00~12:00, 3번 11:00~12:00
    const base = {
      settings: settings(),
      participants: [
        person(slotsOn("2026-11-10", "09:00", "09:30", "10:00", "10:30")),
        person(slotsOn("2026-11-10", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30")),
        person(slotsOn("2026-11-10", "11:00", "11:30")),
      ],
      now: at("2026-11-10T09:10:00+09:00"),
    };

    it("목록에는 09:30·10:00(2명)과 11:00(2명)이 있다", () => {
      expect(summary(computeCandidates(base))).toEqual([
        row("2026-11-10T09:30:00+09:00", "2026-11-10T10:30:00+09:00", 2),
        row("2026-11-10T10:00:00+09:00", "2026-11-10T11:00:00+09:00", 2),
        row("2026-11-10T11:00:00+09:00", "2026-11-10T12:00:00+09:00", 2),
      ]);
    });

    it.each([
      ["지난 시각 (09:00 < now)", "2026-11-10T09:00:00+09:00", "not_future"],
      ["30분 경계 아님 (09:45)", "2026-11-10T09:45:00+09:00", "not_slot_boundary"],
      ["초가 0이 아님 (10:00:01)", "2026-11-10T10:00:01+09:00", "not_slot_boundary"],
      ["하루 범위를 넘는 구간 (11:30~12:30)", "2026-11-10T11:30:00+09:00", "out_of_daily_range"],
      ["하루 범위 끝에서 시작 (12:00)", "2026-11-10T12:00:00+09:00", "out_of_daily_range"],
      ["날짜 범위 밖 (다음 날)", "2026-11-11T10:00:00+09:00", "out_of_date_range"],
      ["공통 1명 (10:30~11:30은 2번만)", "2026-11-10T10:30:00+09:00", "too_few_participants"],
    ])("%s → 거부(%s)", (_n, start, reason) => {
      expect(validateCandidateStart({ ...base, startAt: at(start) })).toEqual({ ok: false, reason });
    });

    it("시작 = now(30분 경계)는 지난 것으로 거부한다 (R-20)", () => {
      const onBoundary = { ...base, now: at("2026-11-10T09:30:00+09:00") };
      expect(validateCandidateStart({ ...onBoundary, startAt: at("2026-11-10T09:30:00+09:00") })).toEqual({
        ok: false,
        reason: "not_future",
      });
      expect(summary(computeCandidates(onBoundary))).not.toContain(
        row("2026-11-10T09:30:00+09:00", "2026-11-10T10:30:00+09:00", 2),
      );
    });

    it("같은 절대 시각이면 오프셋 표기와 무관하게 같은 판정", () => {
      const a = validateCandidateStart({ ...base, startAt: at("2026-11-10T10:00:00+09:00") });
      const b = validateCandidateStart({ ...base, startAt: at("2026-11-10T01:00:00Z") });
      expect(a).toEqual(b);
      expect(a.ok).toBe(true);
    });

    it("24:00 종료면 23:00 시작 60분 구간까지 허용, 23:30은 하루 범위 초과", () => {
      const late = {
        settings: settings({ dailyStartMinute: 22 * 60, dailyEndMinute: 24 * 60 }),
        participants: [
          person(slotsOn("2026-11-10", "23:00", "23:30")),
          person(slotsOn("2026-11-10", "23:00", "23:30")),
        ],
        now: BEFORE_RANGE,
      };
      expect(validateCandidateStart({ ...late, startAt: at("2026-11-10T23:00:00+09:00") }).ok).toBe(
        true,
      );
      expect(validateCandidateStart({ ...late, startAt: at("2026-11-10T23:30:00+09:00") })).toEqual({
        ok: false,
        reason: "out_of_daily_range",
      });
    });
  });
});
