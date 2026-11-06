// 自然语言快捷添加。把一句话拆成标题、日期、时间、重复、优先级、清单和标签。
// 返回每个识别片段的位置，输入框靠它高亮；片段被用户取消时放进 ignored，就当普通文字。

import { addDays, addMonths, daysInMonth, hm, minutesOf, nowHm, toDate, weekday, ymd, type Ymd } from "./dates.ts";
import { firstOccurrence, type Repeat } from "./repeat.ts";

export type TokenKind = "date" | "time" | "repeat" | "priority" | "list" | "tag";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
}

export interface Parsed {
  title: string;
  date: Ymd | null;
  /** 文字里只有时间、日期是按现在几点推出来的。 */
  dateGuessed: boolean;
  time: string | null;
  endTime: string | null;
  repeat: Repeat | null;
  priority: number;
  list: string | null;
  tags: string[];
  tokens: Token[];
}

const CN: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const NUM = "[0-9]{1,2}|[一二两三四五六七八九十]{1,3}";

/** 3、十二、二十五、三十。 */
export function num(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  const ten = s.indexOf("十");
  if (ten < 0) return CN[s[0]!] ?? NaN;
  const tens = ten === 0 ? 1 : (CN[s[0]!] ?? NaN);
  const ones = ten === s.length - 1 ? 0 : (CN[s[ten + 1]!] ?? NaN);
  return tens * 10 + ones;
}

const WD = (c: string) => (c === "天" || c === "日" ? 0 : "一二三四五六".indexOf(c) + 1);
const PERIOD = "早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|凌晨";
const PERIOD_DEFAULT: Record<string, string> = { 早上: "09:00", 早晨: "09:00", 清晨: "07:00", 上午: "09:00", 中午: "12:00", 下午: "15:00", 傍晚: "18:00", 晚上: "20:00", 夜里: "22:00", 凌晨: "06:00" };

const CLOCK = `(?:${NUM})(?:点半|点钟|点一刻|点三刻|点(?:${NUM})分?|点|时)|[0-9]{1,2}:[0-9]{2}`;
const TIME = `(?:${PERIOD})?\\s?(?:${CLOCK})`;

const RULES: { kind: TokenKind; re: string }[] = [
  { kind: "repeat", re: `每隔(?:${NUM})天|每(?:${NUM})天|每个?工作日|工作日|每天|每日|每(?:周|星期|礼拜)[一二三四五六日天](?:[、,，和][一二三四五六日天])*|每(?:周|星期|礼拜)|每个?月(?:${NUM})[号日]|每个?月|每年` },
  { kind: "date", re: `大后天|今天|今日|明天|明日|后天|今晚|今早|明早|明晚|下下?(?:周|星期|礼拜)[一二三四五六日天]|(?:这|本)?(?:周|星期|礼拜)[一二三四五六日天]|下周末|周末|下周|下个?月(?:${NUM})[号日]|(?:${NUM})月(?:${NUM})[日号]?|(?:${NUM})[号]|(?:${NUM}|半)(?:个)?(?:天|周|星期|个月|小时|钟头|分钟)后` },
  { kind: "time", re: `${TIME}(?:\\s?(?:-|–|—|~|到|至)\\s?${TIME})?|(?:${PERIOD})` },
  { kind: "priority", re: `[!！]{1,3}(?:高|中|低)?` },
  { kind: "tag", re: `[#＃][^\\s#＃!！]+` },
];

const MATCHER = new RegExp(RULES.map((r) => `(${r.re})`).join("|"), "g");

function clockToHm(raw: string, inheritPeriod = ""): { hm: string; period: string } | null {
  const s = raw.replace(/\s/g, "");
  const pm = s.match(new RegExp(`^(${PERIOD})`));
  const period = pm ? pm[1]! : inheritPeriod;
  const body = pm ? s.slice(pm[1]!.length) : s;
  let h: number;
  let m = 0;
  const colon = body.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else {
    const c = body.match(new RegExp(`^(${NUM})(?:点|时)(半|钟|一刻|三刻|(?:${NUM})分?)?$`));
    if (!c) return null;
    h = num(c[1]!);
    const tail = c[2];
    if (tail === "半") m = 30;
    else if (tail === "一刻") m = 15;
    else if (tail === "三刻") m = 45;
    else if (tail && tail !== "钟") m = num(tail.replace("分", ""));
  }
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 24 || m > 59) return null;
  if (/下午|傍晚|晚上|夜里/.test(period) && h < 12) h += 12;
  if (period === "中午" && h < 3) h += 12;
  if (h === 24) h = 0;
  return { hm: hm(h * 60 + m), period };
}

