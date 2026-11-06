// 快捷键：真实的按键分发（页面和菜单谁先拿到），以及重启后还在。
// 会弹出真实窗口，用临时数据目录，不碰你的真实数据。全局快捷键要真按键盘才会触发，这里只查有没有注册上。
//
//   npm run build:debug
//   node scripts/keys-check.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP_NAME = JSON.parse(readFileSync(join(ROOT, "mygo.json"), "utf8")).name;
const BIN = process.env.TODO_BIN || join(ROOT, `build/debug/darwin-arm64/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`);
const TMP = mkdtempSync(join(tmpdir(), "todo-keys-"));

const J = "window.__todo";
const state = `const d=await ${J}.platform.settings(); return {view:${J}.ui.view.k, addTask:d.addTask, quickAdd:d.quickAdd, focusAdd:${J}.ui.focusAdd, focusSearch:${J}.ui.focusSearch, rec:!!document.querySelector('.kb.rec'), toast:${J}.ui.toast?.text??null, focus:document.hasFocus(), active:document.activeElement?.tagName}`;
const check = (label) => ({ label, eval: state });
const key = (k, ms = 400) => [{ key: k }, { sleep: ms }];
const openSettings = { label: "打开设置", eval: `${J}.go({k:'settings'}); await new Promise(r=>setTimeout(r,80)); return true` };
const record = (name) => ({ label: `开始录制 ${name}`, eval: `document.querySelector('[data-shortcut="${name}"]').click(); await new Promise(r=>setTimeout(r,120)); return true` });

function run(label, steps) {
  const script = join(TMP, `${label}.json`);
  writeFileSync(script, JSON.stringify(steps));
  const r = spawnSync(BIN, [], {
    env: { ...process.env, TODO_SCRIPT: script, TODO_SHOW: "1", TODO_SNAP_DIR: TMP, TODO_DATA_DIR: join(TMP, "data") },
    encoding: "utf8",
    timeout: 60000,
  });
  const out = {};
  for (const line of (r.stdout || "").split("\n")) {
    const m = line.match(/^\[script\] (.+?) = (.*)$/);
    if (m) out[m[1]] = JSON.parse(m[2]);
    else if (/^\[script\]|^\[hotkey\]/.test(line)) console.log(line);
  }
  if (r.status !== 0) console.log(`${label} 退出码 ${r.status}`, (r.stderr || "").slice(-400));
  return { out, ok: r.status === 0 };
}

let bad = 0;
const expect = (name, ok, got) => {
  if (!ok) bad++;
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` 得到 ${JSON.stringify(got)}`}`);
};

const first = run("first", [
  { sleep: 600 },
  { win: "focus" },
  { sleep: 500 },
  ...key("cmd+n"),
  check("默认 ⌘N 添加任务"),
  ...key("cmd+,"),
  check("⌘, 打开设置"),
  record("addTask"),
  ...key("cmd+f"),
  check("录制时按 ⌘F"),
  ...key("esc"),
  check("Esc 取消录制"),
  record("addTask"),
  ...key("cmd+j"),
  check("录制 ⌘J"),
  { label: "回到今天", eval: `${J}.go({k:'today'}); await new Promise(r=>setTimeout(r,80)); return true` },
  ...key("cmd+n"),
  check("旧的 ⌘N 不再添加"),
  ...key("cmd+j"),
  check("新的 ⌘J 添加任务"),
  openSettings,
  record("quickAdd"),
  ...key("cmd+k"),
  check("录制全局 ⌘K"),
  { hotkeys: ["Cmd+K", "Ctrl+Alt+Space"] },
]);
const f = first.out;
expect("默认 ⌘N 添加任务", f["默认 ⌘N 添加任务"]?.focusAdd === 1, f["默认 ⌘N 添加任务"]);
expect("⌘, 打开设置", f["⌘, 打开设置"]?.view === "settings", f["⌘, 打开设置"]);
const cf = f["录制时按 ⌘F"];
// 前台是别的 App 时，窗口抢不到焦点，系统会把 ⌘ 组合键直接交给菜单，测不出页面优先。真实使用时要先点录制按钮，窗口一定在前台。
if (cf?.focus === false) console.log("跳过 录制时 ⌘F 归页面（窗口不在前台，运行时别操作其他 App）");
else expect("录制时 ⌘F 归页面，提示已占用，继续录制", cf?.focusSearch === 0 && cf?.rec === true && /搜索/.test(cf?.toast ?? ""), cf);
expect("Esc 取消录制，快捷键不变", f["Esc 取消录制"]?.rec === false && f["Esc 取消录制"]?.addTask === "Cmd+N", f["Esc 取消录制"]);
expect("录制 ⌘J 后菜单没有被触发", f["录制 ⌘J"]?.addTask === "Cmd+J" && f["录制 ⌘J"]?.view === "settings", f["录制 ⌘J"]);
expect("旧的 ⌘N 不再添加", f["旧的 ⌘N 不再添加"]?.focusAdd === 1, f["旧的 ⌘N 不再添加"]);
expect("新的 ⌘J 添加任务", f["新的 ⌘J 添加任务"]?.focusAdd === 2, f["新的 ⌘J 添加任务"]);
expect("录制全局 ⌘K", f["录制全局 ⌘K"]?.quickAdd === "Cmd+K", f["录制全局 ⌘K"]);

const second = run("second", [
  { sleep: 600 },
  { win: "focus" },
  { sleep: 500 },
  check("重启后"),
  { hotkeys: ["Cmd+K", "Ctrl+Alt+Space"] },
  ...key("cmd+j"),
  check("重启后 ⌘J"),
]);
const s = second.out;
expect("重启后设置还在", s["重启后"]?.addTask === "Cmd+J" && s["重启后"]?.quickAdd === "Cmd+K", s["重启后"]);
expect("重启后 ⌘J 还能添加任务", s["重启后 ⌘J"]?.focusAdd === 1, s["重启后 ⌘J"]);

rmSync(TMP, { recursive: true, force: true });
process.exit(bad || !first.ok || !second.ok ? 1 : 0);
