// 业务规则：任务、清单、习惯、专注记录，以及各个视图要看的内容。

import { addDays, at, daysBetween, minutesOf, startOfWeek, ymd, type Ymd } from "./dates.ts";
import { advanceRepeat, firstOccurrence, type Repeat } from "./repeat.ts";
import { parseNL, type Parsed } from "./nl.ts";
import { defaultDateOf, defaultListId, defaultRemindOf, prefs } from "./settings.ts";
import type { Store } from "./store.ts";

export const INBOX = "inbox";

export interface Task {
  id: string;
  title: string;
  notes: string;
  listId: string;
  tags: string[];
  /** 0 无、1 低、2 中、3 高。 */
  priority: number;
  date: Ymd | null;
  time: string | null;
  endTime: string | null;
  repeat: Repeat | null;
  /** 提前多少分钟提醒；空表示不提醒。 */
  remind: number[];
  done: boolean;
  doneAt: number | null;
  pomoEst: number;
  createdAt: number;
  deleted?: boolean;
  deletedAt?: number | null;
}

export interface Sub {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  order: number;
  deleted?: boolean;
}

export interface List {
  id: string;
  name: string;
  color: string;
  order: number;
  deleted?: boolean;
}

export interface Habit {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  deleted?: boolean;
}

export interface HabitLog {
  id: string;
  habitId: string;
  date: Ymd;
  done: boolean;
}

export interface Focus {
  id: string;
  taskId: string | null;
  title: string;
  date: Ymd;
  startedAt: number;
  minutes: number;
}

export const COLORS = ["#2F6BFF", "#17A673", "#F09A1A", "#E5484D", "#8E5BEF", "#0FA5B8", "#E0559A", "#7A8291"];

export function seedDefaults(s: Store) {
  s.seed("list", "list-work", { name: "工作", color: COLORS[0], order: 1 });
  s.seed("list", "list-life", { name: "生活", color: COLORS[1], order: 2 });
}

export function lists(s: Store): List[] {
  return s.all<List>("list").sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}

export function listName(s: Store, id: string): string {
  if (id === INBOX) return "收件箱";
  return s.get<List>(id)?.name ?? "收件箱";
}

export function tasks(s: Store): Task[] {
  return s.all<Task>("task");
}

export function subs(s: Store, taskId: string): Sub[] {
  return s.all<Sub>("sub").filter((x) => x.taskId === taskId).sort((a, b) => a.order - b.order);
}

export function allTags(s: Store): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of tasks(s)) if (!t.done) for (const n of t.tags ?? []) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

export function newTask(s: Store, fields: Partial<Task> & { title: string }): string {
  const t: Omit<Task, "id"> = {
    notes: "",
    listId: INBOX,
    tags: [],
    priority: 0,
    date: null,
    time: null,
    endTime: null,
    repeat: null,
    remind: fields.time ? defaultRemindOf(s) : [],
    done: false,
    doneAt: null,
    pomoEst: 0,
    createdAt: Date.now(),
    ...fields,
  };
  return s.create("task", t as unknown as Record<string, unknown>);
}

/**
 * 快捷添加。defaults 是当前视图带来的默认值：在「明天」里加的就是明天，在某清单里加的就进那个清单。
 * 当前视图没说的才用设置里的默认值；date: null 表示明确不要日期，比如四象限的“不紧急”。
 */
export function addFromText(s: Store, text: string, today: Ymd, defaults: Partial<Task> = {}, ignored: string[] = [], now?: Date): { id: string; parsed: Parsed } | null {
  const names = lists(s).map((l) => l.name);
  const parsed = parseNL(text, { today, now, lists: names, ignored });
  if (!parsed.title) return null;
  const listId = parsed.list ? (lists(s).find((l) => l.name === parsed.list)?.id ?? INBOX) : (defaults.listId ?? defaultListId(s));
  const fallback = defaults.date !== undefined ? defaults.date : defaultDateOf(s, today);
  // 只写了时间时，按钟点推的日期只对“今天”有意义；视图或设置给的是别的哪天，就用那天。
  const date = parsed.dateGuessed && fallback && fallback !== today ? fallback : (parsed.date ?? fallback);
  const tags = [...new Set([...(defaults.tags ?? []), ...parsed.tags])];
  const id = newTask(s, {
    ...defaults,
    title: parsed.title,
    listId,
    date,
    time: parsed.time,
    endTime: parsed.endTime,
    repeat: parsed.repeat,
    priority: parsed.priority || defaults.priority || 0,
    tags,
    remind: parsed.time ? defaultRemindOf(s) : [],
  });
  return { id, parsed };
}

