import { useEffect, useState } from "preact/hooks";
import { focusOn, logFocus, tasks, type Task } from "../core/model.ts";
import { prefs } from "../core/settings.ts";
import { Menu } from "./common.tsx";
import { Icon } from "./icons.tsx";
import { openPop, platform, refresh, store, ui } from "./state.ts";

type Phase = "idle" | "run" | "pause" | "break";

/** 计时状态不放在组件里：切到别的视图、关掉窗口，时间都接着走。 */
export const timer = {
  phase: "idle" as Phase,
  taskId: null as string | null,
  minutes: 25,
  endAt: 0,
  left: 25 * 60,
  startedAt: 0,
  /** 这一轮休息多长。休息中改设置不影响这一轮。 */
  breakMinutes: 5,
};

let ticker: ReturnType<typeof setInterval> | null = null;

const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

function tick() {
  if (timer.phase !== "run" && timer.phase !== "break") return;
  timer.left = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  platform().setFocusTitle(fmt(timer.left));
  if (timer.left <= 0) finish();
  refresh();
}

function ensureTicker() {
  if (!ticker) ticker = setInterval(tick, 1000);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  platform().setFocusTitle("");
}

/** 手机上提前排好通知，这里不用再发。 */
function alert(title: string, body: string) {
  if (platform().kind !== "ios") platform().notify(title, body);
}

/** 手机上 App 退到后台时页面不运行，结束的通知要提前排好。 */
function syncFocusAlerts() {
  const s = store();
  const title = (timer.taskId ? s.get<Task>(timer.taskId)?.title : null) ?? "休息一下";
  const pause = prefs(s).breakMinutes;
  const breakEnd = (at: number) => ({ id: "break-end", title: "休息结束", body: "可以开始下一个番茄了", at });
  if (timer.phase === "run") {
    platform().setFocusAlerts([{ id: "focus-end", title: "专注结束", body: title, at: timer.endAt }, breakEnd(timer.endAt + pause * 60000)]);
  } else if (timer.phase === "break") {
    platform().setFocusAlerts([breakEnd(timer.endAt)]);
  } else {
    platform().setFocusAlerts([]);
  }
}

function finish() {
  if (timer.phase === "run") {
    const s = store();
    const t = timer.taskId ? s.get<Task>(timer.taskId) : null;
    logFocus(s, timer.taskId, t?.title ?? "专注", ui.today, timer.startedAt, timer.minutes);
    alert("专注结束", t?.title ?? "休息一下");
    timer.phase = "break";
    timer.breakMinutes = prefs(s).breakMinutes;
    // 从该结束的时刻算：手机可能在后台过了很久才回来，这时休息也已经结束了。
    timer.endAt += timer.breakMinutes * 60000;
    timer.left = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    return;
  }
  alert("休息结束", "可以开始下一个番茄了");
  reset();
}

let knownFocusMinutes = 0;
/** 计时中改了专注时长，等这一轮结束再用。 */
let focusMinutesPending = false;

function useFocusMinutes(m: number) {
  timer.minutes = m;
  timer.left = m * 60;
  focusMinutesPending = false;
}

/** 设置里的专注时长变了（可能是另一台设备改的）。 */
export function syncFocusPrefs() {
  const m = prefs(store()).focusMinutes;
  if (m === knownFocusMinutes) return;
  knownFocusMinutes = m;
  if (timer.phase === "idle") useFocusMinutes(m);
  else focusMinutesPending = true;
}

function reset() {
  stopTicker();
  timer.phase = "idle";
  timer.left = timer.minutes * 60;
  if (focusMinutesPending) useFocusMinutes(knownFocusMinutes);
  syncFocusAlerts();
  refresh();
}

export function startFocus(taskId: string | null, minutes = timer.minutes) {
  timer.taskId = taskId;
  timer.minutes = minutes;
  timer.left = minutes * 60;
  timer.endAt = Date.now() + minutes * 60000;
  timer.startedAt = Date.now();
  timer.phase = "run";
  ensureTicker();
  tick();
  syncFocusAlerts();
}

