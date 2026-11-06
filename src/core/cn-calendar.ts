// 农历和中国法定假期。
//
// 农历不用系统日历（Intl 的 chinese 历法）：它在新月接近午夜时会算错一天，
// 比如把 2027-02-06（春节）算成腊月三十，整个正月都差一天。这里用月份表，各平台结果一样。

import { addDays, daysBetween, toDate, weekday, type Ymd } from "./dates.ts";
import { HOLIDAY_DATA } from "./holidays-data.ts";

export interface Lunar {
  year: number;
  month: number;
  leap: boolean;
  day: number;
}

const FIRST_YEAR = 2024;
/** 甲辰年正月初一。 */
const FIRST_DAY = "2024-02-10";

// 每年一个数：低 4 位是闰几月（0 表示没有），第 4～15 位从高到低是 1～12 月（1 为 30 天，0 为 29 天），第 16 位是闰月大小。
const YEARS = [
  0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2024-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
];

/** 某个农历年的所有月份，按时间顺序。 */
function monthsOf(info: number): { month: number; leap: boolean; days: number }[] {
  const leapMonth = info & 0xf;
  const out: { month: number; leap: boolean; days: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ month: m, leap: false, days: info & (0x10000 >> m) ? 30 : 29 });
    if (m === leapMonth) out.push({ month: m, leap: true, days: info & 0x10000 ? 30 : 29 });
  }
  return out;
}

const yearLength = (info: number) => monthsOf(info).reduce((a, b) => a + b.days, 0);

/** 查表范围（2024～2049）之外用系统日历，够用但可能差一天。 */
function lunarFromSystem(s: Ymd): Lunar {
  const NAMES: Record<string, number> = { 正月: 1, 一月: 1, 二月: 2, 三月: 3, 四月: 4, 五月: 5, 六月: 6, 七月: 7, 八月: 8, 九月: 9, 十月: 10, 十一月: 11, 冬月: 11, 十二月: 12, 腊月: 12 };
  const parts = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric", year: "numeric" }).formatToParts(toDate(s));
  const name = parts.find((p) => p.type === "month")?.value ?? "正月";
  return {
    year: Number(parts.find((p) => (p.type as string) === "relatedYear")?.value ?? toDate(s).getFullYear()),
    month: NAMES[name.replace("闰", "")] ?? 1,
    leap: name.startsWith("闰"),
    day: Number(parts.find((p) => p.type === "day")?.value ?? 1),
  };
}

const lunarCache = new Map<Ymd, Lunar>();

export function lunarOf(s: Ymd): Lunar {
  const hit = lunarCache.get(s);
  if (hit) return hit;
  let left = daysBetween(FIRST_DAY, s);
  let result: Lunar | null = null;
  if (left >= 0) {
    for (let i = 0; i < YEARS.length && !result; i++) {
      const info = YEARS[i]!;
      const len = yearLength(info);
      if (left >= len) {
        left -= len;
        continue;
      }
      for (const m of monthsOf(info)) {
        if (left < m.days) {
          result = { year: FIRST_YEAR + i, month: m.month, leap: m.leap, day: left + 1 };
          break;
        }
        left -= m.days;
      }
    }
  }
  const out = result ?? lunarFromSystem(s);
  lunarCache.set(s, out);
  return out;
}

/** 农历日期对应的公历；这一年没有这个日子时返回 null。只支持查表范围内的年份。 */
export function solarOfLunar(year: number, month: number, day: number): Ymd | null {
  const index = year - FIRST_YEAR;
  if (index < 0 || index >= YEARS.length) return null;
  let d = FIRST_DAY;
  for (let i = 0; i < index; i++) d = addDays(d, yearLength(YEARS[i]!));
  for (const m of monthsOf(YEARS[index]!)) {
    if (m.month === month && !m.leap) return day <= m.days ? addDays(d, day - 1) : null;
    d = addDays(d, m.days);
  }
  return null;
}

/** 这个月的最后一天吗（下一天是初一）。三十只有大月才有，小月按月底算。 */
export function isLunarMonthEnd(s: Ymd): boolean {
  return lunarOf(addDays(s, 1)).day === 1;
}

const MONTH_NAMES = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
const DIGITS = "一二三四五六七八九";

export function lunarMonthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? "";
}

export function lunarDayName(day: number): string {
  if (day === 10) return "初十";
  if (day === 20) return "二十";
  if (day === 30) return "三十";
  const tens = ["初", "十", "廿"][Math.floor(day / 10)] ?? "";
  return tens + DIGITS[day % 10 - 1];
}

// ── 法定假期 ─────────────────────────────────────────

/** 清明在公历 4 月的哪一天，2000～2099 年的通用公式。 */
function qingmingDay(year: number): number {
  const y = year % 100;
  return Math.floor(y * 0.2422 + 4.81) - Math.floor(y / 4);
}

const statutoryCache = new Map<number, Set<Ymd>>();

/**
 * 国务院还没公布放假安排的年份，只能按《全国年节及纪念日放假办法》算法定的那几天：
 * 元旦 1 天、春节 4 天（除夕到初三）、清明 1 天、劳动节 2 天、端午 1 天、中秋 1 天、国庆 3 天。
 * 算不出调休，公布后更新 holidays-data.ts 就会用官方安排。
 */
function statutoryHolidays(year: number): Set<Ymd> {
  const hit = statutoryCache.get(year);
  if (hit) return hit;
  const pad = (n: number) => String(n).padStart(2, "0");
  const at = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`;
  const out = new Set<Ymd>([at(1, 1), at(4, qingmingDay(year)), at(5, 1), at(5, 2), at(10, 1), at(10, 2), at(10, 3)]);
  const spring = solarOfLunar(year, 1, 1);
  if (spring) for (let i = -1; i <= 2; i++) out.add(addDays(spring, i));
  for (const [m, d] of [[5, 5], [8, 15]] as const) {
    const day = solarOfLunar(year, m, d);
    if (day) out.add(day);
  }
  statutoryCache.set(year, out);
  return out;
}

const yearOf = (s: Ymd) => Number(s.slice(0, 4));

/** 放假的日子。公布过安排的年份按官方（含连休的周末），没公布的按法定天数。 */
export function isLegalHoliday(s: Ymd): boolean {
  const data = HOLIDAY_DATA[yearOf(s)];
  return data ? data.off.includes(s) : statutoryHolidays(yearOf(s)).has(s);
}

/** 要上班的日子：周一到周五去掉放假，再加上调休补班的周末。 */
export function isLegalWorkday(s: Ymd): boolean {
  const data = HOLIDAY_DATA[yearOf(s)];
  if (data?.work.includes(s)) return true;
  if (isLegalHoliday(s)) return false;
  const w = weekday(s);
  return w !== 0 && w !== 6;
}