/** 没写日子的 N 号：这个月还没过就这个月，否则下个月。 */
function nextDayOfMonth(day: number, today: Ymd): Ymd {
  const t = toDate(today);
  const here = new Date(t.getFullYear(), t.getMonth(), Math.min(day, daysInMonth(t.getFullYear(), t.getMonth() + 1)));
  if (ymd(here) >= today) return ymd(here);
  const n = new Date(t.getFullYear(), t.getMonth() + 1, 1);
  return ymd(new Date(n.getFullYear(), n.getMonth(), Math.min(day, daysInMonth(n.getFullYear(), n.getMonth() + 1))));
}

function nextWeekday(day: number, today: Ymd, week: number): Ymd {
  // 周X 指本周一到周日里的那一天；已经过去就是下周的。下周X 是下周一开始那一周的。
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const offset = (day + 6) % 7;
  const d = addDays(monday, offset + 7 * week);
  if (week === 0 && d < today) return addDays(d, 7);
  return d;
}

interface DateResult {
  date: Ymd;
  period?: string;
  time?: string;
}

function parseDate(s: string, today: Ymd, now: Date): DateResult | null {
  switch (s) {
    case "今天":
    case "今日":
      return { date: today };
    case "明天":
    case "明日":
      return { date: addDays(today, 1) };
    case "后天":
      return { date: addDays(today, 2) };
    case "大后天":
      return { date: addDays(today, 3) };
    case "今早":
      return { date: today, period: "早上" };
    case "今晚":
      return { date: today, period: "晚上" };
    case "明早":
      return { date: addDays(today, 1), period: "早上" };
    case "明晚":
      return { date: addDays(today, 1), period: "晚上" };
    case "周末":
      return { date: nextWeekday(6, today, 0) };
    case "下周末":
      return { date: nextWeekday(6, today, 1) };
    case "下周":
      return { date: nextWeekday(1, today, 1) };
  }
  let m = s.match(/^(下下?)?(这|本)?(?:周|星期|礼拜)([一二三四五六日天])$/);
  if (m) return { date: nextWeekday(WD(m[3]!), today, m[1] === "下下" ? 2 : m[1] ? 1 : 0) };
  m = s.match(new RegExp(`^下个?月(${NUM})[号日]$`));
  if (m) {
    const n = toDate(addMonths(today.slice(0, 8) + "01", 1));
    const day = Math.min(num(m[1]!), daysInMonth(n.getFullYear(), n.getMonth() + 1));
    return { date: ymd(new Date(n.getFullYear(), n.getMonth(), day)) };
  }
  m = s.match(new RegExp(`^(${NUM})月(${NUM})[日号]?$`));
  if (m) {
    const mo = num(m[1]!);
    const da = num(m[2]!);
    if (mo < 1 || mo > 12 || da < 1 || da > daysInMonth(toDate(today).getFullYear(), mo)) return null;
    const y = toDate(today).getFullYear();
    const d = ymd(new Date(y, mo - 1, da));
    return { date: d < today ? ymd(new Date(y + 1, mo - 1, da)) : d };
  }
  m = s.match(new RegExp(`^(${NUM})号$`));
  if (m) {
    const da = num(m[1]!);
    return da >= 1 && da <= 31 ? { date: nextDayOfMonth(da, today) } : null;
  }
  m = s.match(new RegExp(`^(${NUM}|半)(?:个)?(天|周|星期|个月|小时|钟头|分钟)后$`));
  if (m) {
    const half = m[1] === "半";
    const n = half ? 0.5 : num(m[1]!);
    const unit = m[2]!;
    if (unit === "天") return half ? null : { date: addDays(today, n) };
    if (unit === "周" || unit === "星期") return half ? null : { date: addDays(today, n * 7) };
    if (unit === "个月") return half ? null : { date: addMonths(today, n) };
    const mins = unit === "分钟" ? n : n * 60;
    if (mins >= 7 * 24 * 60) return null;
    const when = new Date(now.getTime() + mins * 60000);
    return { date: ymd(when), time: nowHm(when) };
  }
  return null;
}

