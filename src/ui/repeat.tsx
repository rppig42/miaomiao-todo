import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { lunarDayName, lunarMonthName, lunarOf } from "../core/cn-calendar.ts";
import { toDate, WEEK, weekday, weekOrder, type Ymd } from "../core/dates.ts";
import { setRepeat, type Task } from "../core/model.ts";
import { repeatPresets, sameRepeat, type Repeat } from "../core/repeat.ts";
import { prefs } from "../core/settings.ts";
import { Icon } from "./icons.tsx";
import { closeTop, replaceTop, store, ui } from "./state.ts";

function Item({ label, hint, on, onClick }: { label: string; hint?: string; on?: boolean; onClick: () => void }) {
  return (
    <button class={`ri ${on ? "on" : ""}`} onClick={onClick}>
      <span>{label}</span>
      {hint ? <small>({hint})</small> : null}
      {on ? <Icon n="check" class="ri-ck" /> : null}
    </button>
  );
}

function SubItem({ label, on, children }: { label: string; on: boolean; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    // 右边放不下就翻到左边。
    setFlip(ref.current.getBoundingClientRect().right + 196 > innerWidth);
  }, [open]);
  return (
    <div ref={ref} class="ri-w" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button class={`ri ${on ? "on" : ""} ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <Icon n="right" class="ri-chev" />
      </button>
      {open ? <div class={`ri-sub ${flip ? "flip" : ""}`}><div class="ri-panel">{children}</div></div> : null}
    </div>
  );
}

/** 重复菜单。预设都从任务当前的日期推出来，比如周六的任务“每周”就是每周六。 */
export function RepeatMenu({ t }: { t: Task }) {
  const s = store();
  const cur = s.get<Task>(t.id) ?? t;
  const base = cur.date ?? ui.today;
  const p = repeatPresets(base);
  const d = toDate(base);
  const l = lunarOf(base);
  const r = cur.repeat ?? null;
  const is = (x: Repeat) => sameRepeat(r, x);
  const pick = (x: Repeat) => {
    setRepeat(s, t.id, x, ui.today);
    closeTop();
  };
  const custom = !!r && !Object.values(p).some(is);
  return (
    <div class="rm">
      <Item label="每天" on={is(p.daily)} onClick={() => pick(p.daily)} />
      <Item label="每周" hint={`周${WEEK[weekday(base)]}`} on={is(p.weekly)} onClick={() => pick(p.weekly)} />
      <Item label="每月" hint={`${d.getDate()}日`} on={is(p.monthly)} onClick={() => pick(p.monthly)} />
      <Item label="每年" hint={`${d.getMonth() + 1}月${d.getDate()}日`} on={is(p.yearly)} onClick={() => pick(p.yearly)} />
      <hr />
      <SubItem label="工作日" on={is(p.weekdays) || is(p.workdays)}>
        <Item label="周一至周五" on={is(p.weekdays)} onClick={() => pick(p.weekdays)} />
        <Item label="法定工作日" on={is(p.workdays)} onClick={() => pick(p.workdays)} />
      </SubItem>
      <SubItem label="节假日" on={is(p.weekends) || is(p.holidays)}>
        <Item label="周末" on={is(p.weekends)} onClick={() => pick(p.weekends)} />
        <Item label="法定节假日" on={is(p.holidays)} onClick={() => pick(p.holidays)} />
      </SubItem>
      <SubItem label="农历重复" on={is(p.lunarMonthly) || is(p.lunarYearly)}>
        <Item label="每月" hint={lunarDayName(l.day)} on={is(p.lunarMonthly)} onClick={() => pick(p.lunarMonthly)} />
        <Item label="每年" hint={`${lunarMonthName(l.month)}${lunarDayName(l.day)}`} on={is(p.lunarYearly)} onClick={() => pick(p.lunarYearly)} />
      </SubItem>
      <Item label="艾宾浩斯记忆法" on={is(p.ebbinghaus)} onClick={() => pick(p.ebbinghaus)} />
      <hr />
      <Item label="自定义" on={custom} onClick={() => replaceTop(() => <RepeatCustom t={t} />, 252)} />
    </div>
  );
}

type Unit = "daily" | "weekly" | "monthly" | "yearly";
const UNITS: { v: Unit; label: string }[] = [
  { v: "daily", label: "天" },
  { v: "weekly", label: "周" },
  { v: "monthly", label: "月" },
  { v: "yearly", label: "年" },
];

function initial(r: Repeat | null, base: Ymd) {
  const known = r && (r.freq === "daily" || r.freq === "weekly" || r.freq === "monthly" || r.freq === "yearly") ? r : null;
  return {
    from: r?.from === "done" ? "done" : "due",
    every: known?.every ?? 1,
    unit: (known?.freq ?? "weekly") as Unit,
    days: known?.freq === "weekly" && known.days.length ? known.days : [weekday(base)],
    day: known?.freq === "monthly" ? known.day : toDate(base).getDate(),
  };
}

/** 自定义重复：每 N 天、周、月、年，可以按到期日期或完成日期算。 */
export function RepeatCustom({ t }: { t: Task }) {
  const s = store();
  const cur = s.get<Task>(t.id) ?? t;
  const base = cur.date ?? ui.today;
  const [v] = useState(() => initial(cur.repeat ?? null, base));
  const [from, setFrom] = useState(v.from);
  const [every, setEvery] = useState(String(v.every));
  const [unit, setUnit] = useState<Unit>(v.unit);
  const [days, setDays] = useState<number[]>(v.days);
  const [day, setDay] = useState(v.day);

  const save = () => {
    const n = Math.min(99, Math.max(1, Number(every) || 1));
    const withEvery = n > 1 ? { every: n } : {};
    const fromDone = from === "done" ? { from: "done" as const } : {};
    let r: Repeat;
    if (unit === "daily") r = { freq: "daily", ...withEvery, ...fromDone };
    else if (unit === "weekly") r = { freq: "weekly", ...withEvery, days, ...fromDone };
    else if (unit === "monthly") r = { freq: "monthly", ...withEvery, day, ...fromDone };
    else r = { freq: "yearly", ...withEvery, ...fromDone };
    setRepeat(s, t.id, r, ui.today);
    closeTop();
  };

  return (
    <div class="rc">
      <select class="rc-sel" value={from} onChange={(e) => setFrom((e.currentTarget as HTMLSelectElement).value)}>
        <option value="due">按到期日期</option>
        <option value="done">按完成日期</option>
      </select>
      <div class="rc-row">
        <label class="rc-every">
          每
          <input
            value={every}
            inputMode="numeric"
            spellcheck={false}
            onInput={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              el.value = el.value.replace(/\D/g, "").slice(0, 2);
              setEvery(el.value);
            }}
            onBlur={(e) => setEvery(String(Math.min(99, Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1))))}
          />
        </label>
        <select class="rc-sel" value={unit} onChange={(e) => setUnit((e.currentTarget as HTMLSelectElement).value as Unit)}>
          {UNITS.map((u) => <option key={u.v} value={u.v}>{u.label}</option>)}
        </select>
      </div>
      {unit === "weekly" ? (
        <div class="rc-days">
          {weekOrder(prefs(s).weekStart).map((i) => (
            <button
              key={i}
              class={days.includes(i) ? "on" : ""}
              onClick={() => {
                // 至少留一天。
                if (days.includes(i)) {
                  if (days.length > 1) setDays(days.filter((x) => x !== i));
                } else setDays([...days, i]);
              }}
            >
              {WEEK[i]}
            </button>
          ))}
        </div>
      ) : null}
      {unit === "monthly" ? (
        <div class="rc-month">
          {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
            <button key={n} class={day === n ? "on" : ""} onClick={() => setDay(n)}>{n}</button>
          ))}
        </div>
      ) : null}
      <div class="rc-a">
        <button class="rc-no" onClick={closeTop}>取消</button>
        <button class="rc-ok" onClick={save}>确定</button>
      </div>
    </div>
  );
}
