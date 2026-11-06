// 小组件进程用的规则入口。打成一个文件（ios/Shared/widget-core.js），在 JavaScriptCore 里运行：
// 这样在小组件上勾选重复任务时，下一次是哪天和 App 里算得完全一样，不用在 Swift 里再写一遍。
// 入参和返回值都是 JSON 字符串。见 ios/Shared/WidgetCore.swift。

import { monthDay, WEEK, weekday, type Ymd } from "./dates.ts";
import { complete, lists, sorter, tasks } from "./model.ts";
import { Store, type RemoteItem } from "./store.ts";

export interface WidgetTask {
  id: string;
  title: string;
  time: string | null;
  priority: number;
  overdue: boolean;
  repeat: boolean;
  /** 所在清单的颜色，收件箱没有。 */
  color: string | null;
}

export interface WidgetData {
  today: Ymd;
  /** 比如“11月5日 周四”。 */
  label: string;
  /** 今天要做的总数，包括已过期的。 */
  count: number;
  tasks: WidgetTask[];
}

function open(json: string | null): Store {
  const s = new Store({ save() {}, push() {} });
  s.load(json);
  return s;
}

export function widgetData(s: Store, today: Ymd, limit = 12): WidgetData {
  const colors = new Map(lists(s).map((l) => [l.id, l.color]));
  const due = tasks(s).filter((t) => !t.done && t.date !== null && t.date <= today);
  const overdue = due.filter((t) => t.date! < today).sort(sorter("time"));
  const now = due.filter((t) => t.date === today).sort(sorter("time"));
  return {
    today,
    label: `${monthDay(today)} 周${WEEK[weekday(today)]}`,
    count: due.length,
    tasks: [...overdue, ...now].slice(0, limit).map((t) => ({
      id: t.id,
      title: t.title,
      time: t.time,
      priority: t.priority,
      overdue: t.date! < today,
      repeat: !!t.repeat,
      color: colors.get(t.listId) ?? null,
    })),
  };
}

export const api = {
  data(state: string | null, today: Ymd): string {
    return JSON.stringify(widgetData(open(state), today));
  },
  /** 完成一条任务，返回新的状态和要传给云端的文档。 */
  complete(state: string | null, id: string, now: number): string {
    const s = open(state);
    const known = new Set(s.docs.keys());
    const stamps = new Map([...s.docs].map(([k, d]) => [k, JSON.stringify(d.t)]));
    complete(s, id, now);
    const changed: RemoteItem[] = [];
    for (const [k, d] of s.docs) {
      if (!known.has(k) || stamps.get(k) !== JSON.stringify(d.t)) changed.push({ id: k, kind: d.kind, payload: JSON.stringify({ f: d.f, t: d.t }) });
    }
    return JSON.stringify({ state: s.serialize(), changed });
  },
  /** 把云端的文档合并进本地状态。 */
  absorb(state: string | null, items: string): string {
    const s = open(state);
    s.applyRemote(JSON.parse(items) as RemoteItem[]);
    return s.serialize();
  },
  /** 合并同一条文档的两个版本，上传遇到别的设备先改时用。 */
  merge(a: string, b: string): string {
    const s = open(null);
    s.applyRemote([{ id: "x", kind: "task", payload: a }, { id: "x", kind: "task", payload: b }]);
    const d = s.docs.get("x")!;
    return JSON.stringify({ f: d.f, t: d.t });
  },
};
