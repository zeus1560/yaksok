import { DATE_RANGE_MONTHS } from "@/lib/state/start-settings";
import { addCalendarMonths } from "@/lib/time/seoul";

// 설정 화면 날짜 범위 선택 (R-07, R-12, DECISION_CONFLICTS R-16). 날짜는 한국 날짜 YYYY-MM-DD 문자열
// 사전순 비교가 날짜 순서와 같으므로 문자열로 비교한다

export type DateRange = { start: string | null; end: string | null };

export const TODAY_ONLY_NOTICE =
  "오늘 하루짜리 약속은 마감을 정할 수 없어요. 내일까지 범위를 넓혀 주세요";

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 선택 가능한 마지막 날짜: 오늘부터 3개월(달력 월 단위, 없는 날이면 말일)
export function maxSelectableDate(today: string): string {
  return addCalendarMonths(today, DATE_RANGE_MONTHS);
}

// 달력에서 누를 수 있는 날짜 (오늘 ~ 상한). 종료일 제한(내일부터)은 selectDate가 안내로 처리한다
export function isSelectableDate(date: string, today: string): boolean {
  return date >= today && date <= maxSelectableDate(today);
}

// 종료일로 쓸 수 있는가: 시작일 이후이면서 내일부터 (마감은 마지막 날짜 00:00 이전이어야 하므로)
export function isSelectableEnd(date: string, start: string, today: string): boolean {
  return isSelectableDate(date, today) && date >= start && date > today;
}

export type SelectResult = { range: DateRange; notice: string | null };

// 첫 클릭 시작일, 두 번째 클릭 종료일. 범위가 완성된 뒤 다시 누르면 새 시작일로 본다
export function selectDate(range: DateRange, clicked: string, today: string): SelectResult {
  if (!isSelectableDate(clicked, today)) return { range, notice: null };

  if (range.start === null || range.end !== null || clicked < range.start) {
    return { range: { start: clicked, end: null }, notice: null };
  }
  if (!isSelectableEnd(clicked, range.start, today)) {
    // 시작일 이후인데 종료일로 못 쓰는 경우는 "오늘"뿐이다
    return { range, notice: TODAY_ONLY_NOTICE };
  }
  return { range: { start: range.start, end: clicked }, notice: null };
}

// 월 달력 칸 (일요일 시작, 빈칸은 null, 필요한 주만)
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d += 1) {
    cells.push(new Date(Date.UTC(year, month - 1, d)).toISOString().slice(0, 10));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
