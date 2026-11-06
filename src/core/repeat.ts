// 重复规则：下一次是哪天、显示成什么，以及菜单里的预设。

import { isLegalHoliday, isLegalWorkday, isLunarMonthEnd, lunarDayName, lunarMonthName, lunarOf } from "./cn-calendar.ts";
import { addDays, addMonths, daysInMonth, toDate, WEEK, weekday, ymd, type Ymd } from "./dates.ts";

type Rule =
  | { freq: "daily"; every?: number }
  | { freq: "weekly"; every?: number; days: number[] }
  | { freq: "monthly"; every?: number; day: number }
  | { freq: "yearly"; every?: number }
  /** 周一至周五。 */
  | { freq: "weekdays" }
  /** 周六、周日。 */
  | { freq: "weekends" }
  /** 法定工作日：去掉放假，加上调休补班。 */
  | { freq: "workdays" }
  /** 法定节假日。 */
  | { freq: "holidays" }
  | { freq: "lunarMonthly"; day: number }
  | { freq: "lunarYearly"; month: number; day: number }
  /** 艾宾浩斯记忆法：从 start 起按固定间隔复习，step 是下一次用第几个间隔。 */
  | { freq: "ebbinghaus"; start: Ymd; step: number };

export type Repeat = Rule & {
  /** 从哪天算下一次。默认到期日期，done 是完成日期。 */
  from?: "done";
};

/** 第一次学习后的第几天复习。 */
export const EBBINGHAUS_DAYS = [1, 2, 4, 7, 15, 30];

const scan = (from: Ymd, limit: number, hit: (d: Ymd) => boolean): Ymd | null => {
  let d = from;
  for (let i = 0; i < limit; i++) {
    d = addDays(d, 1);
    if (hit(d)) return d;
  }
  return null;
};

const everyOf = (r: { every?: number }) => Math.max(1, r.every ?? 1);

function monthlyIn(day: number, y: number, m: number): Ymd {
  return ymd(new Date(y, m, Math.min(day, daysInMonth(y, m + 1))));
}

/** 下一次发生的日期，严格晚于 from。规则已经走完，或者算不出来时返回 null。 */
export function nextOccurrence(r: Repeat, from: Ymd): Ymd | null {
  switch (r.freq) {
    case "daily":
      return addDays(from, everyOf(r));
    case "weekdays":
      return scan(from, 7, (d) => weekday(d) !== 0 && weekday(d) !== 6);
    case "weekends":
      return scan(from, 7, (d) => weekday(d) === 0 || weekday(d) === 6);
    case "workdays":
      return scan(from, 60, isLegalWorkday);
    case "holidays":
      return scan(from, 400, isLegalHoliday);
    case "weekly": {
      // 按周一开始的一周算：这一周后面还有就用，没有就跳到 N 周后的第一天。
      const pos = (w: number) => (w + 6) % 7;
      const here = pos(weekday(from));
      const days = (r.days.length ? r.days : [weekday(from)]).map(pos).sort((a, b) => a - b);
      const monday = addDays(from, -here);
      const later = days.find((p) => p > here);
      return later !== undefined ? addDays(monday, later) : addDays(monday, everyOf(r) * 7 + days[0]!);
    }
    case "monthly": {
      const f = toDate(from);
      const same = monthlyIn(r.day, f.getFullYear(), f.getMonth());
      if (same > from) return same;
      const n = new Date(f.getFullYear(), f.getMonth() + everyOf(r), 1);
      return monthlyIn(r.day, n.getFullYear(), n.getMonth());
    }
    case "yearly":
      return addMonths(from, 12 * everyOf(r));
    case "lunarMonthly":
      return scan(from, 65, (d) => lunarMatches(d, r.day));
    case "lunarYearly":
      return scan(from, 420, (d) => {
        const l = lunarOf(d);
        return l.month === r.month && !l.leap && lunarMatches(d, r.day);
      });
    case "ebbinghaus": {
      for (const n of EBBINGHAUS_DAYS) {
        const d = addDays(r.start, n);
        if (d > from) return d;
      }
      return null;
    }
  }
}

/** 这一天是不是农历的 N 日。小月没有三十，算在月底。 */
function lunarMatches(d: Ymd, day: number): boolean {
  const l = lunarOf(d);
  return l.day === day || (day === 30 && l.day === 29 && isLunarMonthEnd(d));
}

