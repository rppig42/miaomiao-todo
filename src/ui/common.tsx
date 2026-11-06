import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { addDays, addMonths, dateLabel, monthCells, nowHm, parseClock, toDate, WEEK, weekOrder, type Ymd } from "../core/dates.ts";
import { addFromText, lists, listName, moveToQuadrant, setRepeat, setTime, subs, type Quadrant, type Task } from "../core/model.ts";
import { parseNL, type Parsed, type Token } from "../core/nl.ts";
import { repeatLabel } from "../core/repeat.ts";
import { prefs } from "../core/settings.ts";
import { Icon } from "./icons.tsx";
import { RepeatMenu } from "./repeat.tsx";
import { closePop, closeTop, openPop, openPop2, platform, refresh, select, store, trash, toggleDone, toast, ui, viewDefaults, type Pop } from "./state.ts";

export const PRIORITY = [
  { v: 3, label: "高优先级", c: "var(--red)" },
  { v: 2, label: "中优先级", c: "var(--org)" },
  { v: 1, label: "低优先级", c: "var(--ac)" },
  { v: 0, label: "无优先级", c: "var(--mut)" },
];
export const pColor = (p: number) => PRIORITY.find((x) => x.v === p)?.c ?? "var(--mut)";

export function Menu({ items }: { items: { label: string; icon?: string; color?: string; danger?: boolean; checked?: boolean; hint?: string; sep?: boolean; onClick?: () => void }[] }) {
  return (
    <div class="menu">
      {items.map((it, i) =>
        it.sep ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            class={`mi ${it.danger ? "danger" : ""}`}
            onClick={() => {
              closePop();
              it.onClick?.();
            }}
          >
            {it.icon ? <Icon n={it.icon} style={it.color ? { color: it.color } : undefined} /> : it.color ? <i class="dot" style={{ background: it.color }} /> : null}
            <span>{it.label}</span>
            {it.hint ? <em>{it.hint}</em> : null}
            {it.checked ? <Icon n="check" class="mck" /> : null}
          </button>
        ),
      )}
    </div>
  );
}

/** 输入时不打断输入法：页面只在没有焦点时才把外部变化写回输入框。 */
export function Editable(props: { value: string; placeholder?: string; class?: string; onChange: (v: string) => void; onEnter?: (el: HTMLTextAreaElement) => void; onBackspaceEmpty?: () => void; focusKey?: number; multiline?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.value !== props.value) el.value = props.value;
    fit();
  }, [props.value]);
  useEffect(() => {
    if (props.focusKey) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [props.focusKey]);
  return (
    <textarea
      ref={ref}
      rows={1}
      class={props.class}
      defaultValue={props.value}
      placeholder={props.placeholder}
      spellcheck={false}
      onInput={(e) => {
        fit();
        if (!composing.current) props.onChange((e.currentTarget as HTMLTextAreaElement).value);
      }}
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={(e) => {
        composing.current = false;
        props.onChange((e.currentTarget as HTMLTextAreaElement).value);
      }}
      onKeyDown={(e) => {
        if (e.isComposing || composing.current) return;
        if (e.key === "Enter" && !props.multiline) {
          e.preventDefault();
          props.onEnter?.(e.currentTarget as HTMLTextAreaElement);
        }
        if (e.key === "Backspace" && !(e.currentTarget as HTMLTextAreaElement).value) props.onBackspaceEmpty?.();
        if (e.key === "Escape") (e.currentTarget as HTMLTextAreaElement).blur();
      }}
    />
  );
}

function renderMarked(text: string, tokens: Token[]) {
  const out: ComponentChildren[] = [];
  let last = 0;
  tokens.forEach((t, i) => {
    out.push(text.slice(last, t.start));
    out.push(<span key={i} class={`k-${t.kind}`}>{text.slice(t.start, t.end)}</span>);
    last = t.end;
  });
  out.push(text.slice(last));
  return out;
}

