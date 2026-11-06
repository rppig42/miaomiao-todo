// 跟着 iCloud 走的设置。放在一个文档里，每个字段单独合并，两台设备改不同的设置都不会丢。
// 只属于这台 Mac 的（快捷键、外观这些）在 settings.go 里。

import { addDays, type Ymd } from "./dates.ts";
import type { Store } from "./store.ts";

const DOC_ID = "settings";

export interface Prefs {
  /** 每周开始于：0 周日、1 周一。 */
  weekStart: 0 | 1;
  /** 新任务进哪个清单。当前视图是某个清单时，以当前视图为准。 */
  defaultList: string;
  defaultDate: "none" | "today" | "tomorrow";
  /** 有具体时间的新任务提前多少分钟提醒，null 是不提醒。 */
  defaultRemind: number | null;
  /** 全天任务几点提醒。 */
  allDayAt: string;
  focusMinutes: number;
  breakMinutes: number;
}

export const DEFAULT_PREFS: Prefs = {
  weekStart: 0,
  defaultList: "inbox",
  defaultDate: "none",
  defaultRemind: 0,
  allDayAt: "09:00",
  focusMinutes: 25,
  breakMinutes: 5,
};

export function prefs(s: Store): Prefs {
  return { ...DEFAULT_PREFS, ...(s.get<Partial<Prefs>>(DOC_ID) ?? {}) };
}

export function setPrefs(s: Store, patch: Partial<Prefs>) {
  if (s.get(DOC_ID)) s.update(DOC_ID, patch);
  else s.create("settings", patch, DOC_ID);
}

/** 默认清单被删了就回到收件箱。 */
export function defaultListId(s: Store): string {
  const id = prefs(s).defaultList;
  const list = s.get<{ deleted?: boolean }>(id);
  return list && !list.deleted ? id : "inbox";
}

export function defaultDateOf(s: Store, today: Ymd): Ymd | null {
  const d = prefs(s).defaultDate;
  return d === "today" ? today : d === "tomorrow" ? addDays(today, 1) : null;
}

export function defaultRemindOf(s: Store): number[] {
  const m = prefs(s).defaultRemind;
  return m === null ? [] : [m];
}
