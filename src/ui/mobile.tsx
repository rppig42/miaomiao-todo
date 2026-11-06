import { useEffect, useRef, useState } from "preact/hooks";
import { addMonths, monthCells, toDate, WEEK, weekOrder } from "../core/dates.ts";
import { COLORS, counts, allTags, habits, lists, tasksByDay, type Habit, type List, type Task } from "../core/model.ts";
import { prefs } from "../core/settings.ts";
import { listContextMenu, ListEditor, SmartItem, sortMenu, SyncBadge } from "./app.tsx";
import { Popover, QuickAdd, taskMenu } from "./common.tsx";
import { Detail } from "./detail.tsx";
import { FocusView } from "./focus.tsx";
import { Icon } from "./icons.tsx";
import { SettingsView } from "./settings.tsx";
import { go, openPop, refresh, runToastUndo, select, store, subscribeUI, ui, type View } from "./state.ts";
import { Agenda, HabitDetail, HabitsView, ListView, MatrixView, TrashView, viewTitle } from "./views.tsx";

const TABS: { k: "today" | "calendar" | "matrix" | "focus"; icon: string; label: string }[] = [
  { k: "today", icon: "sun", label: "今天" },
  { k: "calendar", icon: "cal", label: "日历" },
  { k: "matrix", icon: "matrix", label: "四象限" },
  { k: "focus", icon: "timer", label: "专注" },
];

const NO_ADD: View["k"][] = ["focus", "habits", "settings", "trash", "completed"];

function Head({ title, sub, sort }: { title: string; sub?: string; sort?: boolean }) {
  return (
    <div class="m-h">
      <h1>{title}{sub ? <small>{sub}</small> : null}</h1>
      {sort ? <button class="gb" aria-label="排序" onClick={(e) => openPop(e, sortMenu, 180)}><Icon n="sort" /></button> : null}
      <button class="gb" aria-label="清单" data-drawer onClick={() => { ui.drawer = true; refresh(); }}><Icon n="list" /></button>
    </div>
  );
}

function SearchHead() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div class="m-h m-search">
      <div class="sr on">
        <Icon n="search" />
        <input
          ref={ref}
          placeholder="搜索"
          spellcheck={false}
          value={ui.query}
          onInput={(e) => {
            ui.query = (e.currentTarget as HTMLInputElement).value;
            refresh();
          }}
        />
      </div>
      <button class="lnk" onClick={() => { ui.query = ""; go({ k: "today" }); }}>取消</button>
    </div>
  );
}

function MobileCalendar() {
  const s = store();
  const today = ui.today;
  const month = ui.calMonth;
  const weekStart = prefs(s).weekStart;
  const cells = monthCells(month, weekStart);
  const map = tasksByDay(s, cells[0]!, cells[cells.length - 1]!);
  const [y, m] = month.split("-").map(Number);
  const shift = (n: number) => {
    ui.calMonth = addMonths(`${month}-01`, n).slice(0, 7);
    refresh();
  };
  return (
    <div class="m-cal">
      <div class="m-h">
        <h1>{y !== toDate(today).getFullYear() ? `${y} 年 ` : ""}{m} 月</h1>
        <button class="gb" aria-label="上个月" onClick={() => shift(-1)}><Icon n="left" /></button>
        <button class="gb" aria-label="下个月" onClick={() => shift(1)}><Icon n="right" /></button>
        <button class="gb wide" onClick={() => { ui.calMonth = today.slice(0, 7); ui.calDay = today; refresh(); }}>今天</button>
      </div>
      <div class="m-wk">{weekOrder(weekStart).map((i) => <span key={i}>{WEEK[i]}</span>)}</div>
      <div class="m-mo">
        {cells.map((d) => {
          const list = (map.get(d) ?? []).filter((t) => !t.done);
          return (
            <button
              key={d}
              data-day={d}
              class={`${d.slice(0, 7) !== month ? "out" : ""} ${d === today ? "today" : ""} ${d === ui.calDay ? "on" : ""}`}
              onClick={() => { ui.calDay = d; ui.selected = null; refresh(); }}
            >
              <b>{toDate(d).getDate()}</b>
              <i>{list.slice(0, 3).map((t) => <u key={t.id} class={`p${t.priority}`} />)}</i>
            </button>
          );
        })}
      </div>
      <Agenda day={ui.calDay} />
    </div>
  );
}