function chipList(p: Parsed, today: Ymd) {
  const chips: { key: string; kind: string; label: string; texts: string[] }[] = [];
  const texts = (...kinds: string[]) => p.tokens.filter((t) => kinds.includes(t.kind)).map((t) => t.text);
  if (p.date || p.time) {
    const when = [p.date ? dateLabel(p.date, today) : "", p.time ? (p.endTime ? `${p.time}–${p.endTime}` : p.time) : ""].filter(Boolean).join(" ");
    if (texts("date", "time").length) chips.push({ key: "when", kind: "date", label: when, texts: texts("date", "time") });
  }
  if (p.repeat) chips.push({ key: "rep", kind: "repeat", label: repeatLabel(p.repeat), texts: texts("repeat") });
  if (p.priority) chips.push({ key: "pri", kind: "priority", label: PRIORITY.find((x) => x.v === p.priority)?.label ?? "", texts: texts("priority") });
  if (p.list) chips.push({ key: "list", kind: "list", label: p.list, texts: texts("list") });
  for (const n of p.tags) chips.push({ key: `t-${n}`, kind: "tag", label: `#${n}`, texts: [`#${n}`, `＃${n}`] });
  return chips;
}

export interface NLProps {
  class?: string;
  placeholder: string;
  lists: string[];
  onSubmit: (text: string, ignored: string[]) => boolean;
  focusKey?: number;
  autoFocus?: boolean;
  onEscape?: () => void;
  icon?: boolean;
}

