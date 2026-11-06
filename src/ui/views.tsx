import { addDays, addMonths, dateLabel, minutesOf, monthCells, monthDay, nowHm, toDate, WEEK, weekday, type Ymd } from "../core/dates.ts";
import { bucketGroups, dayGroups, habitDone, habits, habitTotal, INBOX, listName, matrix, search, streak, tasks, tasksByDay, todayGroups, toggleHabit, weekGroups, type Group, type Habit, type Quadrant, type Task } from "../core/model.ts";
import { prefs } from "../core/settings.ts";
import { dropZone, dragTask, emptyOf, Menu, moveTo, QuickAdd, TaskRow, WeekHeader } from "./common.tsx";
import { Detail } from "./detail.tsx";
import { Icon } from "./icons.tsx";
import { openPop, platform, refresh, select, store, toast, ui, type View } from "./state.ts";

export function viewTitle(v: View): { title: string; sub?: string } {
  const s = store();
  const today = ui.today;
  const fullDate = (d: Ymd) => `${monthDay(d)} 周${WEEK[weekday(d)]}`;
  switch (v.k) {
    case "today":
      return { title: "今天", sub: fullDate(today) };
    case "tomorrow":
      return { title: "明天", sub: fullDate(addDays(today, 1)) };
    case "week":
      return { title: "最近 7 天" };
    case "inbox":
      return { title: "收件箱" };
    case "list":
      return { title: listName(s, v.id) };
    case "tag":
      return { title: `#${v.name}` };
    case "completed":
      return { title: "已完成" };
    case "trash":
      return { title: "垃圾桶" };
    case "search":
      return { title: "搜索" };
    case "calendar":
      return { title: "日历" };
    case "matrix":
      return { title: "四象限" };
    case "focus":
      return { title: "专注" };
    case "habits":
      return { title: "习惯" };
    case "settings":
      return { title: "设置" };
  }
}

function groupsFor(v: View): Group[] {
  const s = store();
  const today = ui.today;
  switch (v.k) {
    case "today":
      return todayGroups(s, today, ui.sort);
    case "tomorrow":
      return dayGroups(s, addDays(today, 1), ui.sort);
    case "week":
      return weekGroups(s, today, ui.sort, (d) => `${dateLabel(d, today)} · ${monthDay(d)}`);
    case "inbox":
      return bucketGroups(tasks(s).filter((t) => t.listId === INBOX), today, ui.sort);
    case "list":
      return bucketGroups(tasks(s).filter((t) => t.listId === v.id), today, ui.sort);
    case "tag":
      return bucketGroups(tasks(s).filter((t) => (t.tags ?? []).includes(v.name)), today, ui.sort);
    case "search": {
      const r = search(s, ui.query);
      return r.length ? [{ key: "r", label: "", tasks: r }] : [];
    }
    case "completed": {
      const done = tasks(s).filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
      const days = new Map<string, Task[]>();
      for (const t of done) {
        const d = new Date(t.doneAt ?? 0);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        (days.get(key) ?? days.set(key, []).get(key)!).push(t);
      }
      return [...days].map(([k, ts]) => ({ key: k, label: `${dateLabel(k, today)} · ${monthDay(k)}`, tasks: ts }));
    }
    default:
      return [];
  }
}

const EMPTY: Partial<Record<View["k"], string>> = {
  today: "今天没有要做的事",
  tomorrow: "明天还没有安排",
  week: "接下来一周很空",
  inbox: "收件箱是空的",
  list: "这个清单是空的",
  tag: "没有这个标签的任务",
  completed: "还没有完成的任务",
  search: "没有找到",
};

export function selectable(v: View): string[] {
  return groupsFor(v).flatMap((g) => g.tasks.map((t) => t.id));
}

