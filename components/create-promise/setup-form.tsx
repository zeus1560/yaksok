"use client";

import { useEffect, useRef, useState, type SubmitEvent, type ReactNode } from "react";
import { Button, Card, FieldError } from "@/components/common/ui";
import { callApi, type StartedSettings } from "@/components/create-promise/api";
import { Calendar } from "@/components/create-promise/calendar";
import { LeaveControl } from "@/components/leave/leave-panel";
import { formatCountdown, isUrgent, remainingMs } from "@/lib/create-promise/countdown";
import { addDays, selectDate, type DateRange } from "@/lib/create-promise/date-range";
import { resolveDeadline, toDeadlinePayload } from "@/lib/create-promise/deadline";
import {
  formatDailyRange,
  formatDateRange,
  formatDeadline,
  formatDuration,
} from "@/lib/create-promise/format";
import { classifyStartFailure, type SetupField } from "@/lib/create-promise/start-failure";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_END_MINUTE,
  DEFAULT_PARTICIPANT_LIMIT,
  DEFAULT_START_MINUTE,
  DURATION_SHRUNK_NOTICE,
  clampParticipantLimit,
  endAfterStartChange,
  endTimeOptions,
  fitDuration,
  startTimeOptions,
  stepDuration,
} from "@/lib/create-promise/time-options";
import {
  PARTICIPANT_LIMIT_MAX,
  PARTICIPANT_LIMIT_MIN,
  SLOT_MINUTES,
  minuteToTime,
} from "@/lib/state/start-settings";
import { DRAFT_DISCARDED_NOTICE, RELINK_NOTICE } from "@/lib/leave/confirm";
import { seoulDateOf } from "@/lib/time/seoul";

// 설정 화면 (STATE-API-02, Figma 35:76·35:278, 약속 이름 제외 — DECISION_CONFLICTS R-15)
// 카운트다운이 0이 되어도 화면에서 막지 않는다. 만료 판정은 서버가 한다

type Field = SetupField;

export const SELECT =
  "h-12 w-full rounded-lg border border-line bg-paper px-3 text-base outline-none focus:border-blue";