/** 快捷添加框：文字透明的输入框盖在高亮层上，边打字边标出识别到的日期、优先级和清单。 */
export function NLInput(props: NLProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [shake, setShake] = useState(false);
  const parsed = parseNL(text, { today: ui.today, lists: props.lists, ignored });
  useEffect(() => {
    if (props.focusKey || props.autoFocus) ref.current?.focus();
  }, [props.focusKey]);
  const reset = () => {
    if (ref.current) ref.current.value = "";
    setText("");
    setIgnored([]);
  };
  return (
    <div class={`qa ${props.class ?? ""} ${shake ? "shake" : ""}`} onAnimationEnd={() => setShake(false)}>
      {props.icon === false ? null : <Icon n="plus" class="qa-i" />}
      <div class="nl">
        <div class="nl-m">{renderMarked(text, parsed.tokens)}</div>
        <textarea
          ref={ref}
          rows={1}
          placeholder={props.placeholder}
          spellcheck={false}
          data-qa
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              if (!text.trim()) return;
              if (props.onSubmit(text, ignored)) reset();
              else setShake(true);
            } else if (e.key === "Escape") {
              if (text) reset();
              else {
                (e.currentTarget as HTMLTextAreaElement).blur();
                props.onEscape?.();
              }
            }
          }}
        />
      </div>
      <div class="nl-c">
        {chipList(parsed, ui.today).map((c) => (
          <button key={c.key} class={`chip k-${c.kind}`} title="不识别这一项" onClick={() => setIgnored([...ignored, ...c.texts])}>
            {c.label}
            <Icon n="x" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function QuickAdd({ defaults, placeholder = "添加任务", focusKey, class: cls }: { defaults?: Partial<Task>; placeholder?: string; focusKey?: number; class?: string }) {
  const s = store();
  return (
    <NLInput
      class={cls}
      placeholder={placeholder}
      lists={lists(s).map((l) => l.name)}
      focusKey={focusKey}
      onSubmit={(text, ignored) => {
        const r = addFromText(s, text, ui.today, defaults ?? viewDefaults(), ignored);
        if (!r) return false;
        return true;
      }}
    />
  );
}

export function whenLabel(t: Task, today: Ymd, showDate: boolean): string {
  if (!t.date) return "";
  const time = t.time ?? "";
  if (!showDate && t.date === today) return time;
  const d = dateLabel(t.date, today);
  return time ? `${d} ${time}` : d;
}

export function taskMenu(t: Task) {
  const s = store();
  const today = ui.today;
  return (
    <Menu
      items={[
        { label: "今天", icon: "sun", onClick: () => s.update(t.id, { date: today }) },
        { label: "明天", icon: "rise", onClick: () => s.update(t.id, { date: addDays(today, 1) }) },
        { label: "下周", icon: "week", onClick: () => s.update(t.id, { date: addDays(today, 7) }) },
        { label: "清除日期", icon: "x", onClick: () => s.update(t.id, { date: null, time: null, endTime: null, remind: [], repeat: null }) },
        { sep: true, label: "" },
        ...PRIORITY.map((p) => ({ label: p.label, icon: "flag", color: p.c, checked: t.priority === p.v, onClick: () => s.update(t.id, { priority: p.v }) })),
        { sep: true, label: "" },
        {
          label: "移到清单…",
          icon: "list",
          onClick: () => {
            ui.pop = { x: lastPointer.x, y: lastPointer.y, width: 200, content: () => listMenu(t) };
            refresh();
          },
        },
        { label: "删除", icon: "trash", danger: true, onClick: () => trash(t) },
      ]}
    />
  );
}

export const lastPointer = { x: 0, y: 0 };
addEventListener("pointerdown", (e) => {
  lastPointer.x = e.clientX;
  lastPointer.y = e.clientY;
}, true);

export function listMenu(t: Task) {
  const s = store();
  return (
    <Menu
      items={[
        { label: "收件箱", icon: "inbox", checked: t.listId === "inbox", onClick: () => s.update(t.id, { listId: "inbox" }) },
        ...lists(s).map((l) => ({ label: l.name, color: l.color, checked: t.listId === l.id, onClick: () => s.update(t.id, { listId: l.id }) })),
      ]}
    />
  );
}

export function dragTask(e: DragEvent, id: string) {
  e.dataTransfer?.setData("text/x-task", id);
  e.dataTransfer?.setData("text/plain", store().get<Task>(id)?.title ?? "");
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

/** 让元素接收拖过来的任务。 */
export function dropZone(onDrop: (taskId: string) => void) {
  return {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      (e.currentTarget as HTMLElement).classList.add("dropping");
    },
    onDragLeave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("dropping"),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).classList.remove("dropping");
      const id = e.dataTransfer?.getData("text/x-task");
      if (id) onDrop(id);
    },
  };
}

export function TaskRow({ t, showDate = true, showList = true, compact = false }: { t: Task; showDate?: boolean; showList?: boolean; compact?: boolean }) {
  const s = store();
  const today = ui.today;
  const sub = subs(s, t.id);
  const doneSubs = sub.filter((x) => x.done).length;
  const over = !t.done && t.date !== null && t.date < today;
  const when = whenLabel(t, today, showDate);
  return (
    <div
      class={`t p${t.priority} ${t.done ? "done" : ""} ${over ? "over" : ""} ${ui.selected === t.id ? "sel" : ""} ${compact ? "compact" : ""}`}
      data-id={t.id}
      draggable
      onDragStart={(e) => dragTask(e as DragEvent, t.id)}
      onClick={() => select(t.id)}
      onDblClick={() => {
        ui.focusTitle++;
        select(t.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        select(t.id);
        openPop(e, () => taskMenu(t), 200, true);
      }}
    >
      <button
        class="ck"
        aria-label={t.done ? "标记为未完成" : "完成"}
        onClick={(e) => {
          e.stopPropagation();
          toggleDone(t);
        }}
      />
      <span class="tt">{t.title}</span>
      {compact ? null : (
        <>
          {sub.length ? <span class="tsub">{doneSubs}/{sub.length}</span> : null}
          {(t.tags ?? []).slice(0, 2).map((n) => <span key={n} class="tag">{n}</span>)}
          {showList && t.listId !== "inbox" && !(t.tags ?? []).length ? <span class="tag">{listName(s, t.listId)}</span> : null}
          {t.repeat ? <Icon n="repeat" class="tico" /> : null}
        </>
      )}
      {when ? <span class="tm">{when}</span> : null}
    </div>
  );
}

// ── 日期选择 ─────────────────────────────────────────

export const REMINDS = [
  { v: "", label: "不提醒" },
  { v: "0", label: "准时" },
  { v: "5", label: "提前 5 分钟" },
  { v: "15", label: "提前 15 分钟" },
  { v: "30", label: "提前 30 分钟" },
  { v: "60", label: "提前 1 小时" },
  { v: "1440", label: "提前 1 天" },
];

/** 月历顶上的星期，按设置里的每周第一天排。 */
export function WeekHeader({ class: cls }: { class: string }) {
  return <div class={cls}>{weekOrder(prefs(store()).weekStart).map((i) => <span key={i}>{WEEK[i]}</span>)}</div>;
}

/** 始终 24 小时制。系统自带的时间控件会跟着系统区域显示成 AM/PM。required 时清空会退回原来的时间。 */
export function TimeField({ value, disabled, required, onChange }: { value: string | null; disabled?: boolean; required?: boolean; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = value ?? "";
  }, [value]);
  const commit = () => {
    const el = ref.current!;
    const v = parseClock(el.value);
    if (v === undefined || (v === null && required)) el.value = value ?? "";
    else if (v !== value) onChange(v);
    if (v) el.value = v;
  };
  return (
    <input
      ref={ref}
      class="tf"
      defaultValue={value ?? ""}
      placeholder="--:--"
      disabled={disabled}
      spellcheck={false}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.isComposing) {
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function DatePicker({ t }: { t: Task }) {
  const s = store();
  const today = ui.today;
  const cur = s.get<Task>(t.id) ?? t;
  const [month, setMonth] = useState((cur.date ?? today).slice(0, 7));
  const set = (date: Ymd | null) => {
    if (date) s.update(t.id, { date });
    else s.update(t.id, { date: null, time: null, endTime: null, remind: [], repeat: null });
  };
  return (
    <div class="dp">
      <div class="dp-q">
        <button title="今天" onClick={() => set(today)}><Icon n="sun" /></button>
        <button title="明天" onClick={() => set(addDays(today, 1))}><Icon n="rise" /></button>
        <button title="下周" onClick={() => set(addDays(today, 7))}><Icon n="week" /></button>
        <button title="清除日期" onClick={() => { set(null); closePop(); }}><Icon n="x" /></button>
      </div>
      <div class="dp-h">
        <b>{month.replace("-", " 年 ").replace(/ 年 0?/, " 年 ")} 月</b>
        <button onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}><Icon n="left" /></button>
        <button onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}><Icon n="right" /></button>
      </div>
      <WeekHeader class="dp-w" />
      <div class="dp-g">
        {monthCells(month, prefs(s).weekStart).map((d) => (
          <button key={d} class={`${d.slice(0, 7) === month ? "" : "out"} ${d === today ? "today" : ""} ${d === cur.date ? "on" : ""}`} onClick={() => set(d)}>
            {toDate(d).getDate()}
          </button>
        ))}
      </div>
      <div class="dp-r">
        <label>时间</label>
        <TimeField value={cur.time} onChange={(v) => {
          if (v && !cur.date) s.update(t.id, { date: today });
          setTime(s, t.id, v, cur.endTime);
        }} />
        <span>–</span>
        <TimeField value={cur.endTime} disabled={!cur.time} onChange={(v) => setTime(s, t.id, cur.time, v)} />
      </div>
      <div class="dp-r">
        <label>重复</label>
        <button class="dp-val" onClick={(e) => openPop2(e, () => <RepeatMenu t={t} />, 236, true)}>
          <span>{cur.repeat ? repeatLabel(cur.repeat) : "不重复"}</span>
          <Icon n="right" />
        </button>
        {cur.repeat ? <button class="dp-x" aria-label="不重复" onClick={() => setRepeat(s, t.id, null, today)}><Icon n="x" /></button> : null}
      </div>
      <div class="dp-r">
        <label>提醒</label>
        <select value={cur.remind?.length ? String(cur.remind[0]) : ""} onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          s.update(t.id, { remind: v === "" ? [] : [Number(v)], ...(v !== "" && !cur.date ? { date: today } : {}) });
        }}>
          {REMINDS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
        </select>
      </div>
    </div>
  );
}