/**
 * 完成一条任务。重复任务留一份已完成记录，原任务滚到下一次，检查项重新开始。
 * 规则走完了（比如艾宾浩斯最后一次复习）就正常完成，不再重复。
 */
export function complete(s: Store, id: string, now = Date.now()) {
  const t = s.get<Task>(id);
  if (!t) return;
  if (t.repeat && t.date) {
    const next = advanceRepeat(t.repeat, t.date, ymd(new Date(now)));
    if (next) {
      const { id: _id, ...rest } = t;
      s.create("task", { ...rest, repeat: null, done: true, doneAt: now, remind: [] });
      s.update(id, { date: next.date, repeat: next.repeat });
      for (const x of subs(s, id)) if (x.done) s.update(x.id, { done: false });
      return;
    }
    s.update(id, { done: true, doneAt: now, repeat: null });
    return;
  }
  s.update(id, { done: true, doneAt: now });
}

export function uncomplete(s: Store, id: string) {
  s.update(id, { done: false, doneAt: null });
}

export function setRepeat(s: Store, id: string, r: Repeat | null, today: Ymd) {
  const t = s.get<Task>(id);
  if (!t) return;
  // 日期不符合新规则时挪到第一次符合的那天，比如周四的任务改成每周六。
  s.update(id, { repeat: r, date: r ? firstOccurrence(r, t.date ?? today) : t.date });
}

export function setTime(s: Store, id: string, time: string | null, endTime: string | null = null) {
  const t = s.get<Task>(id);
  if (!t) return;
  const remind = time ? (t.remind?.length ? t.remind : defaultRemindOf(s)) : [];
  s.update(id, { time, endTime: time ? endTime : null, remind });
}

export function addSub(s: Store, taskId: string, title: string): string {
  const order = Math.max(0, ...subs(s, taskId).map((x) => x.order)) + 1;
  return s.create("sub", { taskId, title, done: false, order });
}

// ── 视图 ─────────────────────────────────────────────

export type SortBy = "time" | "priority" | "title";

export interface Group {
  key: string;
  label: string;
  tone?: "overdue" | "done";
  tasks: Task[];
}

export function sorter(by: SortBy) {
  return (a: Task, b: Task) => {
    if (by === "title") return a.title.localeCompare(b.title, "zh");
    if (by === "priority" && a.priority !== b.priority) return b.priority - a.priority;
    // 有具体时间的排前面，全天任务按优先级排后面。
    const ta = a.time ?? "99:99";
    const tb = b.time ?? "99:99";
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.createdAt - b.createdAt;
  };
}

const byDoneAt = (a: Task, b: Task) => (b.doneAt ?? 0) - (a.doneAt ?? 0);

export function isOverdue(t: Task, today: Ymd): boolean {
  return !t.done && t.date !== null && t.date < today;
}

export function todayTasks(s: Store, today: Ymd): Task[] {
  return tasks(s).filter((t) => !t.done && t.date !== null && t.date <= today);
}

export function counts(s: Store, today: Ymd) {
  const all = tasks(s).filter((t) => !t.done);
  const tomorrow = addDays(today, 1);
  const week = addDays(today, 6);
  const byList: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  for (const t of all) {
    byList[t.listId] = (byList[t.listId] ?? 0) + 1;
    for (const n of t.tags ?? []) byTag[n] = (byTag[n] ?? 0) + 1;
  }
  return {
    today: all.filter((t) => t.date !== null && t.date <= today).length,
    tomorrow: all.filter((t) => t.date === tomorrow).length,
    week: all.filter((t) => t.date !== null && t.date <= week).length,
    inbox: all.filter((t) => t.listId === INBOX).length,
    byList,
    byTag,
  };
}

