"use client";

import { useMemo, useState, type SubmitEvent } from "react";
import { Button, FieldError } from "@/components/common/ui";
import { callApi } from "@/components/create-promise/api";
import { Calendar } from "@/components/create-promise/calendar";
import { ReadOnlyValue, SELECT, Section, Stepper } from "@/components/create-promise/setup-form";
import { promisePath } from "@/components/result/api-types";
import { addDays, selectDate } from "@/lib/create-promise/date-range";
import { formatDuration } from "@/lib/create-promise/format";
import {
  DURATION_SHRUNK_NOTICE,
  clampParticipantLimit,
  endAfterStartChange,
  endTimeOptions,
  fitDuration,
  startTimeOptions,
  stepDuration,
} from "@/lib/create-promise/time-options";
import {
  classifyReopenFailure,
  classifySettingsFailure,
  type ManageAction,
} from "@/lib/manage/failure";
import {
  describeReopenImpact,
  describeSettingsImpact,
  type ReopenImpact,
} from "@/lib/manage/impact";
import {
  buildReopenBody,
  buildSettingsBody,
  formFromSettings,
  isShrinkBlockedByDeadline,
  NO_CHANGE_MESSAGE,
  previewRangeChange,
  RANGE_REMOVES_NOTICE,
  RANGE_RESUBMIT_NOTICE,
  seoulLocalNow,
  SHRINK_BLOCKED_MESSAGE,
  toLocalDeadline,
  validateSettingsForm,
  type FormMode,
  type PromiseSettings,
  type SettingsForm,
} from "@/lib/manage/settings-form";
import {
  PARTICIPANT_LIMIT_MAX,
  PARTICIPANT_LIMIT_MIN,
  SLOT_MINUTES,
  minuteToTime,
  type StartSettingsField,
} from "@/lib/state/start-settings";
import { seoulDateOf } from "@/lib/time/seoul";

// 모집 중 설정 변경(STATE-API-03)과 재조율(STATE-API-06) 공용 폼 (027)
// - 현재 값은 상태 조회의 settings. 바꾼 필드만 보내고, 날짜 범위는 바꿨을 때만 dateRange(R-26)
// - 설정 변경: 정원은 현재 값보다 작게, 마감은 현재 마감보다 이르게 고를 수 없다(R-27)
// - 재조율: 새 마감 필수, 나머지는 "설정도 바꾸기"를 펼쳤을 때만 보낸다
// - 화면 검증은 서버와 같은 순수 함수(lib/manage/settings-form.ts). 최종 판정은 서버가 한다

type Errors = Partial<Record<StartSettingsField, string>>;