function Screen() {
  const v = ui.view;
  switch (v.k) {
    case "calendar":
      return <MobileCalendar />;
    case "matrix":
      return <><Head title="四象限" /><MatrixView /></>;
    case "focus":
      return <><Head title="专注" /><FocusView /></>;
    case "habits":
      return <><Head title="习惯" /><HabitsView /></>;
    case "settings":
      return <><Head title="设置" /><SettingsView /></>;
    case "trash":
      return <><Head title="垃圾桶" /><TrashView /></>;
    case "search":
      return <><SearchHead /><ListView /></>;
    default: {
      const head = viewTitle(v);
      return <><Head title={head.title} sub={head.sub} sort={v.k !== "completed"} /><ListView /></>;
    }
  }
}

function Drawer() {
  const s = store();
  const today = ui.today;
  const c = counts(s, today);
  const tags = allTags(s);
  const close = () => { ui.drawer = false; refresh(); };
  return (
    <div class="m-scrim m-left" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside class="m-drawer">
        <button class="sr" onClick={() => go({ k: "search" })}><Icon n="search" />搜索</button>
        <div class="m-drawer-in">
          <SmartItem view={{ k: "today" }} icon="sun" label="今天" count={c.today} />
          <SmartItem view={{ k: "tomorrow" }} icon="rise" label="明天" count={c.tomorrow} />
          <SmartItem view={{ k: "week" }} icon="week" label="最近 7 天" count={c.week} />
          <SmartItem view={{ k: "inbox" }} icon="inbox" label="收件箱" count={c.inbox} />
          <SmartItem view={{ k: "habits" }} icon="habit" label="习惯" count={habits(s).length} />
          <h6>清单<button aria-label="新建清单" onClick={() => { ui.listEdit = { id: null, name: "", color: COLORS[Math.floor(Math.random() * COLORS.length)]! }; ui.drawer = false; refresh(); }}><Icon n="plus" /></button></h6>
          {lists(s).map((l: List) => (
            <a key={l.id} class={`l ${ui.view.k === "list" && ui.view.id === l.id ? "on" : ""}`} data-list={l.id} onClick={() => go({ k: "list", id: l.id })}>
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
          <button class="fb" aria-label="已完成" onClick={() => go({ k: "completed" })}><Icon n="doneAll" /></button>
          <button class="fb" aria-label="垃圾桶" onClick={() => go({ k: "trash" })}><Icon n="trash" /></button>
          <button class="fb" aria-label="设置" data-settings onClick={() => go({ k: "settings" })}><Icon n="gear" /></button>
          <SyncBadge />
        </div>
      </aside>
    </div>
  );
}

const TOKENS = [
  { label: "今天", text: "今天" },
  { label: "明天", text: "明天" },
  { label: "后天", text: "后天" },
  { label: "高", text: "!高", kind: "priority" },
  { label: "中", text: "!中", kind: "priority" },
  { label: "低", text: "!低", kind: "priority" },
];

/** 新建任务：底部面板，跟着键盘走。下面的小标签把文字填进输入框，和手打的效果一样。 */
function AddSheet() {
  const s = store();
  const ref = useRef<HTMLDivElement>(null);
  const [focusKey] = useState(() => Date.now());
  const textarea = () => ref.current?.querySelector("textarea") as HTMLTextAreaElement | null;
  const close = () => { ui.adding = false; refresh(); };
  const append = (token: string) => {
    const el = textarea();
    if (!el) return;
    el.value = `${el.value.trimEnd()} ${token} `.trimStart();
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  };
  return (
    <div class="m-scrim" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="m-sheet" ref={ref}>
        <QuickAdd class="m-add" focusKey={focusKey} />
        <div class="m-sf">
          <div class="m-tok">
            {TOKENS.map((t) => (
              // 按下时不抢焦点，键盘不会收起来。
              <button key={t.text} class={`chip k-${t.kind ?? "date"}`} onPointerDown={(e) => e.preventDefault()} onClick={() => append(t.text)}>{t.label}</button>
            ))}
            {lists(s).map((l) => (
              <button key={l.id} class="chip k-list" onPointerDown={(e) => e.preventDefault()} onClick={() => append(`#${l.name}`)}>{l.name}</button>
            ))}
          </div>
          <button
            class="m-send"
            aria-label="添加"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => textarea()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))}
          >
            <Icon n="up" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** iOS 的网页长按不会触发 contextmenu，自己算。 */
function useLongPress() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fired = false;
    let x = 0;
    let y = 0;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const onStart = (e: TouchEvent) => {
      const el = e.target as Element;
      const row = el.closest?.("[data-id]") as HTMLElement | null;
      const list = el.closest?.("[data-list]") as HTMLElement | null;
      fired = false;
      if ((!row && !list) || el.closest?.(".ck")) return;
      x = e.touches[0]!.clientX;
      y = e.touches[0]!.clientY;
      timer = setTimeout(() => {
        fired = true;
        const s = store();
        const point = { clientX: x, clientY: y };
        if (row) {
          const t = s.get<Task>(row.dataset.id!);
          if (t) openPop(point, () => taskMenu(t), 220, true);
        } else if (list) {
          const l = s.get<List>(list.dataset.list!);
          if (l) openPop(point, () => listContextMenu(l), 220, true);
        }
      }, 480);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]!;
      if (Math.hypot(t.clientX - x, t.clientY - y) > 8) clear();
    };
    // 长按触发过，松手时的那次点击就不算了。
    const onClick = (e: Event) => {
      if (fired) {
        fired = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    addEventListener("touchstart", onStart, { passive: true });
    addEventListener("touchmove", onMove, { passive: true });
    addEventListener("touchend", clear);
    addEventListener("touchcancel", clear);
    addEventListener("click", onClick, true);
    return () => {
      clear();
      removeEventListener("touchstart", onStart);
      removeEventListener("touchmove", onMove);
      removeEventListener("touchend", clear);
      removeEventListener("touchcancel", clear);
      removeEventListener("click", onClick, true);
    };
  }, []);
}