function doneGroup(ts: Task[]): Group[] {
  const done = ts.filter((t) => t.done).sort(byDoneAt);
  return done.length ? [{ key: "done", label: "已完成", tone: "done", tasks: done }] : [];
}

export function todayGroups(s: Store, today: Ymd, by: SortBy = "time"): Group[] {
  const ts = tasks(s);
  const overdue = ts.filter((t) => !t.done && t.date !== null && t.date < today).sort(sorter(by));
  const now = ts.filter((t) => !t.done && t.date === today).sort(sorter(by));
  const out: Group[] = [];
  if (overdue.length) out.push({ key: "overdue", label: "已过期", tone: "overdue", tasks: overdue });
  if (now.length) out.push({ key: "today", label: "今天", tasks: now });
  return [...out, ...doneGroup(ts.filter((t) => t.date === today))];
}

export function dayGroups(s: Store, day: Ymd, by: SortBy = "time"): Group[] {
  const ts = tasks(s).filter((t) => t.date === day);
  const open = ts.filter((t) => !t.done).sort(sorter(by));
  return [...(open.length ? [{ key: day, label: "", tasks: open }] : []), ...doneGroup(ts)];
}

export function weekGroups(s: Store, today: Ymd, by: SortBy, label: (d: Ymd) => string): Group[] {
  const ts = tasks(s).filter((t) => !t.done);
  const out: Group[] = [];
  const overdue = ts.filter((t) => t.date !== null && t.date < today).sort(sorter(by));
  if (overdue.length) out.push({ key: "overdue", label: "已过期", tone: "overdue", tasks: overdue });
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const day = ts.filter((t) => t.date === d).sort(sorter(by));
    if (day.length) out.push({ key: d, label: label(d), tasks: day });
  }
  return out;
}

/** 普通清单、收件箱、标签的分组：过期、今天、明天、之后、无日期。 */
export function bucketGroups(ts: Task[], today: Ymd, by: SortBy): Group[] {
  const open = ts.filter((t) => !t.done);
  const tomorrow = addDays(today, 1);
  const pick = (key: string, label: string, f: (t: Task) => boolean, tone?: Group["tone"]): Group[] => {
    const v = open.filter(f).sort(sorter(by));
    return v.length ? [{ key, label, tone, tasks: v }] : [];
  };
  return [
    ...pick("overdue", "已过期", (t) => t.date !== null && t.date < today, "overdue"),
    ...pick("today", "今天", (t) => t.date === today),
    ...pick("tomorrow", "明天", (t) => t.date === tomorrow),
    ...pick("later", "之后", (t) => t.date !== null && t.date > tomorrow),
    ...pick("none", "无日期", (t) => t.date === null),
    ...doneGroup(ts),
  ];
}

