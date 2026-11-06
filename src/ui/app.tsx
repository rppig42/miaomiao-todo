import { useEffect, useRef, useState } from "preact/hooks";
import { COLORS, counts, allTags, lists, type Habit, type List, type Task } from "../core/model.ts";
import { dropZone, Menu, Popover } from "./common.tsx";
import { Detail } from "./detail.tsx";
import { FocusLog, FocusView } from "./focus.tsx";
import { Icon } from "./icons.tsx";
import { SettingsView } from "./settings.tsx";
import { go, openPop, platform, refresh, runToastUndo, sameView, select, store, subscribeUI, toggleDone, trash, ui, undoLast, type View } from "./state.ts";
import { CalendarView, HabitDetail, HabitsView, ListView, MatrixView, selectable, TrashView, viewTitle } from "./views.tsx";
import { addDays } from "../core/dates.ts";

export function SmartItem({ view, icon, label, count, drop }: { view: View; icon: string; label: string; count?: number; drop?: (id: string) => void }) {
  const on = sameView(ui.view, view);
  return (
    <a class={`l ${on ? "on" : ""}`} onClick={() => go(view)} {...(drop ? dropZone(drop) : {})}>
      <Icon n={icon} />
      {label}
      {count ? <em>{count}</em> : null}
    </a>
  );
}

export function listContextMenu(l: List) {
  const s = store();
  return (
    <Menu
      items={[
        { label: "编辑清单", icon: "edit", onClick: () => { ui.listEdit = { id: l.id, name: l.name, color: l.color }; refresh(); } },
        {
          label: "删除清单",
          icon: "trash",
          danger: true,
          onClick: async () => {
            const inside = s.all<Task>("task").filter((t) => t.listId === l.id && !t.done);
            const ok = !inside.length || (await platform().confirm(`删除清单“${l.name}”？`, `里面的 ${inside.length} 个任务会移到收件箱。`, "删除"));
            if (!ok) return;
            for (const t of s.all<Task>("task")) if (t.listId === l.id) s.update(t.id, { listId: "inbox" });
            s.remove(l.id);
            if (ui.view.k === "list" && ui.view.id === l.id) go({ k: "inbox" });
          },
        },
      ]}
    />
  );
}

export function SyncBadge() {
  const y = ui.sync;
  if (!y.enabled) return null;
  const map: Record<string, { icon: string; text: string; cls?: string }> = {
    idle: { icon: "cloud", text: "" },
    syncing: { icon: "sync", text: "", cls: "spin" },
    offline: { icon: "cloudOff", text: "离线" },
    noAccount: { icon: "cloudOff", text: "未登录 iCloud" },
    error: { icon: "cloudBad", text: "同步失败", cls: "bad" },
    off: { icon: "cloudOff", text: "" },
  };
  const m = map[y.state] ?? map.idle!;
  const title = y.message ?? (y.state === "idle" ? "已同步" : y.state === "syncing" ? "同步中" : m.text);
  return (
    <button class={`sync ${m.cls ?? ""}`} title={title} onClick={() => platform().cloudFetch()}>
      <Icon n={m.icon} />
      {m.text ? <span>{m.text}</span> : null}
    </button>
  );
}