export function ListView() {
  const v = ui.view;
  const groups = groupsFor(v);
  const showDate = v.k !== "today" && v.k !== "tomorrow";
  // 手机上用右下角的加号。
  const showAdd = v.k !== "completed" && v.k !== "search" && platform().kind !== "ios";
  return (
    <>
      {showAdd ? <QuickAdd class="m-qa" focusKey={ui.focusAdd} /> : null}
      <div class="ls" onClick={(e) => { if (e.target === e.currentTarget) select(null); }}>
        {groups.length === 0 ? (v.k === "search" && !ui.query.trim() ? null : emptyOf(EMPTY[v.k] ?? "")) : null}
        {groups.map((g) => (
          <div key={g.key}>
            {g.label ? <div class={`g ${g.tone ?? ""}`}>{g.label}<em>{g.tasks.length}</em></div> : null}
            <div class="g-c">{g.tasks.map((t) => <TaskRow key={t.id} t={t} showDate={showDate || g.key === "overdue"} showList={v.k !== "list"} />)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

export function TrashView() {
  const s = store();
  const items = s.allWithDeleted<Task>("task").filter((t) => t.deleted && !(t as Task & { purged?: boolean }).purged).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  return (
    <div class="ls">
      {items.length === 0 ? emptyOf("垃圾桶是空的", "trash") : null}
      {items.map((t) => (
        <div key={t.id} class="t trashed">
          <span class="tt">{t.title}</span>
          <button class="lnk" onClick={() => s.restore(t.id)}>恢复</button>
          <button
            class="lnk danger"
            onClick={async () => {
              if (await platform().confirm(`永久删除“${t.title}”？`, "删除后不能恢复。", "永久删除")) {
                s.update(t.id, { purged: true, title: "", notes: "", tags: [] });
              }
            }}
          >
            永久删除
          </button>
        </div>
      ))}
    </div>
  );
}

// ── 日历 ─────────────────────────────────────────────

/** 时间重叠的任务并排放，不互相盖住。 */
function layoutEvents(ts: Task[]): { t: Task; col: number; cols: number }[] {
  const items = ts
    .map((t) => {
      const s = minutesOf(t.time!);
      const e = t.endTime && t.endTime > t.time! ? minutesOf(t.endTime) : s + 30;
      return { t, s, e, col: 0, cols: 1 };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster: typeof items = [];
  let clusterEnd = -1;
  const close = () => {
    const ends: number[] = [];
    for (const it of cluster) {
      let c = ends.findIndex((end) => end <= it.s);
      if (c < 0) c = ends.length;
      ends[c] = it.e;
      it.col = c;
    }
    for (const it of cluster) it.cols = ends.length;
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) {
      close();
      clusterEnd = -1;
    }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  close();
  return items;
}

export function Agenda({ day }: { day: Ymd }) {
  const s = store();
  const today = ui.today;
  const all = tasks(s).filter((t) => t.date === day);
  const allDay = all.filter((t) => !t.time);
  const timed = all.filter((t) => t.time);
  const H = 44;
  const startHour = 6;
  const y = (hm: string) => ((minutesOf(hm) - startHour * 60) / 60) * H;
  return (
    <div class="detail agenda">
      <div class="dh"><b class="ag-t">{monthDay(day)}</b><span class="ag-s">周{WEEK[weekday(day)]}{day === today ? " · 今天" : ""}</span></div>
      <QuickAdd class="ag-qa" defaults={{ date: day }} placeholder="添加到这一天" />
      {allDay.length ? <div class="ag-all">{allDay.map((t) => <TaskRow key={t.id} t={t} showDate={false} compact />)}</div> : null}
      <div class="tl">
        <div class="tl-in" style={{ height: `${18 * H}px` }}>
          {Array.from({ length: 18 }, (_, i) => (
            <div key={i} class="tl-h" style={{ top: `${i * H}px` }}><span>{String(i + startHour).padStart(2, "0")}:00</span></div>
          ))}
          {layoutEvents(timed).map(({ t, col, cols }) => {
            const top = Math.max(0, y(t.time!));
            const end = t.endTime && t.endTime > t.time! ? y(t.endTime) : top + H / 2;
            return (
              <button key={t.id} class={`ev p${t.priority} ${t.done ? "done" : ""} ${ui.selected === t.id ? "sel" : ""}`} style={{ top: `${top + 1}px`, height: `${Math.max(22, end - top - 2)}px`, left: `calc(62px + (100% - 64px) * ${col / cols})`, width: `calc((100% - 64px) / ${cols} - 2px)` }} draggable onDragStart={(e) => dragTask(e as DragEvent, t.id)} onClick={() => select(t.id)}>
                <span>{t.title}</span>
                {t.endTime ? <small>{t.time}–{t.endTime}</small> : null}
              </button>
            );
          })}
          {day === today ? <div class="tl-now" style={{ top: `${y(nowHm())}px` }} /> : null}
        </div>
      </div>
    </div>
  );
}

export function CalendarView() {
  const s = store();
  const today = ui.today;
  const month = ui.calMonth;
  const cells = monthCells(month, prefs(s).weekStart);
  const map = tasksByDay(s, cells[0]!, cells[cells.length - 1]!);
  const [y, m] = month.split("-").map(Number);
  const shift = (n: number) => {
    ui.calMonth = addMonths(`${month}-01`, n).slice(0, 7);
    refresh();
  };
  const sel = ui.selected ? s.get<Task>(ui.selected) : null;
  return (
    <div class="split">
      <div class="cal">
        <div class="cal-h">
          <h1>{y} 年 {m} 月</h1>
          <button class="gb" aria-label="上个月" onClick={() => shift(-1)}><Icon n="left" /></button>
          <button class="gb" aria-label="下个月" onClick={() => shift(1)}><Icon n="right" /></button>
          <button class="gb wide" onClick={() => { ui.calMonth = today.slice(0, 7); ui.calDay = today; refresh(); }}>今天</button>
        </div>
        <WeekHeader class="cal-w" />
        <div class="cal-g" style={{ gridTemplateRows: `repeat(${cells.length / 7},1fr)` }}>
          {cells.map((d) => {
            const list = map.get(d) ?? [];
            const out = d.slice(0, 7) !== month;
            return (
              <div
                key={d}
                data-day={d}
                class={`cc ${out ? "out" : ""} ${d === today ? "today" : ""} ${d === ui.calDay ? "on" : ""}`}
                onClick={() => { ui.calDay = d; ui.selected = null; refresh(); }}
                {...dropZone((id) => s.update(id, { date: d }))}
              >
                <b>{toDate(d).getDate()}</b>
                {list.slice(0, 3).map((t) => (
                  <div key={t.id} class={`chipt p${t.priority} ${t.done ? "done" : ""}`} draggable onDragStart={(e) => dragTask(e as DragEvent, t.id)} onClick={(e) => { e.stopPropagation(); ui.calDay = d; select(t.id); }}>
                    {t.title}
                  </div>
                ))}
                {list.length > 3 ? <em>还有 {list.length - 3} 项</em> : null}
              </div>
            );
          })}
        </div>
      </div>
      {sel && !sel.deleted ? <Detail t={sel} onClose={() => select(null)} /> : <Agenda day={ui.calDay} />}
    </div>
  );
}

// ── 四象限 ───────────────────────────────────────────

const QUADS: { q: Quadrant; title: string; c: string; defaults: (today: Ymd) => Partial<Task> }[] = [
  { q: 1, title: "重要且紧急", c: "var(--red)", defaults: (d) => ({ priority: 3, date: d }) },
  { q: 2, title: "重要不紧急", c: "var(--org)", defaults: () => ({ priority: 3, date: null }) },
  { q: 3, title: "紧急不重要", c: "var(--ac)", defaults: (d) => ({ date: d }) },
  { q: 4, title: "不重要不紧急", c: "var(--mut)", defaults: () => ({ date: null }) },
];

export function MatrixView() {
  const s = store();
  const today = ui.today;
  const m = matrix(s, today);
  return (
    <div class="mx">
      {QUADS.map((q) => (
        <section key={q.q} class="q" data-q={q.q} {...dropZone((id) => moveTo(q.q, id))}>
          <h3 style={{ color: q.c }}><i class="dot" style={{ background: q.c }} />{q.title}<em>{m[q.q].length}</em></h3>
          <div class="q-l">
            {m[q.q].map((t) => <TaskRow key={t.id} t={t} showList={false} />)}
          </div>
          <QuickAdd class="q-qa" defaults={q.defaults(today)} placeholder="添加" />
        </section>
      ))}
    </div>
  );
}

// ── 习惯 ─────────────────────────────────────────────

export function HabitDetail({ h, onClose }: { h: Habit; onClose?: () => void }) {
  const s = store();
  const today = ui.today;
  const first = `${today.slice(0, 7)}-01`;
  const cells = monthCells(today.slice(0, 7), prefs(s).weekStart);
  return (
    <div class="detail">
      <div class="dh">
        <input class="h-name" value={h.name} spellcheck={false} onChange={(e) => s.update(h.id, { name: (e.currentTarget as HTMLInputElement).value.trim() || h.name })} />
        <button
          class="dh-ico"
          aria-label="更多"
          onClick={(e) => openPop(e, () => <Menu items={[{
            label: "删除习惯", icon: "trash", danger: true, onClick: () => {
              s.remove(h.id);
              ui.habit = null;
              toast(`已删除“${h.name}”`, () => s.restore(h.id));
            },
          }]} />, 150)}
        >
          <Icon n="more" />
        </button>
        {onClose ? <button class="dh-ico" aria-label="关闭" onClick={onClose}><Icon n="x" /></button> : null}
      </div>
      <div class="h-stats">
        <div><b>{streak(s, h.id, today)}</b><span>连续天数</span></div>
        <div><b>{habitTotal(s, h.id)}</b><span>累计</span></div>
      </div>
      <WeekHeader class="dp-w h-w" />
      <div class="h-month">
        {cells.map((d) => {
          const on = habitDone(s, h.id, d);
          const out = d.slice(0, 7) !== first.slice(0, 7);
          const future = d > today;
          return (
            <button key={d} disabled={future} class={`${on ? "on" : ""} ${out ? "out" : ""} ${d === today ? "today" : ""}`} onClick={() => toggleHabit(s, h.id, d)}>
              {toDate(d).getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function HabitsView() {
  const s = store();
  const today = ui.today;
  const list = habits(s);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <>
      <div class="hb">
        <div class="qa m-qa">
          <Icon n="plus" class="qa-i" />
          <input
            class="hb-add"
            placeholder="添加习惯"
            spellcheck={false}
            onKeyDown={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              if (e.key === "Enter" && !e.isComposing && el.value.trim()) {
                ui.habit = s.create("habit", { name: el.value.trim(), order: Date.now(), createdAt: Date.now() });
                el.value = "";
              }
            }}
          />
        </div>
        <div class="ls">
          {list.length === 0 ? emptyOf("还没有习惯", "habit") : null}
          {list.length ? <div class="hb-head"><span />{days.map((d) => <span key={d} class={d === today ? "today" : ""}>{WEEK[weekday(d)]}</span>)}<span /></div> : null}
          {list.map((h) => (
            <div key={h.id} class={`hb-r ${ui.habit === h.id ? "sel" : ""}`} onClick={() => { ui.habit = h.id; refresh(); }}>
              <span class="hb-n">{h.name}</span>
              {days.map((d) => (
                <button key={d} class={`hb-d ${habitDone(s, h.id, d) ? "on" : ""} ${d === today ? "today" : ""}`} aria-label={d} onClick={(e) => { e.stopPropagation(); toggleHabit(s, h.id, d); }}>
                  <Icon n="check" />
                </button>
              ))}
              <span class="hb-s">{streak(s, h.id, today) || ""}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