export function search(s: Store, q: string): Task[] {
  const k = q.trim().toLowerCase();
  if (!k) return [];
  const list = new Map(lists(s).map((l) => [l.id, l.name.toLowerCase()]));
  return tasks(s)
    .filter((t) => t.title.toLowerCase().includes(k) || (t.notes ?? "").toLowerCase().includes(k) || (t.tags ?? []).some((n) => n.toLowerCase().includes(k)) || (list.get(t.listId) ?? "").includes(k))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

// ── 四象限 ───────────────────────────────────────────

export type Quadrant = 1 | 2 | 3 | 4;

/** 重要看优先级（中、高），紧急看日期（今天或已过期）。 */
export function quadrantOf(t: Task, today: Ymd): Quadrant {
  const important = t.priority >= 2;
  const urgent = t.date !== null && t.date <= today;
  if (important) return urgent ? 1 : 2;
  return urgent ? 3 : 4;
}

export function matrix(s: Store, today: Ymd): Record<Quadrant, Task[]> {
  const out: Record<Quadrant, Task[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const t of tasks(s)) if (!t.done) out[quadrantOf(t, today)].push(t);
  for (const q of [1, 2, 3, 4] as Quadrant[]) out[q].sort(sorter("priority"));
  return out;
}

/** 拖到某个象限：只改必须改的字段。 */
export function moveToQuadrant(s: Store, id: string, q: Quadrant, today: Ymd) {
  const t = s.get<Task>(id);
  if (!t) return;
  const wantImportant = q === 1 || q === 2;
  const wantUrgent = q === 1 || q === 3;
  const patch: Partial<Task> = {};
  if (wantImportant && t.priority < 2) patch.priority = 3;
  if (!wantImportant && t.priority >= 2) patch.priority = 1;
  const urgent = t.date !== null && t.date <= today;
  if (wantUrgent && !urgent) patch.date = today;
  if (!wantUrgent && urgent) patch.date = addDays(today, 1);
  s.update(id, patch);
}

// ── 日历 ─────────────────────────────────────────────

export function tasksByDay(s: Store, from: Ymd, to: Ymd): Map<Ymd, Task[]> {
  const m = new Map<Ymd, Task[]>();
  for (const t of tasks(s)) {
    if (!t.date || t.date < from || t.date > to) continue;
    (m.get(t.date) ?? m.set(t.date, []).get(t.date)!).push(t);
  }
  for (const v of m.values()) v.sort((a, b) => Number(a.done) - Number(b.done) || sorter("time")(a, b));
  return m;
}

// ── 提醒 ─────────────────────────────────────────────

export interface Reminder {
  id: string;
  title: string;
  body: string;
  at: number;
}

/** 接下来要响的提醒。全天任务的提醒按设置里的时间算，默认当天早上 9 点。 */
export function reminders(s: Store, now: number, horizonDays = 2): Reminder[] {
  const end = now + horizonDays * 86400000;
  const out: Reminder[] = [];
  const allDayAt = prefs(s).allDayAt;
  for (const t of tasks(s)) {
    if (t.done || !t.date || !t.remind?.length) continue;
    const base = at(t.date, t.time ?? allDayAt);
    for (const m of t.remind) {
      const when = base - m * 60000;
      if (when > now && when <= end) {
        out.push({ id: `${t.id}/${m}`, title: t.title, body: t.time ? (m ? `${m} 分钟后开始` : `${t.time} 开始`) : "今天要做", at: when });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ── 习惯 ─────────────────────────────────────────────

export function habits(s: Store): Habit[] {
  return s.all<Habit>("habit").sort((a, b) => a.order - b.order);
}

const logId = (habitId: string, date: Ymd) => `hlog-${habitId}-${date}`;

export function habitDone(s: Store, habitId: string, date: Ymd): boolean {
  return !!s.get<HabitLog>(logId(habitId, date))?.done;
}

/** 日志的 id 由习惯和日期决定，两台设备同一天打卡只会有一条。 */
export function toggleHabit(s: Store, habitId: string, date: Ymd) {
  const id = logId(habitId, date);
  const log = s.get<HabitLog>(id);
  if (log) s.update(id, { done: !log.done });
  else s.create("hlog", { habitId, date, done: true }, id);
}

/** 连续天数。今天还没打不算断，从昨天接着数。 */
export function streak(s: Store, habitId: string, today: Ymd): number {
  let d = habitDone(s, habitId, today) ? today : addDays(today, -1);
  let n = 0;
  while (habitDone(s, habitId, d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function habitTotal(s: Store, habitId: string): number {
  return s.all<HabitLog>("hlog").filter((l) => l.habitId === habitId && l.done).length;
}

export function weekDays(today: Ymd): Ymd[] {
  const mon = startOfWeek(today);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

// ── 专注 ─────────────────────────────────────────────

export function logFocus(s: Store, taskId: string | null, title: string, date: Ymd, startedAt: number, minutes: number): string {
  return s.create("focus", { taskId, title, date, startedAt, minutes });
}

export function focusOn(s: Store, date: Ymd): Focus[] {
  return s.all<Focus>("focus").filter((f) => f.date === date).sort((a, b) => b.startedAt - a.startedAt);
}

export function pomoCount(s: Store, taskId: string): number {
  return s.all<Focus>("focus").filter((f) => f.taskId === taskId).length;
}

export function durationMinutes(t: Task): number {
  if (t.time && t.endTime) {
    const d = minutesOf(t.endTime) - minutesOf(t.time);
    return d > 0 ? d : 30;
  }
  return 30;
}

export function overdueDays(t: Task, today: Ymd): number {
  return t.date ? daysBetween(t.date, today) : 0;
}