function parseRepeat(s: string, today: Ymd): Repeat | null {
  if (/^每个?工作日$|^工作日$/.test(s)) return { freq: "weekdays" };
  if (s === "每天" || s === "每日") return { freq: "daily" };
  if (s === "每年") return { freq: "yearly" };
  let m = s.match(new RegExp(`^每隔?(${NUM})天$`));
  if (m) return { freq: "daily", every: num(m[1]!) };
  m = s.match(/^每(?:周|星期|礼拜)(.*)$/);
  if (m) {
    const days = [...m[1]!].filter((c) => /[一二三四五六日天]/.test(c)).map(WD);
    return { freq: "weekly", days: days.length ? [...new Set(days)] : [weekday(today)] };
  }
  m = s.match(new RegExp(`^每个?月(?:(${NUM})[号日])?$`));
  if (m) return { freq: "monthly", day: m[1] ? num(m[1]) : toDate(today).getDate() };
  return null;
}

export function parseNL(input: string, opts: { today: Ymd; now?: Date; lists?: string[]; ignored?: string[] }): Parsed {
  const now = opts.now ?? new Date();
  const today = opts.today;
  const lists = opts.lists ?? [];
  const ignored = new Set(opts.ignored ?? []);
  const out: Parsed = { title: "", date: null, dateGuessed: false, time: null, endTime: null, repeat: null, priority: 0, list: null, tags: [], tokens: [] };
  let period = "";
  let periodTime = "";

  MATCHER.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = MATCHER.exec(input)); ) {
    const text = m[0];
    if (!text) {
      MATCHER.lastIndex++;
      continue;
    }
    if (ignored.has(text)) continue;
    const kindIndex = RULES.findIndex((_, i) => m![i + 1] !== undefined);
    const kind = RULES[kindIndex]!.kind;
    const push = (k: TokenKind) => out.tokens.push({ kind: k, start: m!.index, end: m!.index + text.length, text });

    if (kind === "repeat") {
      if (out.repeat) continue;
      const r = parseRepeat(text, today);
      if (r) {
        out.repeat = r;
        push("repeat");
      }
    } else if (kind === "date") {
      if (out.date) continue;
      const d = parseDate(text, today, now);
      if (d) {
        out.date = d.date;
        if (d.time) out.time = d.time;
        if (d.period) {
          period = d.period;
          periodTime = PERIOD_DEFAULT[d.period]!;
        }
        push("date");
      }
    } else if (kind === "time") {
      if (out.time) continue;
      if (new RegExp(`^(${PERIOD})$`).test(text)) {
        period = text;
        periodTime = PERIOD_DEFAULT[text]!;
        push("time");
        continue;
      }
      const parts = text.split(/\s?(?:-|–|—|~|到|至)\s?/);
      const start = clockToHm(parts[0]!, period);
      if (!start) continue;
      out.time = start.hm;
      if (parts[1]) {
        const end = clockToHm(parts[1], start.period);
        if (end) {
          // 下午2点到4点、14:00-16:00：结束早于开始时再按下午算一次。
          const fixed = minutesOf(end.hm) <= minutesOf(start.hm) && minutesOf(end.hm) + 720 > minutesOf(start.hm) ? hm(minutesOf(end.hm) + 720) : end.hm;
          out.endTime = fixed;
        }
      }
      periodTime = "";
      push("time");
    } else if (kind === "priority") {
      if (out.priority) continue;
      const word = text.replace(/[!！]/g, "");
      const bangs = text.length - word.length;
      out.priority = word === "高" ? 3 : word === "中" ? 2 : word === "低" ? 1 : bangs;
      push("priority");
    } else if (kind === "tag") {
      const name = text.slice(1);
      const hit = lists.find((l) => l.toLowerCase() === name.toLowerCase());
      if (hit && !out.list) {
        out.list = hit;
        push("list");
      } else if (!out.tags.includes(name)) {
        out.tags.push(name);
        push("tag");
      }
    }
  }

  if (!out.time && periodTime) out.time = periodTime;
  // 只写了时间：今天还没过就是今天，过了就是明天。
  if (out.time && !out.date) {
    out.date = out.time > nowHm(now) ? today : addDays(today, 1);
    out.dateGuessed = true;
  }
  // 只写了重复：从今天起第一次符合规则的那天开始。
  if (out.repeat && !out.date) out.date = firstOccurrence(out.repeat, today);

  let title = "";
  let last = 0;
  for (const t of out.tokens) {
    title += input.slice(last, t.start) + " ";
    last = t.end;
  }
  title += input.slice(last);
  out.title = title.replace(/\s+/g, " ").replace(/^[\s,，、;；]+|[\s,，、;；]+$/g, "").trim();
  return out;
}