function Sidebar() {
  const s = store();
  const today = ui.today;
  const c = counts(s, today);
  const tags = allTags(s);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ui.focusSearch) searchRef.current?.focus();
  }, [ui.focusSearch]);
  const views: { v: View; icon: string; label: string }[] = [
    { v: { k: "calendar" }, icon: "cal", label: "日历" },
    { v: { k: "matrix" }, icon: "matrix", label: "四象限" },
    { v: { k: "focus" }, icon: "timer", label: "专注" },
    { v: { k: "habits" }, icon: "habit", label: "习惯" },
  ];
  return (
    <aside class="side">
      <div class="side-top" />
      <div class={`sr ${ui.view.k === "search" ? "on" : ""}`}>
        <Icon n="search" />
        <input
          ref={searchRef}
          placeholder="搜索"
          spellcheck={false}
          value={ui.query}
          onInput={(e) => {
            ui.query = (e.currentTarget as HTMLInputElement).value;
            if (ui.view.k !== "search") go({ k: "search" });
            refresh();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              ui.query = "";
              (e.currentTarget as HTMLInputElement).blur();
              go({ k: "today" });
            }
          }}
        />
      </div>
      <div class="side-scroll">
        <SmartItem view={{ k: "today" }} icon="sun" label="今天" count={c.today} drop={(id) => s.update(id, { date: today })} />
        <SmartItem view={{ k: "tomorrow" }} icon="rise" label="明天" count={c.tomorrow} drop={(id) => s.update(id, { date: addDays(today, 1) })} />
        <SmartItem view={{ k: "week" }} icon="week" label="最近 7 天" count={c.week} />
        <SmartItem view={{ k: "inbox" }} icon="inbox" label="收件箱" count={c.inbox} drop={(id) => s.update(id, { listId: "inbox" })} />
        <div class="vw">
          {views.map((x) => (
            <a key={x.v.k} class={ui.view.k === x.v.k ? "on" : ""} onClick={() => go(x.v)}>
              <Icon n={x.icon} />
              {x.label}
            </a>
          ))}
        </div>
        <h6>清单<button aria-label="新建清单" onClick={() => { ui.listEdit = { id: null, name: "", color: COLORS[Math.floor(Math.random() * COLORS.length)]! }; refresh(); }}><Icon n="plus" /></button></h6>
        {lists(s).map((l) => (
          <a
            key={l.id}
            class={`l ${ui.view.k === "list" && ui.view.id === l.id ? "on" : ""}`}
            onClick={() => go({ k: "list", id: l.id })}
            onContextMenu={(e) => { e.preventDefault(); openPop(e, () => listContextMenu(l), 170, true); }}
            {...dropZone((id) => s.update(id, { listId: l.id }))}
          >
            <i class="ldot" style={{ background: l.color }} />
            {l.name}
            {c.byList[l.id] ? <em>{c.byList[l.id]}</em> : null}
          </a>
        ))}
        {tags.length ? <h6>标签</h6> : null}
        {tags.map((t) => (
          <a key={t.name} class={`l ${ui.view.k === "tag" && ui.view.name === t.name ? "on" : ""}`} onClick={() => go({ k: "tag", name: t.name })}>
            <Icon n="tag" />
            {t.name}
            <em>{t.count}</em>
          </a>
        ))}
      </div>
      <div class="side-foot">
        <button class={`fb ${ui.view.k === "completed" ? "on" : ""}`} title="已完成" onClick={() => go({ k: "completed" })}><Icon n="doneAll" /></button>
        <button class={`fb ${ui.view.k === "trash" ? "on" : ""}`} title="垃圾桶" onClick={() => go({ k: "trash" })}><Icon n="trash" /></button>
        <button class={`fb ${ui.view.k === "settings" ? "on" : ""}`} title="设置" data-settings onClick={() => go({ k: "settings" })}><Icon n="gear" /></button>
        <SyncBadge />
      </div>
    </aside>
  );
}

export function ListEditor() {
  const e = ui.listEdit;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [!!e]);
  if (!e) return null;
  const s = store();
  const save = () => {
    const name = (ref.current?.value ?? "").trim();
    if (!name) return;
    if (e.id) s.update(e.id, { name, color: e.color });
    else {
      const order = Math.max(0, ...lists(s).map((l) => l.order)) + 1;
      const id = s.create("list", { name, color: e.color, order });
      go({ k: "list", id });
    }
    ui.listEdit = null;
    refresh();
  };
  return (
    <div class="scrim" onClick={(ev) => { if (ev.target === ev.currentTarget) { ui.listEdit = null; refresh(); } }}>
      <div class="sheet">
        <input
          ref={ref}
          class="sheet-in"
          defaultValue={e.name}
          placeholder="清单名称"
          spellcheck={false}
          onKeyDown={(ev) => {
            if (ev.isComposing) return;
            if (ev.key === "Enter") save();
            if (ev.key === "Escape") { ui.listEdit = null; refresh(); }
          }}
        />
        <div class="swatches">
          {COLORS.map((c) => (
            <button key={c} class={c === e.color ? "on" : ""} style={{ background: c }} aria-label={c} onClick={() => { e.color = c; refresh(); }} />
          ))}
        </div>
        <div class="sheet-a">
          <button class="ghost" onClick={() => { ui.listEdit = null; refresh(); }}>取消</button>
          <button class="go" onClick={save}>{e.id ? "保存" : "新建"}</button>
        </div>
      </div>
    </div>
  );
}