function pauseResume() {
  if (timer.phase === "run") {
    timer.left = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    timer.phase = "pause";
    stopTicker();
  } else if (timer.phase === "pause") {
    timer.endAt = Date.now() + timer.left * 1000;
    timer.phase = "run";
    ensureTicker();
  }
  syncFocusAlerts();
  refresh();
}

/** 测试用：把剩余时间调成几秒。 */
export function shortenFocus(seconds: number) {
  timer.endAt = Date.now() + seconds * 1000;
  timer.left = seconds;
}

function pickTask() {
  const s = store();
  const today = ui.today;
  const open = tasks(s)
    .filter((t) => !t.done && t.date !== null && t.date <= today)
    .slice(0, 12);
  return (
    <Menu
      items={[
        { label: "不关联任务", icon: "timer", checked: !timer.taskId, onClick: () => { timer.taskId = null; refresh(); } },
        ...(open.length ? [{ sep: true, label: "" }] : []),
        ...open.map((t) => ({ label: t.title, checked: timer.taskId === t.id, onClick: () => { timer.taskId = t.id; refresh(); } })),
      ]}
    />
  );
}

export function FocusLog() {
  const s = store();
  const today = focusOn(s, ui.today);
  const mins = today.reduce((a, b) => a + b.minutes, 0);
  return (
    <aside class="detail f-log">
      <div class="dh" />
      <div class="f-sum"><div><b>{today.length}</b><span>番茄</span></div><div><b>{mins >= 60 ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}` : mins}</b><span>{mins >= 60 ? "小时" : "分钟"}</span></div></div>
      <div class="f-items">
        {today.map((f) => {
          const d = new Date(f.startedAt);
          return <div key={f.id} class="f-item"><span>{`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`}</span><p>{f.title}</p><em>{f.minutes}′</em></div>;
        })}
      </div>
    </aside>
  );
}

export function FocusView() {
  const s = store();
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const t = timer.taskId ? s.get<Task>(timer.taskId) : null;
  const total = (timer.phase === "break" ? timer.breakMinutes : timer.minutes) * 60;
  const R = 150;
  const C = 2 * Math.PI * R;
  const idle = timer.phase === "idle";
  return (
    <div class="focus">
      <div class="f-mid">
        <button class="f-task" disabled={timer.phase === "break"} onClick={(e) => openPop(e, pickTask, 280)}>
          {timer.phase === "break" ? "休息一下" : (t?.title ?? "选择任务")}
          {timer.phase === "break" ? null : <Icon n="right" style={{ transform: "rotate(90deg)" }} />}
        </button>
        <div class="f-ring">
          <svg viewBox="0 0 340 340">
            <circle cx="170" cy="170" r={R} class="f-track" />
            <circle cx="170" cy="170" r={R} class={`f-prog ${timer.phase === "break" ? "brk" : ""}`} stroke-dasharray={C} stroke-dashoffset={C * (1 - timer.left / total)} transform="rotate(-90 170 170)" />
          </svg>
          <b>{fmt(timer.left)}</b>
        </div>
        {idle ? (
          <div class="f-dur">
            {[...new Set([15, 25, 45, 60, prefs(s).focusMinutes])].sort((a, b) => a - b).map((m) => (
              <button key={m} class={timer.minutes === m ? "on" : ""} onClick={() => { timer.minutes = m; timer.left = m * 60; refresh(); }}>{m}</button>
            ))}
          </div>
        ) : <div class="f-dur" />}
        <div class="f-act">
          {idle ? (
            <button class="go big" onClick={() => startFocus(timer.taskId)}><Icon n="play" />开始</button>
          ) : timer.phase === "break" ? (
            <button class="ghost big" onClick={reset}>跳过休息</button>
          ) : (
            <>
              <button class="go big" onClick={pauseResume}><Icon n={timer.phase === "run" ? "pause" : "play"} />{timer.phase === "run" ? "暂停" : "继续"}</button>
              <button class="ghost big" onClick={reset}>放弃</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
