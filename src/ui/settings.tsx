import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { lists } from "../core/model.ts";
import { DEFAULT_PREFS, prefs, setPrefs, type Prefs } from "../core/settings.ts";
import { accelFromEvent, conflictOf, heldLabel, shortcutLabel } from "../core/shortcut.ts";
import type { DeviceSettings, ShortcutName } from "../platform/types.ts";
import { REMINDS, TimeField } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { platform, refresh, store, toast, ui } from "./state.ts";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 先改界面，系统没答应再改回来。 */
async function changeDevice(patch: Partial<DeviceSettings>, apply: () => Promise<unknown>) {
  const before = ui.device;
  ui.device = { ...before, ...patch };
  refresh();
  try {
    await apply();
  } catch (e) {
    ui.device = before;
    refresh();
    toast(messageOf(e));
  }
}

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="set-r">
      <span>{label}</span>
      <div class="set-v">{children}</div>
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="seg">
      {options.map((o) => (
        <button key={String(o.v)} class={o.v === value ? "on" : ""} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button class={`sw ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function NumField({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = String(value);
  }, [value]);
  const commit = () => {
    const el = ref.current!;
    const n = Number(el.value);
    const v = el.value && n ? Math.min(max, Math.max(min, n)) : value;
    el.value = String(v);
    if (v !== value) onChange(v);
  };
  return (
    <input
      ref={ref}
      class="set-num"
      defaultValue={String(value)}
      inputMode="numeric"
      spellcheck={false}
      onInput={(e) => {
        const el = e.currentTarget as HTMLInputElement;
        el.value = el.value.replace(/\D/g, "").slice(0, 3);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

const SHORTCUTS: { name: ShortcutName; label: string }[] = [
  { name: "quickAdd", label: "全局快速添加" },
  { name: "toggleWindow", label: "全局显示或隐藏窗口" },
  { name: "addTask", label: "窗口内添加任务" },
];

function ShortcutRow({ name, label }: { name: ShortcutName; label: string }) {
  const value = ui.device[name];
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState("");
  const [shake, setShake] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const p = platform();
    p.pauseShortcuts(true);
    const stop = () => {
      setRecording(false);
      setHeld("");
    };
    let saving = false;
    const onKey = (e: KeyboardEvent) => {
      // 抢在菜单和页面的其他快捷键前面。
      e.preventDefault();
      e.stopPropagation();
      if (saving) return;
      setHeld(heldLabel(e));
      if (e.type !== "keydown" || e.repeat) return;
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        stop();
        return;
      }
      const accel = accelFromEvent(e);
      if (!accel) {
        // 单按修饰键是还没按完；不带修饰键的普通键不能用。
        if (!/^(Meta|Control|Alt|Shift|CapsLock|Fn)/.test(e.code)) setShake(true);
        return;
      }
      if (accel === value) {
        stop();
        return;
      }
      const others = SHORTCUTS.filter((x) => x.name !== name).map((x) => ({ label: x.label, accel: ui.device[x.name] }));
      const clash = conflictOf(accel, others);
      if (clash) {
        toast(`${shortcutLabel(accel)} 已用于“${clash}”`);
        setShake(true);
        return;
      }
      saving = true;
      // 存完再结束录制：结束时会恢复全局快捷键，不能和这次修改同时进行。
      void changeDevice({ [name]: accel }, () => p.setShortcut(name, accel)).finally(stop);
    };
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) stop();
    };
    addEventListener("keydown", onKey, true);
    addEventListener("keyup", onKey, true);
    addEventListener("pointerdown", onPointer, true);
    addEventListener("blur", stop);
    return () => {
      removeEventListener("keydown", onKey, true);
      removeEventListener("keyup", onKey, true);
      removeEventListener("pointerdown", onPointer, true);
      removeEventListener("blur", stop);
      p.pauseShortcuts(false);
    };
  }, [recording, value]);

  return (
    <Row label={label}>
      <button
        ref={ref}
        class={`kb ${recording ? "rec" : ""} ${value || recording ? "" : "none"} ${shake ? "shake" : ""}`}
        data-shortcut={name}
        onAnimationEnd={() => setShake(false)}
        onClick={() => setRecording(!recording)}
      >
        {recording ? held || "按下快捷键" : value ? shortcutLabel(value) : "未设置"}
      </button>
      {value && !recording ? (
        <button class="dp-x" aria-label={`清除${label}`} onClick={() => void changeDevice({ [name]: "" }, () => platform().setShortcut(name, ""))}><Icon n="x" /></button>
      ) : <span class="dp-x" />}
    </Row>
  );
}

function syncText(): string {
  const y = ui.sync;
  if (!y.enabled) return "未连接";
  switch (y.state) {
    case "idle":
      return "已同步";
    case "syncing":
      return "同步中";
    case "offline":
      return "离线";
    case "noAccount":
      return "未登录 iCloud";
    case "error":
      return y.message ?? "同步失败";
    case "off":
      return "未连接";
  }
}

export function SettingsView() {
  const s = store();
  const d = ui.device;
  const p = prefs(s);
  const set = (patch: Partial<Prefs>) => setPrefs(s, patch);
  const mac = platform().kind !== "ios";
  return (
    <div class="set">
      <div class="set-in">
        <h6>通用</h6>
        <div class="set-c">
          <Row label="外观">
            <Seg
              value={d.theme}
              options={[{ v: "system", label: "跟随系统" }, { v: "light", label: "浅色" }, { v: "dark", label: "深色" }]}
              onChange={(theme) => void changeDevice({ theme }, () => platform().setTheme(theme))}
            />
          </Row>
          <Row label="每周开始于">
            <Seg<number> value={p.weekStart} options={[{ v: 0, label: "周日" }, { v: 1, label: "周一" }]} onChange={(v) => set({ weekStart: v as 0 | 1 })} />
          </Row>
          {mac ? (
            <Row label="开机时启动">
              <Switch on={d.openAtLogin} label="开机时启动" onChange={(on) => void changeDevice({ openAtLogin: on }, () => platform().setOpenAtLogin(on))} />
            </Row>
          ) : null}
          {mac ? (
            <Row label="菜单栏图标">
              <Switch on={d.tray} label="菜单栏图标" onChange={(on) => void changeDevice({ tray: on }, () => platform().setTray(on))} />
            </Row>
          ) : null}
          <Row label={mac ? "Dock 图标显示今天的待办数" : "App 图标显示今天的待办数"}>
            <Switch on={d.badge} label="显示今天的待办数" onChange={(on) => void changeDevice({ badge: on }, () => platform().setBadgeEnabled(on))} />
          </Row>
        </div>

        {mac ? (
          <>
            <h6>
              快捷键
              <button
                class="lnk"
                onClick={async () => {
                  try {
                    ui.device = await platform().resetShortcuts();
                    refresh();
                  } catch (e) {
                    toast(messageOf(e));
                  }
                }}
              >
                恢复默认
              </button>
            </h6>
            <div class="set-c">
              {SHORTCUTS.map((x) => <ShortcutRow key={x.name} name={x.name} label={x.label} />)}
            </div>
          </>
        ) : null}

        <h6>新任务</h6>
        <div class="set-c">
          <Row label="默认清单">
            <select class="rc-sel set-sel" data-pref="defaultList" value={p.defaultList} onChange={(e) => set({ defaultList: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="inbox">收件箱</option>
              {lists(s).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Row>
          <Row label="默认日期">
            <Seg<Prefs["defaultDate"]> value={p.defaultDate} options={[{ v: "none", label: "无" }, { v: "today", label: "今天" }, { v: "tomorrow", label: "明天" }]} onChange={(v) => set({ defaultDate: v })} />
          </Row>
          <Row label="有时间的任务默认提醒">
            <select
              class="rc-sel set-sel"
              data-pref="defaultRemind"
              value={p.defaultRemind === null ? "" : String(p.defaultRemind)}
              onChange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                set({ defaultRemind: v === "" ? null : Number(v) });
              }}
            >
              {REMINDS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
          </Row>
          <Row label="全天任务提醒时间">
            <div class="set-time"><TimeField required value={p.allDayAt} onChange={(v) => set({ allDayAt: v ?? DEFAULT_PREFS.allDayAt })} /></div>
          </Row>
        </div>

        <h6>专注</h6>
        <div class="set-c">
          <Row label="专注时长（分钟）">
            <NumField value={p.focusMinutes} min={1} max={180} onChange={(v) => set({ focusMinutes: v })} />
          </Row>
          <Row label="休息时长（分钟）">
            <NumField value={p.breakMinutes} min={1} max={60} onChange={(v) => set({ breakMinutes: v })} />
          </Row>
        </div>

        <h6>iCloud</h6>
        <div class="set-c">
          <Row label={syncText()}>
            {ui.sync.enabled ? <button class="kb" onClick={() => platform().cloudFetch()}>立即同步</button> : null}
          </Row>
        </div>
      </div>
    </div>
  );
}