export function sortMenu() {
  const opt = (v: typeof ui.sort, label: string) => ({ label, checked: ui.sort === v, onClick: () => { ui.sort = v; refresh(); } });
  return <Menu items={[opt("time", "按时间"), opt("priority", "按优先级"), opt("title", "按标题")]} />;
}

function Main() {
  const s = store();
  const v = ui.view;
  const sel = ui.selected ? s.get<Task>(ui.selected) : null;
  const liveSel = sel && !sel.deleted ? sel : null;
  if (v.k === "calendar") return <div class="pane"><CalendarView /></div>;
  if (v.k === "matrix") {
    return (
      <div class="pane row">
        <div class="main"><div class="mh"><h1>四象限</h1></div><MatrixView /></div>
        {liveSel ? <Detail t={liveSel} onClose={() => select(null)} /> : null}
      </div>
    );
  }
  if (v.k === "focus") {
    return (
      <div class="pane row">
        <div class="main"><div class="mh"><h1>专注</h1></div><FocusView /></div>
        <FocusLog />
      </div>
    );
  }
  if (v.k === "habits") {
    const h = ui.habit ? s.get<Habit>(ui.habit) : null;
    return (
      <div class="pane row">
        <div class="main"><div class="mh"><h1>习惯</h1></div><HabitsView /></div>
        {h && !h.deleted ? <HabitDetail h={h} /> : <div class="detail blank" />}
      </div>
    );
  }
  if (v.k === "settings") {
    return (
      <div class="pane">
        <div class="mh"><h1>设置</h1></div>
        <SettingsView />
      </div>
    );
  }
  const head = viewTitle(v);
  return (
    <div class="pane row">
      <div class="main">
        <div class="mh">
          <h1>{head.title}{head.sub ? <small>{head.sub}</small> : null}</h1>
          {v.k === "trash" || v.k === "completed" || v.k === "search" ? null : (
            <button class="gb" aria-label="排序" onClick={(e) => openPop(e, sortMenu, 140)}><Icon n="sort" /></button>
          )}
        </div>
        {v.k === "trash" ? <TrashView /> : <ListView />}
      </div>
      {liveSel ? <Detail t={liveSel} /> : <div class="detail blank" />}
    </div>
  );
}

function moveSelection(delta: number) {
  const ids = selectable(ui.view);
  if (!ids.length) return;
  const i = ui.selected ? ids.indexOf(ui.selected) : -1;
  const next = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? (delta > 0 ? 0 : ids.length - 1) : i + delta))]!;
  select(next);
  queueMicrotask(() => document.querySelector(`[data-id="${next}"]`)?.scrollIntoView({ block: "nearest" }));
}

export function handleCommand(cmd: string) {
  if (cmd.startsWith("open:")) {
    go({ k: "today" });
    select(cmd.slice(5));
    return;
  }
  switch (cmd) {
    case "add":
      if (platform().kind === "ios") {
        ui.adding = true;
        refresh();
        break;
      }
      if (["calendar", "matrix", "focus", "habits", "completed", "trash", "search", "settings"].includes(ui.view.k)) go({ k: "today" });
      ui.focusAdd++;
      refresh();
      break;
    case "newList":
      ui.listEdit = { id: null, name: "", color: COLORS[0]! };
      refresh();
      break;
    case "search":
      ui.focusSearch++;
      refresh();
      break;
    case "undo": {
      const el = document.activeElement;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) document.execCommand("undo");
      else undoLast();
      break;
    }
    case "today":
    case "tomorrow":
    case "week":
    case "inbox":
    case "calendar":
    case "matrix":
    case "focus":
    case "habits":
    case "settings":
      go({ k: cmd } as View);
      break;
  }
}

export function App() {
  const [, force] = useState(0);
  useEffect(() => subscribeUI(() => force((n) => n + 1)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = store();
      const sel = ui.selected ? s.get<Task>(ui.selected) : null;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Escape") {
        select(null);
      } else if (sel && e.key === " ") {
        e.preventDefault();
        toggleDone(sel);
      } else if (sel && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        trash(sel);
      } else if (sel && e.key === "Enter") {
        e.preventDefault();
        ui.focusTitle++;
        refresh();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div class="win">
      <Sidebar />
      <Main />
      <Popover />
      <ListEditor />
      {ui.toast ? (
        <div class="toast">
          <span>{ui.toast.text}</span>
          {ui.toast.undo ? <button onClick={runToastUndo}>撤销</button> : null}
        </div>
      ) : null}
    </div>
  );
}
