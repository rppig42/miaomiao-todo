// 界面状态。数据在 Store 里，这里只放“现在看的是哪儿、选中了什么”这类东西。

import type { ComponentChildren } from "preact";
import { addDays, ymd, type Ymd } from "../core/dates.ts";
import { complete, INBOX, type SortBy, type Task, uncomplete } from "../core/model.ts";
import type { Store } from "../core/store.ts";
import type { DeviceSettings, Platform } from "../platform/types.ts";

export type View =
  | { k: "today" }
  | { k: "tomorrow" }
  | { k: "week" }
  | { k: "inbox" }
  | { k: "list"; id: string }
  | { k: "tag"; name: string }
  | { k: "calendar" }
  | { k: "matrix" }
  | { k: "focus" }
  | { k: "habits" }
  | { k: "completed" }
  | { k: "trash" }
  | { k: "search" }
  | { k: "settings" };

export interface SyncState {
  enabled: boolean;
  state: "off" | "idle" | "syncing" | "offline" | "noAccount" | "error";
  message?: string;
  environment?: string;
  /** 还没确认上传成功的条数。 */
  pending?: number;
}

export interface Pop {
  x: number;
  y: number;
  width?: number;
  /** 里面有飞出的子菜单，不能裁剪。 */
  bare?: boolean;
  content: () => ComponentChildren;
}

export interface Toast {
  text: string;
  undo?: () => void;
}

export const ui = {
  view: { k: "today" } as View,
  selected: null as string | null,
  sort: "time" as SortBy,
  query: "",
  today: ymd(new Date()),
  calMonth: ymd(new Date()).slice(0, 7),
  calDay: ymd(new Date()),
  habit: null as string | null,
  sync: { enabled: false, state: "off" } as SyncState,
  /** 启动时从平台读。 */
  device: {} as DeviceSettings,
  pop: null as Pop | null,
  /** 从弹层里再打开的一层，比如日期面板上的重复菜单。 */
  pop2: null as Pop | null,
  toast: null as Toast | null,
  listEdit: null as { id: string | null; name: string; color: string } | null,
  /** 手机：清单抽屉和新建任务面板开着。 */
  drawer: false,
  adding: false,
  /** 让快捷添加框获得焦点。 */
  focusAdd: 0,
  focusSearch: 0,
  focusTitle: 0,
};

let store_: Store;
let platform_: Platform;

export function bindApp(s: Store, p: Platform) {
  store_ = s;
  platform_ = p;
}

export const store = () => store_;
export const platform = () => platform_;

const listeners = new Set<() => void>();
let scheduled = false;

export function subscribeUI(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function refresh() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const fn of listeners) fn();
  });
}

export function go(view: View) {
  ui.view = view;
  ui.selected = null;
  ui.pop = null;
  ui.pop2 = null;
  ui.drawer = false;
  refresh();
}

export function select(id: string | null) {
  ui.selected = id;
  refresh();
}

export function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 在当前视图里添加任务时带上的默认值。 */
export function viewDefaults(): Partial<Task> {
  const v = ui.view;
  switch (v.k) {
    case "today":
      return { date: ui.today };
    case "tomorrow":
      return { date: addDays(ui.today, 1) };
    case "week":
      return { date: ui.today };
    case "list":
      return { listId: v.id };
    case "tag":
      return { tags: [v.name] };
    case "calendar":
      return { date: ui.calDay };
    case "inbox":
      return { listId: INBOX };
    default:
      return {};
  }
}

// ── 撤销 ─────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;
const undoStack: (() => void)[] = [];

export function toast(text: string, undo?: () => void) {
  ui.toast = { text, undo };
  if (undo) {
    undoStack.push(undo);
    if (undoStack.length > 30) undoStack.shift();
  }
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast = null;
    refresh();
  }, 5000);
  refresh();
}

export function undoLast() {
  const fn = undoStack.pop();
  if (fn) fn();
  ui.toast = null;
  refresh();
}

export function runToastUndo() {
  const t = ui.toast;
  if (t?.undo) {
    const i = undoStack.lastIndexOf(t.undo);
    if (i >= 0) undoStack.splice(i, 1);
    t.undo();
  }
  ui.toast = null;
  refresh();
}

export function toggleDone(t: Task) {
  const s = store();
  if (t.done) {
    uncomplete(s, t.id);
    return;
  }
  const before = { date: t.date, done: t.done, doneAt: t.doneAt, repeat: t.repeat };
  const known = new Set(s.docs.keys());
  complete(s, t.id);
  toast(`已完成“${t.title}”`, () => {
    s.update(t.id, before);
    // 重复任务完成时多出来的那条记录也要收回。
    for (const id of s.docs.keys()) if (!known.has(id)) s.remove(id);
  });
}

export function trash(t: Task) {
  const s = store();
  s.remove(t.id);
  if (ui.selected === t.id) ui.selected = null;
  toast(`已删除“${t.title}”`, () => s.restore(t.id));
}

// ── 弹出层 ───────────────────────────────────────────

type PopEvent = { clientX?: number; clientY?: number; currentTarget?: EventTarget | null };

function place(e: PopEvent, atPointer: boolean) {
  let x = e.clientX ?? 0;
  let y = e.clientY ?? 0;
  const el = e.currentTarget as HTMLElement | null;
  if (!atPointer && el?.getBoundingClientRect) {
    const r = el.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 6;
  }
  return { x, y };
}

export function openPop(e: PopEvent, content: () => ComponentChildren, width = 220, atPointer = false, bare = false) {
  ui.pop = { ...place(e, atPointer), width, content, bare };
  ui.pop2 = null;
  refresh();
}

export function openPop2(e: PopEvent, content: () => ComponentChildren, width = 220, bare = false) {
  ui.pop2 = { ...place(e, false), width, content, bare };
  refresh();
}

export function closePop() {
  if (!ui.pop && !ui.pop2) return;
  ui.pop = null;
  ui.pop2 = null;
  refresh();
}

/** 只关最上面一层。 */
export function closeTop() {
  if (ui.pop2) ui.pop2 = null;
  else ui.pop = null;
  refresh();
}

/** 把最上面一层换成别的内容，位置不变。 */
export function replaceTop(content: () => ComponentChildren, width: number) {
  const top = ui.pop2 ? "pop2" : "pop";
  const cur = ui[top];
  if (cur) ui[top] = { ...cur, width, content, bare: false };
  refresh();
}

export type { Ymd };