export function SettingsPanel({
  mode,
  promiseId,
  promiseStatus,
  current,
  activeCount,
  onSaved,
  onBack,
  onAction,
}: {
  mode: FormMode;
  promiseId: string;
  promiseStatus: string;
  current: PromiseSettings;
  activeCount: number;
  onSaved: (message: string, promiseStatus: string) => void;
  onBack: () => void;
  onAction: (action: ManageAction) => void;
}) {
  const [today] = useState(() => seoulDateOf(new Date()));
  const [nowLocal] = useState(() => seoulLocalNow(new Date()));
  const [form, setForm] = useState<SettingsForm>(() => formFromSettings(current, mode));
  const [limitText, setLimitText] = useState(String(current.participantLimit));
  const [expanded, setExpanded] = useState(mode === "settings");
  const [dateNotice, setDateNotice] = useState<string | null>(null);
  const [durationNotice, setDurationNotice] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSettings = mode === "settings";
  const limitMin = isSettings
    ? current.participantLimit
    : Math.max(PARTICIPANT_LIMIT_MIN, activeCount);
  const deadlineMin = isSettings ? toLocalDeadline(current.votingDeadlineAt) : nowLocal;
  const deadlineEnd = expanded ? form.endDate : current.dateRange.endDate;
  const deadlineMax = deadlineEnd ? `${addDays(deadlineEnd, -1)}T23:59` : undefined;

  // 미리 보기는 입력이 바뀔 때마다 다시 계산한다(서버 range-change.ts와 같은 함수)
  const preview = useMemo(
    () => (expanded ? previewRangeChange(current, form, new Date()) : null),
    [current, form, expanded],
  );
  const shrinkBlocked =
    isSettings &&
    form.endDate !== null &&
    form.endDate !== current.dateRange.endDate &&
    isShrinkBlockedByDeadline(current, form.endDate);
  const noChange =
    isSettings &&
    Object.keys(
      buildSettingsBody(current, {
        ...form,
        participantLimit: clampParticipantLimit(Number(limitText || 0)),
      }),
    ).length === 0;

  function update(patch: Partial<SettingsForm>, field?: StartSettingsField) {
    setForm((prev) => ({ ...prev, ...patch }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setFormError(null);
  }

  function pickDate(date: string) {
    const result = selectDate({ start: form.startDate, end: form.endDate }, date, today);
    setDateNotice(result.notice);
    update({ startDate: result.range.start, endDate: result.range.end }, "dateRange");
  }

  function applyDailyRange(start: number, end: number) {
    const fitted = fitDuration(form.durationMinutes, start, end);
    setDurationNotice(fitted.shrunk);
    update(
      { startMinute: start, endMinute: end, durationMinutes: fitted.duration },
      "dailyTimeRange",
    );
  }

  function changeLimit(value: number) {
    const next = Math.max(limitMin, clampParticipantLimit(value));
    setLimitText(String(next));
    update({ participantLimit: next }, "participantLimit");
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    // 정원 칸에서 Enter로 바로 저장한 경우에도 입력값을 반영한다
    const participantLimit = Math.max(limitMin, clampParticipantLimit(Number(limitText || 0)));
    const values = { ...form, participantLimit };
    changeLimit(participantLimit);

    const problem = validateSettingsForm({
      mode,
      current,
      form: values,
      changeSettings: expanded,
      now: new Date(),
      activeCount,
    });
    if (problem) {
      if (problem.field) setErrors({ [problem.field]: problem.message });
      else setFormError(problem.message);
      return;
    }

    setPending(true);
    setFormError(null);
    const result = isSettings
      ? await callApi<{ promiseStatus: string; changeImpact: ReopenImpact }>(
          promisePath(promiseId, "/settings"),
          { method: "PATCH", body: buildSettingsBody(current, values) },
        )
      : await callApi<{ promiseStatus: string; changeImpact: ReopenImpact }>(
          promisePath(promiseId, "/reopen"),
          { method: "POST", body: buildReopenBody(current, values, expanded) },
        );
    setPending(false);
    if (result.ok) {
      const impact = result.data.changeImpact;
      onSaved(
        isSettings ? describeSettingsImpact(impact) : describeReopenImpact(impact),
        result.data.promiseStatus,
      );
      return;
    }

    const action = isSettings ? classifySettingsFailure(result) : classifyReopenFailure(result);
    if (action.kind === "field") {
      setErrors({ [action.field]: action.message });
      // 현재 값이 낡았을 수 있다(다른 기기에서 먼저 바꿈·새 참여자). 폼은 그대로 두고 값만 다시 조회한다
      if (action.refetch) onAction(action);
      return;
    }
    if (action.kind === "retry") {
      setFormError(action.message);
      return;
    }
    onAction(action);
  }

  const durationMax = form.endMinute - form.startMinute;

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">{isSettings ? "설정 변경" : "다시 열기(재조율)"}</h2>
        <p className="mt-1 text-sm text-sub">
          {isSettings
            ? "모집 중에는 정원을 늘리고 마감을 미룰 수 있어요. 날짜·시간 범위도 바꿀 수 있어요."
            : "새 응답 마감을 정하면 다시 모집을 시작해요. 참여자들이 시간을 다시 고를 수 있어요."}
        </p>
        {!isSettings && promiseStatus === "confirmed" && (
          <p role="note" className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
            확정된 일정이 해제돼요.
          </p>
        )}
      </div>

      <Section
        title={isSettings ? "응답 마감 (한국 시간)" : "새 응답 마감 (한국 시간, 필수)"}
        hint={isSettings ? "지금 마감보다 이르게 바꿀 수 없어요." : undefined}
      >
        <input
          type="datetime-local"
          aria-label={isSettings ? "응답 마감 (한국 시간)" : "새 응답 마감 (한국 시간)"}
          className={SELECT}
          value={form.deadline ?? ""}
          min={deadlineMin}
          max={deadlineMax}
          onChange={(e) => update({ deadline: e.target.value || null }, "votingDeadlineAt")}
        />
        <FieldError id="manage-votingDeadlineAt-error" message={errors.votingDeadlineAt} />
      </Section>

      {!isSettings && (
        <button
          type="button"
          aria-expanded={expanded}
          className="text-sm font-medium text-blue underline-offset-2 hover:underline"
          onClick={() => {
            setExpanded((v) => !v);
            setErrors({});
          }}
        >
          {expanded ? "설정은 그대로 두기" : "설정도 바꾸기"}
        </button>
      )}

      {expanded && (
        <>
          <Section
            title="날짜 범위"
            hint="첫 클릭 시작일, 두 번째 클릭 종료일 · 최대 오늘부터 3개월"
          >
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
              <ReadOnlyValue label="시작" value={form.startDate ?? "선택 전"} />
              <ReadOnlyValue label="종료" value={form.endDate ?? "선택 전"} />
            </div>
            <Calendar
              today={today}
              range={{ start: form.startDate, end: form.endDate }}
              onSelect={pickDate}
              invalid={!!errors.dateRange || shrinkBlocked}
            />
            {dateNotice && (
              <p role="status" className="mt-2 text-sm text-warn">
                {dateNotice}
              </p>
            )}
            {shrinkBlocked ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {SHRINK_BLOCKED_MESSAGE}
              </p>
            ) : (
              <FieldError id="manage-dateRange-error" message={errors.dateRange} />
            )}
          </Section>

          <Section title="하루 시간 범위">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <select
                aria-label="하루 시작 시각"
                className={SELECT}
                value={form.startMinute}
                onChange={(e) => {
                  const start = Number(e.target.value);
                  applyDailyRange(start, endAfterStartChange(start, form.endMinute));
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
                value={form.endMinute}
                onChange={(e) => applyDailyRange(form.startMinute, Number(e.target.value))}
              >
                {endTimeOptions(form.startMinute).map((m) => (
                  <option key={m} value={m}>
                    {minuteToTime(m)}
                  </option>
                ))}
              </select>
            </div>
            <FieldError id="manage-dailyTimeRange-error" message={errors.dailyTimeRange} />
          </Section>

          {preview && (preview.removesSlots || preview.requiresResubmit) && (
            <div
              role="status"
              className="space-y-1 rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn"
            >
              <p className="font-medium">저장하면 이렇게 바뀌어요</p>
              {preview.removesSlots && <p>· {RANGE_REMOVES_NOTICE}</p>}
              {preview.requiresResubmit && <p>· {RANGE_RESUBMIT_NOTICE}</p>}
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Section title="소요 시간">
              <Stepper
                label="소요 시간"
                value={formatDuration(form.durationMinutes)}
                onMinus={() =>
                  update(
                    {
                      durationMinutes: stepDuration(
                        form.durationMinutes,
                        -SLOT_MINUTES,
                        form.startMinute,
                        form.endMinute,
                      ),
                    },
                    "durationMinutes",
                  )
                }
                onPlus={() =>
                  update(
                    {
                      durationMinutes: stepDuration(
                        form.durationMinutes,
                        SLOT_MINUTES,
                        form.startMinute,
                        form.endMinute,
                      ),
                    },
                    "durationMinutes",
                  )
                }
                minusDisabled={form.durationMinutes <= SLOT_MINUTES}
                plusDisabled={form.durationMinutes >= durationMax}
              />
              {durationNotice && (
                <p role="status" className="mt-2 text-sm text-warn">
                  {DURATION_SHRUNK_NOTICE}
                </p>
              )}
              <FieldError id="manage-durationMinutes-error" message={errors.durationMinutes} />
            </Section>

            <Section
              title="정원 (방장 포함)"
              hint={
                isSettings
                  ? "모집 중에는 정원을 줄일 수 없어요."
                  : `현재 참여 인원(${activeCount}명)보다 적게 정할 수 없어요.`
              }
            >
              <Stepper
                label="정원"
                value={
                  <input
                    aria-label="정원 직접 입력"
                    inputMode="numeric"
                    className="h-full w-10 bg-transparent text-right outline-none"
                    value={limitText}
                    onChange={(e) => setLimitText(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    onBlur={() => changeLimit(Number(limitText || 0))}
                  />
                }
                suffix="명"
                onMinus={() => changeLimit(form.participantLimit - 1)}
                onPlus={() => changeLimit(form.participantLimit + 1)}
                minusDisabled={form.participantLimit <= limitMin}
                plusDisabled={form.participantLimit >= PARTICIPANT_LIMIT_MAX}
              />
              <FieldError id="manage-participantLimit-error" message={errors.participantLimit} />
            </Section>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={pending} onClick={onBack}>
          돌아가기
        </Button>
        <Button type="submit" disabled={pending || shrinkBlocked || noChange}>
          {pending ? "저장하는 중…" : isSettings ? "변경 저장" : "다시 열기"}
        </Button>
      </div>
      {noChange && <p className="text-sm text-sub">{NO_CHANGE_MESSAGE}</p>}
      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
    </form>
  );
}