/** 从 start 开始第一次符合规则的日期，可以是 start 本身。 */
export function firstOccurrence(r: Repeat, start: Ymd): Ymd {
  switch (r.freq) {
    case "daily":
    case "yearly":
      return start;
    case "ebbinghaus":
      return r.start;
    case "weekly":
      return r.days.includes(weekday(start)) || !r.days.length ? start : (nextOccurrence(r, start) ?? start);
    case "monthly": {
      const f = toDate(start);
      return monthlyIn(r.day, f.getFullYear(), f.getMonth()) === start ? start : (nextOccurrence(r, start) ?? start);
    }
    default:
      return nextOccurrence(r, addDays(start, -1)) ?? start;
  }
}

/**
 * 完成一次之后，任务滚到哪一天。走完了（比如艾宾浩斯最后一次）返回 null。
 * 已经过期的任务不会把错过的那几次一一补回来，直接跳到今天或之后。
 */
export function advanceRepeat(r: Repeat, due: Ymd, doneOn: Ymd): { date: Ymd; repeat: Repeat } | null {
  if (r.freq === "ebbinghaus") {
    for (let step = r.step; step < EBBINGHAUS_DAYS.length; step++) {
      const d = addDays(r.start, EBBINGHAUS_DAYS[step]!);
      if (d > due && d >= doneOn) return { date: d, repeat: { ...r, step: step + 1 } };
    }
    return null;
  }
  let d = nextOccurrence(r, r.from === "done" ? doneOn : due);
  for (let i = 0; d && d < doneOn && i < 2000; i++) d = nextOccurrence(r, d);
  return d ? { date: d, repeat: r } : null;
}

function baseLabel(r: Repeat): string {
  const every = "every" in r ? everyOf(r) : 1;
  const prefix = (unit: string) => (every > 1 ? `每 ${every} ${unit}` : `每${unit === "个月" ? "月" : unit}`);
  switch (r.freq) {
    case "daily":
      return prefix("天");
    case "weekly":
      return `${prefix("周")}${r.days.length ? (every > 1 ? "的周" : "") + [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEK[d]).join("、") : ""}`;
    case "monthly":
      return `${prefix("个月")}${every > 1 ? "的 " : " "}${r.day} 日`;
    case "yearly":
      return prefix("年");
    case "weekdays":
      return "周一至周五";
    case "weekends":
      return "周末";
    case "workdays":
      return "法定工作日";
    case "holidays":
      return "法定节假日";
    case "lunarMonthly":
      return `农历每月${lunarDayName(r.day)}`;
    case "lunarYearly":
      return `农历每年${lunarMonthName(r.month)}${lunarDayName(r.day)}`;
    case "ebbinghaus":
      return "艾宾浩斯记忆法";
  }
}

export function repeatLabel(r: Repeat): string {
  return r.from === "done" ? `${baseLabel(r)}（按完成日期）` : baseLabel(r);
}

/** 字段顺序不影响比较。 */
export function sameRepeat(a: Repeat | null, b: Repeat | null): boolean {
  if (!a || !b) return a === b;
  const norm = (r: Repeat) => {
    const v = r as Record<string, unknown>;
    return JSON.stringify(Object.keys(v).filter((k) => v[k] !== undefined && !(k === "every" && v[k] === 1)).sort().map((k) => [k, k === "days" ? [...(v[k] as number[])].sort() : v[k]]));
  };
  // 艾宾浩斯走到哪一步都算同一种规则。
  if (a.freq === "ebbinghaus" && b.freq === "ebbinghaus") return true;
  return norm(a) === norm(b);
}

export interface RepeatPresets {
  daily: Repeat;
  weekly: Repeat;
  monthly: Repeat;
  yearly: Repeat;
  weekdays: Repeat;
  workdays: Repeat;
  weekends: Repeat;
  holidays: Repeat;
  lunarMonthly: Repeat;
  lunarYearly: Repeat;
  ebbinghaus: Repeat;
}

/** 菜单里的预设，都从任务当前的日期推出来。 */
export function repeatPresets(base: Ymd): RepeatPresets {
  const l = lunarOf(base);
  return {
    daily: { freq: "daily" },
    weekly: { freq: "weekly", days: [weekday(base)] },
    monthly: { freq: "monthly", day: toDate(base).getDate() },
    yearly: { freq: "yearly" },
    weekdays: { freq: "weekdays" },
    workdays: { freq: "workdays" },
    weekends: { freq: "weekends" },
    holidays: { freq: "holidays" },
    lunarMonthly: { freq: "lunarMonthly", day: l.day },
    lunarYearly: { freq: "lunarYearly", month: l.month, day: l.day },
    ebbinghaus: { freq: "ebbinghaus", start: base, step: 0 },
  };
}