export function SetupForm(props: {
  promiseId: string;
  // 이 기기에서 방장 등록한 순간의 기기 시각 + 10분. null이면 기준값이 없어 카운트다운을 숨긴다
  localExpiresAt: number | null;
  onDone: (settings: StartedSettings) => void;
  onReset: (notice: string) => void;
  // 방장이 약속 나가기(STATE-API-08 draft 폐기)를 마쳤다(028). 상위가 저장값을 지우고 링크를 다시 조회한다
  onLeft: (notice: string) => void;
}) {
  const { promiseId, localExpiresAt } = props;
  const [now, setNow] = useState(() => Date.now());
  const [today] = useState(() => seoulDateOf(new Date()));

  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [dateNotice, setDateNotice] = useState<string | null>(null);
  const [startMinute, setStartMinute] = useState(DEFAULT_START_MINUTE);
  const [endMinute, setEndMinute] = useState(DEFAULT_END_MINUTE);
  const [duration, setDuration] = useState(DEFAULT_DURATION_MINUTES);
  const [durationNotice, setDurationNotice] = useState(false);
  const [limit, setLimit] = useState(DEFAULT_PARTICIPANT_LIMIT);
  const [limitText, setLimitText] = useState(String(DEFAULT_PARTICIPANT_LIMIT));
  const [deadline, setDeadline] = useState<string | null>(null);
  const [deadlineTouched, setDeadlineTouched] = useState(false);

  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  // 기기 시각 경과만으로 남은 시간을 계산한다
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const left = localExpiresAt === null ? null : remainingMs(localExpiresAt, now);

  function clearError(field: Field) {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function pickDate(date: string) {
    const result = selectDate(range, date, today);
    setRange(result.range);
    setDateNotice(result.notice);
    clearError("dateRange");
    // 직접 수정하지 않았으면 날짜 범위에 맞춰 마감 기본값을 다시 계산한다 (TIME-13-02)
    setDeadline(
      resolveDeadline({
        range: result.range,
        now: new Date(),
        current: deadline,
        touched: deadlineTouched,
      }),
    );
  }

  function applyDailyRange(start: number, end: number) {
    setStartMinute(start);
    setEndMinute(end);
    clearError("dailyTimeRange");
    const fitted = fitDuration(duration, start, end);
    setDuration(fitted.duration);
    if (fitted.shrunk) {
      setDurationNotice(true);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setDurationNotice(false), 3000);
    }
  }

  function changeLimit(value: number) {
    const next = clampParticipantLimit(value);
    setLimit(next);
    setLimitText(String(next));
    clearError("participantLimit");
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setFormError(null);
    const found: Partial<Record<Field, string>> = {};
    if (!range.start || !range.end) found.dateRange = "시작일과 종료일을 모두 골라 주세요.";
    const deadlinePayload = deadline ? toDeadlinePayload(deadline) : null;
    if (!deadlinePayload) found.votingDeadlineAt = "투표 마감 시각을 입력해 주세요.";
    setErrors(found);
    if (Object.keys(found).length > 0 || !range.start || !range.end || !deadlinePayload) return;

    // 정원 칸에서 Enter로 바로 제출한 경우에도 입력값을 반영한다
    const participantLimit = clampParticipantLimit(Number(limitText || PARTICIPANT_LIMIT_MIN));
    changeLimit(participantLimit);

    setPending(true);
    const result = await callApi<{ settings: StartedSettings }>(
      `/api/v1/promises/${promiseId}/start`,
      {
        method: "POST",
        body: {
          participantLimit,
          dateRange: { startDate: range.start, endDate: range.end },
          dailyTimeRange: {
            startTime: minuteToTime(startMinute),
            endTime: minuteToTime(endMinute),
          },
          durationMinutes: duration,
          votingDeadlineAt: deadlinePayload,
        },
      },
    );
    if (result.ok) {
      props.onDone(result.data.settings);
      return;
    }
    setPending(false);

    // 에러 코드로 분기한다. 저장소는 방장 세션이 없거나 더 이상 설정할 수 없을 때만 지운다
    const action = classifyStartFailure(result);
    if (action.kind === "reset") props.onReset(action.notice);
    else if (action.kind === "field") setErrors({ [action.field]: action.message });
    else setFormError(action.message);
  }

  const durationMax = endMinute - startMinute;
  const deadlineMax = range.end ? `${addDays(range.end, -1)}T23:59` : undefined;

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[280px_1fr] lg:gap-10">
      <aside className="space-y-4">
        <div className="hidden lg:block">
          <h1 className="text-[28px] font-bold leading-snug">우리 언제 만날까요?</h1>
          <p className="mt-2 text-sub">날짜 범위와 인원을 정하고 친구들에게 링크를 보내세요.</p>
        </div>
        <Preview
          range={range}
          limit={limit}
          daily={formatDailyRange(startMinute, endMinute)}
          duration={formatDuration(duration)}
          deadline={deadline}
        />
      </aside>

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[28px] font-bold leading-snug">새 약속 만들기</h2>
          {left === null ? (
            // 다른 기기·저장소 삭제로 경과 시간 기준값이 없다. 남은 시간은 서버만 알며 만료는 410으로 판정한다
            <p className="rounded-full bg-blue-soft px-3 py-1 text-sm font-medium text-ink">
              등록 후 10분 안에 설정을 마쳐야 합니다
            </p>
          ) : (
            <p
              role="timer"
              aria-live="off"
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                isUrgent(left) ? "bg-danger/10 text-danger" : "bg-blue-soft text-ink"
              }`}
            >
              설정 시간 {formatCountdown(left)} 남음
            </p>
          )}
        </div>

        <Section
          title="① 날짜 범위"
          hint="첫 클릭 시작일, 두 번째 클릭 종료일 · 최대 오늘부터 3개월"
        >
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
            <ReadOnlyValue label="시작" value={range.start ?? "선택 전"} />
            <ReadOnlyValue label="종료" value={range.end ?? "선택 전"} />
          </div>
          <Calendar today={today} range={range} onSelect={pickDate} invalid={!!errors.dateRange} />
          {dateNotice && (
            <p role="status" className="mt-2 text-sm text-warn">
              {dateNotice}
            </p>
          )}
          <FieldError id="dateRange-error" message={errors.dateRange} />
        </Section>

        <Section title="② 하루 시간 범위">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <select
              aria-label="하루 시작 시각"
              className={SELECT}
              value={startMinute}
              onChange={(e) => {
                const start = Number(e.target.value);
                applyDailyRange(start, endAfterStartChange(start, endMinute));
              }}
            >
              {startTimeOptions().map((m) => (
                <option key={m} value={m}>
                  {minuteToTime(m)}
                </option>
              ))}
            </select>
            <span className="text-sub">~</span>
            <select
              aria-label="하루 종료 시각"
              className={SELECT}
              value={endMinute}
              onChange={(e) => applyDailyRange(startMinute, Number(e.target.value))}
            >
              {endTimeOptions(startMinute).map((m) => (
                <option key={m} value={m}>
                  {minuteToTime(m)}
                </option>
              ))}
            </select>
          </div>
          <FieldError id="dailyTimeRange-error" message={errors.dailyTimeRange} />
        </Section>

        <div className="grid gap-6 sm:grid-cols-2">
          <Section title="③ 소요 시간">
            <Stepper
              label="소요 시간"
              value={formatDuration(duration)}
              onMinus={() => {
                setDuration(stepDuration(duration, -SLOT_MINUTES, startMinute, endMinute));
                clearError("durationMinutes");
              }}
              onPlus={() => {
                setDuration(stepDuration(duration, SLOT_MINUTES, startMinute, endMinute));
                clearError("durationMinutes");
              }}
              minusDisabled={duration <= SLOT_MINUTES}
              plusDisabled={duration >= durationMax}
            />
            {durationNotice && (
              <p role="status" className="mt-2 text-sm text-warn">
                {DURATION_SHRUNK_NOTICE}
              </p>
            )}
            <FieldError id="durationMinutes-error" message={errors.durationMinutes} />
          </Section>

          <Section title="④ 정원 (방장 포함)">
            <Stepper
              label="정원"
              value={
                <input
                  aria-label="정원 직접 입력"
                  inputMode="numeric"
                  className="h-full w-10 bg-transparent text-right outline-none"
                  value={limitText}
                  onChange={(e) => setLimitText(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  onBlur={() => changeLimit(Number(limitText || PARTICIPANT_LIMIT_MIN))}
                />
              }
              suffix="명"
              onMinus={() => changeLimit(limit - 1)}
              onPlus={() => changeLimit(limit + 1)}
              minusDisabled={limit <= PARTICIPANT_LIMIT_MIN}
              plusDisabled={limit >= PARTICIPANT_LIMIT_MAX}
            />
            <FieldError id="participantLimit-error" message={errors.participantLimit} />
          </Section>
        </div>

        <Section title="⑤ 투표 마감 (한국 시간)" hint="마감 후에는 응답을 수정할 수 없어요.">
          <input
            type="datetime-local"
            aria-label="투표 마감 (한국 시간)"
            className={SELECT}
            value={deadline ?? ""}
            min={`${today}T00:00`}
            max={deadlineMax}
            disabled={!range.end}
            onChange={(e) => {
              setDeadline(e.target.value || null);
              setDeadlineTouched(true);
              clearError("votingDeadlineAt");
            }}
          />
          {!range.end && (
            <p className="mt-1.5 text-xs text-sub">날짜 범위를 고르면 기본값이 채워져요.</p>
          )}
          <FieldError id="votingDeadlineAt-error" message={errors.votingDeadlineAt} />
        </Section>

        <Button type="submit" disabled={pending}>
          {pending ? "저장하는 중…" : "설정 완료 · 초대 링크 만들기"}
        </Button>
        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}

        <div className="border-t border-line pt-4">
          <LeaveControl
            promiseId={promiseId}
            buttonLabel="약속 만들기 그만두기"
            resolveSituation={async () => ({ kind: "draft_host" })}
            onLeft={() => props.onLeft(DRAFT_DISCARDED_NOTICE)}
            onRelink={() => props.onReset(RELINK_NOTICE)}
          />
        </div>
      </div>
    </form>
  );
}

function Preview(props: {
  range: DateRange;
  limit: number;
  daily: string;
  duration: string;
  deadline: string | null;
}) {
  const { start, end } = props.range;
  const dates =
    start && end
      ? formatDateRange(start, end)
      : start
        ? `${formatDateRange(start, start)}–?`
        : "날짜 선택 전";
  return (
    <Card className="!p-5">
      <p className="text-sm font-medium text-ink">약속 미리보기</p>
      <dl className="mt-3 space-y-1 text-sm text-sub">
        <div>
          {dates} · 방장 포함 {props.limit}명
        </div>
        <div>
          하루 {props.daily} · {props.duration}
        </div>
        <div>{props.deadline ? `${formatDeadline(props.deadline)} 마감` : "마감 미정"}</div>
      </dl>
    </Card>
  );
}

export function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{props.title}</legend>
      {props.children}
      {props.hint && <p className="mt-1.5 text-xs text-sub">{props.hint}</p>}
    </fieldset>
  );
}

export function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2">
      <span className="block text-xs text-sub">{label}</span>
      <span>{value.replaceAll("-", ".")}</span>
    </div>
  );
}

export function Stepper(props: {
  label: string;
  value: ReactNode;
  suffix?: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled: boolean;
  plusDisabled: boolean;
}) {
  const button =
    "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-paper text-lg text-ink disabled:text-line";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`${props.label} 줄이기`}
        className={button}
        onClick={props.onMinus}
        disabled={props.minusDisabled}
      >
        −
      </button>
      <div className="flex h-12 flex-1 items-center justify-center rounded-lg border border-line bg-paper px-2">
        {props.value}
        {props.suffix && <span className="ml-1 shrink-0">{props.suffix}</span>}
      </div>
      <button
        type="button"
        aria-label={`${props.label} 늘리기`}
        className={button}
        onClick={props.onPlus}
        disabled={props.plusDisabled}
      >
        +
      </button>
    </div>
  );
}