function PopLayer({ pop, level }: { pop: Pop; level: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - 8) el.style.left = `${Math.max(8, innerWidth - r.width - 8)}px`;
    if (r.bottom > innerHeight - 8) el.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`;
  });
  return (
    <div ref={ref} class={`pop ${pop.bare ? "bare" : ""}`} data-level={level} style={{ left: `${pop.x}px`, top: `${pop.y}px`, width: `${pop.width ?? 220}px` }}>
      {pop.content()}
    </div>
  );
}

export function Popover() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ui.pop && !ui.pop2) return;
      const hit = (e.target as Element).closest?.(".pop") as HTMLElement | null;
      if (!hit) closePop();
      else if (hit.dataset.level === "0" && ui.pop2) closeTop();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (!ui.pop && !ui.pop2)) return;
      e.stopPropagation();
      closeTop();
    };
    addEventListener("pointerdown", onDown, true);
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("pointerdown", onDown, true);
      removeEventListener("keydown", onKey, true);
    };
  }, []);
  return (
    <>
      {ui.pop ? <PopLayer pop={ui.pop} level={0} /> : null}
      {ui.pop2 ? <PopLayer pop={ui.pop2} level={1} /> : null}
    </>
  );
}

export function emptyOf(text: string, icon = "doneAll") {
  return (
    <div class="empty">
      <Icon n={icon} size={38} />
      <p>{text}</p>
    </div>
  );
}

export function moveTo(q: Quadrant, id: string) {
  moveToQuadrant(store(), id, q, ui.today);
}

export { nowHm, parseNL, platform, toast };