export function MobileApp() {
  const [, force] = useState(0);
  useEffect(() => subscribeUI(() => force((n) => n + 1)), []);
  useLongPress();
  const s = store();
  const v = ui.view;
  const sel = ui.selected ? s.get<Task>(ui.selected) : null;
  const habit = v.k === "habits" && ui.habit ? s.get<Habit>(ui.habit) : null;
  return (
    <div class="m-win">
      <div class="m-screen"><Screen /></div>
      <nav class="m-tabs">
        {TABS.map((t) => (
          <a key={t.k} class={v.k === t.k ? "on" : ""} data-tab={t.k} onClick={() => go({ k: t.k })}>
            <Icon n={t.icon} />
            {t.label}
          </a>
        ))}
      </nav>
      {/* WKWebView 只在点击的同一刻允许弹键盘。面板是之后才渲染的，先让这个框接住焦点，键盘起来后再移过去。 */}
      <input id="m-kb" class="m-kb" aria-hidden="true" tabIndex={-1} />
      {NO_ADD.includes(v.k) ? null : (
        <button
          class="m-fab"
          aria-label="添加任务"
          onClick={() => {
            document.getElementById("m-kb")?.focus();
            ui.adding = true;
            refresh();
          }}
        >
          <Icon n="plus" />
        </button>
      )}
      {sel && !sel.deleted ? <div class="m-over"><Detail t={sel} onClose={() => select(null)} /></div> : null}
      {habit && !habit.deleted ? <div class="m-over"><HabitDetail h={habit} onClose={() => { ui.habit = null; refresh(); }} /></div> : null}
      {ui.drawer ? <Drawer /> : null}
      {ui.adding ? <AddSheet /> : null}
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
