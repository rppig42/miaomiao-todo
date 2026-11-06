// 日期一律用本地时区的 "YYYY-MM-DD" 字符串，时间用 "HH:mm"。字符串可以直接比较大小，也不会跨时区漂移。

export type Ymd = string;

export const WEEK = "日一二三四五六";

export function ymd(d: Date): Ymd {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function toDate(s: Ymd): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(s: Ymd, n: number): Ymd {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function weekday(s: Ymd): number {
  return toDate(s).getDay();
}

export function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** 周一作为一周的第一天。 */
export function startOfWeek(s: Ymd): Ymd {
  return addDays(s, -((weekday(s) + 6) % 7));
}

/** 一周七天的顺序，比如周一开始是 1 2 3 4 5 6 0。 */
export function weekOrder(weekStart: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/** 月历上要显示的所有日子，前后用相邻月份补满整周。 */
export function monthCells(month: string, weekStart = 0): Ymd[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = ymd(new Date(y, m - 1, 1));
  const lead = (weekday(first) - weekStart + 7) % 7;
  const total = Math.ceil((lead + daysInMonth(y, m)) / 7) * 7;
  return Array.from({ length: total }, (_, i) => addDays(first, i - lead));
}

/** 同一天月份加减，目标月没有这一天时取月底。 */
export function addMonths(s: Ymd, n: number): Ymd {
  const d = toDate(s);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  target.setDate(Math.min(day, daysInMonth(target.getFullYear(), target.getMonth() + 1)));
  return ymd(target);
}

export function monthDay(s: Ymd): string {
  const d = toDate(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 列表里给人看的日期：今天、明天、周五，再远就写月日，跨年带年份。 */
export function dateLabel(s: Ymd, today: Ymd): string {
  const n = daysBetween(today, s);
  if (n === 0) return "今天";
  if (n === 1) return "明天";
  if (n === 2) return "后天";
  if (n === -1) return "昨天";
  if (n > 2 && n < 7) return `周${WEEK[weekday(s)]}`;
  const d = toDate(s);
  if (d.getFullYear() !== toDate(today).getFullYear()) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return monthDay(s);
}

export function minutesOf(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
}

export function hm(minutes: number): string {
  const v = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

export function nowHm(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 手输的时间：9、14、930、1430、14:30。空字符串返回 null，看不懂返回 undefined。 */
export function parseClock(s: string): string | null | undefined {
  const v = s.trim().replace("：", ":");
  if (!v) return null;
  const m = v.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return undefined;
  return hm(h * 60 + min);
}

/** 本地时间的时间戳，提醒用。 */
export function at(s: Ymd, time: string): number {
  const d = toDate(s);
  d.setHours(minutesOf(time) / 60 | 0, minutesOf(time) % 60, 0, 0);
  return d.getTime();
}
