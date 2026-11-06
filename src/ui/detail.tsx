import { useRef } from "preact/hooks";
import { dateLabel } from "../core/dates.ts";
import { repeatLabel } from "../core/repeat.ts";
import { prefs } from "../core/settings.ts";
import { RepeatMenu } from "./repeat.tsx";
import { addSub, durationMinutes, listName, lists, pomoCount, subs, type Sub, type Task } from "../core/model.ts";
import { DatePicker, Editable, listMenu, Menu, pColor, PRIORITY } from "./common.tsx";
import { startFocus } from "./focus.tsx";
import { Icon } from "./icons.tsx";
import { go, openPop, select, store, toggleDone, trash, ui } from "./state.ts";

function SubRow({ x, focusNext }: { x: Sub; focusNext: () => void }) {
  const s = store();
  return (
    <div class={`st ${x.done ? "done" : ""}`}>
      <button class="ck" aria-label="完成" onClick={() => s.update(x.id, { done: !x.done })} />
      <Editable
        class="st-t"
        value={x.title}
        onChange={(title) => s.update(x.id, { title })}
        onEnter={focusNext}
        onBackspaceEmpty={() => s.remove(x.id)}
      />
      <button class="st-x" aria-label="删除" onClick={() => s.remove(x.id)}><Icon n="x" /></button>
    </div>
  );
}

export function Detail({ t, onClose }: { t: Task; onClose?: () => void }) {
  const s = store();
  const addRef = useRef<HTMLInputElement>(null);
  const today = ui.today;
  const list = subs(s, t.id);
  const over = !t.done && t.date !== null && t.date < today;
  const dateText = t.date ? `${dateLabel(t.date, today)}${t.time ? ` ${t.time}${t.endTime ? `–${t.endTime}` : ""}` : ""}` : "设置日期";
  const color = lists(s).find((l) => l.id === t.listId)?.color;
  const pomo = pomoCount(s, t.id);
  return (
    <div class="detail" key={t.id}>
      <div class="dh">
        <span class={`dh-ck t p${t.priority} ${t.done ? "done" : ""}`}><button class="ck" aria-label="完成" onClick={() => toggleDone(t)} /></span>
        <button class={`dh-date ${over ? "over" : ""} ${t.date ? "" : "unset"}`} onClick={(e) => openPop(e, () => <DatePicker t={t} />, 288)}>{dateText}</button>
        {t.repeat ? <button class="dh-ico on" title={repeatLabel(t.repeat)} aria-label="重复" onClick={(e) => openPop(e, () => <RepeatMenu t={t} />, 236, false, true)}><Icon n="repeat" /></button> : null}
        {t.remind?.length ? <span class="dh-ico on" title="有提醒"><Icon n="bell" /></span> : null}
        <button
          class="dh-ico"
          style={{ color: pColor(t.priority) }}
          aria-label="优先级"
          onClick={(e) => openPop(e, () => <Menu items={PRIORITY.map((p) => ({ label: p.label, icon: "flag", color: p.c, checked: t.priority === p.v, onClick: () => s.update(t.id, { priority: p.v }) }))} />, 170)}
        >
          <Icon n="flag" style={t.priority ? { fill: "currentColor" } : undefined} />
        </button>
        <button
          class="dh-ico"
          aria-label="更多"
          onClick={(e) => openPop(e, () => <Menu items={[
            { label: "复制", icon: "note", onClick: () => {
              const { id: _ignore, ...rest } = t;
              const id = s.create("task", { ...rest, title: `${t.title} 副本`, createdAt: Date.now(), done: false, doneAt: null });
              for (const x of list) s.create("sub", { taskId: id, title: x.title, done: false, order: x.order });
              select(id);
            } },
            { label: "删除", icon: "trash", danger: true, onClick: () => trash(t) },
          ]} />, 150)}
        >
          <Icon n="more" />
        </button>
        {onClose ? <button class="dh-ico" aria-label="关闭" onClick={onClose}><Icon n="x" /></button> : null}
      </div>
      <div class="d-scroll">
        <Editable class="d-tt" value={t.title} placeholder="标题" focusKey={ui.focusTitle} onChange={(title) => s.update(t.id, { title })} onEnter={(el) => el.blur()} />
        <div class="d-subs">
          {list.map((x, i) => (
            <SubRow
              key={x.id}
              x={x}
              focusNext={() => {
                const next = list[i + 1];
                if (next) (document.querySelectorAll(".st-t")[i + 1] as HTMLElement | undefined)?.focus();
                else addRef.current?.focus();
              }}
            />
          ))}
          <div class="st add">
            <Icon n="plus" />
            <input
              ref={addRef}
              placeholder="添加子任务"
              onKeyDown={(e) => {
                const el = e.currentTarget as HTMLInputElement;
                if (e.key === "Enter" && !e.isComposing && el.value.trim()) {
                  addSub(s, t.id, el.value.trim());
                  el.value = "";
                }
              }}
            />
          </div>
        </div>
        <Editable class="d-no" multiline value={t.notes ?? ""} placeholder="备注" onChange={(notes) => s.update(t.id, { notes })} />
        <div class="d-tags">
          {(t.tags ?? []).map((n) => (
            <button key={n} class="tag" title="移除标签" onClick={() => s.update(t.id, { tags: t.tags.filter((x) => x !== n) })}>{n}<Icon n="x" /></button>
          ))}
          <input
            class="d-tagadd"
            placeholder="添加标签"
            onKeyDown={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              const v = el.value.trim().replace(/^[#＃]/, "");
              if (e.key === "Enter" && !e.isComposing && v) {
                if (!(t.tags ?? []).includes(v)) s.update(t.id, { tags: [...(t.tags ?? []), v] });
                el.value = "";
              }
            }}
          />
        </div>
      </div>
      <div class="df">
        <button class="df-list" onClick={(e) => openPop(e, () => listMenu(t), 200)}>
          {t.listId === "inbox" ? <Icon n="inbox" /> : <i class="dot" style={{ background: color ?? "var(--mut)" }} />}
          {listName(s, t.listId)}
        </button>
        {pomo ? <span class="df-pomo"><Icon n="timer" />{pomo}</span> : null}
        <button
          class="go"
          onClick={() => {
            startFocus(t.id, t.time && t.endTime ? Math.min(durationMinutes(t), 60) : prefs(s).focusMinutes);
            go({ k: "focus" });
          }}
        >
          <Icon n="play" />开始专注
        </button>
      </div>
    </div>
  );
}
