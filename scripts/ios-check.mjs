// 在 iOS 模拟器的真实 WKWebView 里走一遍手机界面，截图，并跑一遍小组件的规则。
// 用临时数据目录，不连 iCloud。
//
//   zsh scripts/ios.sh sim
//   node scripts/ios-check.mjs [截图目录]        SIM=<UDID> 指定模拟器，默认用开着的 iPhone
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const ROOT = new URL("..", import.meta.url).pathname;
const APP = join(ROOT, "ios/build/Build/Products/Debug-iphonesimulator/Todo.app");
const BUNDLE = "com.rppig42.todo";
const TMP = mkdtempSync(join(tmpdir(), "todo-ios-"));
const SHOTS = process.argv[2] || join(TMP, "shots");
const HANDSHAKE = join(TMP, "handshake");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(HANDSHAKE, { recursive: true });

const sh = (args) => {
  const r = spawnSync("xcrun", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`xcrun ${args.join(" ")} 失败：${(r.stderr || r.stdout).slice(-1500)}`);
  return r.stdout;
};
const booted = JSON.parse(sh(["simctl", "list", "devices", "booted", "-j"]));
const SIM = process.env.SIM || Object.values(booted.devices).flat().find((d) => d.name.startsWith("iPhone"))?.udid;
if (!SIM) throw new Error("没有开着的 iPhone 模拟器");

const J = "window.__todo";
const wait = (ms = 80) => `await new Promise(r=>setTimeout(r,${ms}));`;
const ev = (label, code) => ({ label, eval: code });
const snap = (name) => [{ sleep: 450 }, { snap: name }];
const click = (sel) => `document.querySelector(${JSON.stringify(sel)}).click();`;
const tab = (k) => `${click(`[data-tab=${k}]`)} ${wait()}`;
const rowBy = (title) => `[...document.querySelectorAll('.t')].find(r=>r.querySelector('.tt')?.textContent===${JSON.stringify(title)})`;
const overflow = `document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.t,.set-r,.m-tabs,.m-h')].every(e=>e.getBoundingClientRect().right<=innerWidth+0.5)`;
const type = (text) => `{const el=document.querySelector('.m-sheet textarea'); el.value=${JSON.stringify(text)}; el.dispatchEvent(new InputEvent('input',{bubbles:true}));}`;

const phone = (dark) => {
  const tag = dark ? "dark" : "light";
  return [
    ev("平台", `return [document.documentElement.className, innerWidth, innerHeight]`),
    ev("灌示例数据", `await ${J}.seed(); ${wait(200)} return ${J}.store.all('task').length`),
    ...snap(`${tag}-01-today`),
    ev("今天没有横向溢出", `return ${overflow}`),
    ev("点开任务", `${rowBy("改完发布页文案")}.click(); ${wait()} return [!!document.querySelector('.m-over .detail'), document.querySelector('.d-tt').value]`),
    ...snap(`${tag}-02-detail`),
    ev("日期面板", `${click(".dh-date")} ${wait()} return !!document.querySelector('.pop .dp')`),
    ...snap(`${tag}-03-date`),
    ev("重复菜单", `${click(".dp-val")} ${wait()} return [...document.querySelectorAll('.rm > .ri, .rm .ri-w .ri')].map(b=>b.firstChild.textContent)`),
    ev("点开工作日子菜单", `[...document.querySelectorAll('.rm .ri-w .ri')][0].click(); ${wait()} return [...document.querySelectorAll('.ri-sub .ri')].map(b=>b.firstChild.textContent)`),
    ...snap(`${tag}-04-repeat`),
    ev("关闭详情", `${J}.ui.pop=null; ${J}.ui.pop2=null; ${J}.refresh(); ${wait()} ${click('.dh-ico[aria-label="关闭"]')} ${wait()} return !!document.querySelector('.m-over')`),
    ev("打开新建面板", `${click(".m-fab")} ${wait(200)} return [!!document.querySelector('.m-sheet'), document.activeElement?.tagName]`),
    ev("打字", `${type("明天下午3点 跟设计过首页 !高 #工作")} ${wait()} return [...document.querySelectorAll('.m-sheet .nl-c .chip')].map(c=>c.textContent)`),
    ...snap(`${tag}-05-add`),
    ev("标签填进输入框", `[...document.querySelectorAll('.m-tok .chip')].find(c=>c.textContent==='后天').click(); ${wait()} return document.querySelector('.m-sheet textarea').value`),
    ev("发送", `${type("跟设计过首页 明天15点 !高 #工作")} ${wait()} ${click(".m-send")} ${wait(120)} const t=${J}.store.all('task').find(t=>t.title==='跟设计过首页'); return [t?.priority, t?.time, !!t?.listId, document.querySelector('.m-sheet textarea').value]`),
    ev("关闭面板", `${click(".m-scrim")} ${wait()} return !!document.querySelector('.m-sheet')`),
    ev("抽屉", `${click("[data-drawer]")} ${wait()} return [...document.querySelectorAll('.m-drawer a.l')].length>5`),
    ...snap(`${tag}-06-drawer`),
    ev("去清单", `[...document.querySelectorAll('.m-drawer a.l')].find(a=>a.textContent.startsWith('工作')).click(); ${wait()} return [${J}.ui.view.k, !!document.querySelector('.m-drawer'), document.querySelector('.m-h h1').textContent]`),
    ...snap(`${tag}-07-list`),
    ev("日历", `${tab("calendar")} return [document.querySelectorAll('.m-mo button').length%7, !!document.querySelector('.agenda')]`),
    ...snap(`${tag}-08-calendar`),
    ev("四象限", `${tab("matrix")} return document.querySelectorAll('.q').length`),
    ...snap(`${tag}-09-matrix`),
    ev("专注", `${tab("focus")} return !!document.querySelector('.f-ring')`),
    ...snap(`${tag}-10-focus`),
    ev("习惯", `${J}.go({k:'habits'}); ${wait()} return !!document.querySelector('.hb')`),
    ...snap(`${tag}-11-habits`),
    ev("设置", `${J}.go({k:'settings'}); ${wait()} return [[...document.querySelectorAll('.set h6')].map(h=>h.firstChild.textContent), [...document.querySelectorAll('.set-r > span')].map(s=>s.textContent)]`),
    ev("设置没有横向溢出", `return ${overflow}`),
    ...snap(`${tag}-12-settings`),
    ev("长按任务", `${tab("today")} const r=${rowBy("取快递")}; const t=new Touch({identifier:1,target:r,clientX:100,clientY:r.getBoundingClientRect().top+10}); r.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[t],changedTouches:[t]})); await new Promise(r=>setTimeout(r,560)); r.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[t]})); r.click(); ${wait()} return [!!document.querySelector('.pop .menu'), !!document.querySelector('.m-over')]`),
    ...snap(`${tag}-13-menu`),
    ev("关闭菜单", `${J}.ui.pop=null; ${J}.refresh(); return true`),
    ev("勾选完成并撤销", `const before=${J}.store.all('task').filter(t=>t.done).length; ${rowBy("取快递")}.querySelector('.ck').click(); ${wait()} const a=${J}.store.all('task').filter(t=>t.done).length; document.querySelector('.toast button').click(); ${wait()} return [a-before, ${J}.store.all('task').filter(t=>t.done).length-before]`),
    ev("命令打开任务", `const id=${J}.store.all('task').find(t=>t.title==='取快递').id; window.__todoNative.command('open:'+id); ${wait()} const on=!!document.querySelector('.m-over'); ${J}.select(null); return on`),
    ev("命令添加", `window.__todoNative.command('add'); ${wait()} const on=!!document.querySelector('.m-sheet'); ${J}.ui.adding=false; ${J}.refresh(); return on`),
    ev("存盘", `${J}.flush(); ${wait(200)} return true`),
  ];
};

function run(label, steps, env = {}) {
  const file = join(TMP, `${label}.json`);
  writeFileSync(file, JSON.stringify(steps));
  return new Promise((done) => {
    const p = spawn("xcrun", ["simctl", "launch", "--console-pty", "--terminate-running-process", SIM, BUNDLE], {
      env: { ...process.env, SIMCTL_CHILD_TODO_SCRIPT: file, SIMCTL_CHILD_TODO_DATA_DIR: join(TMP, "data"), SIMCTL_CHILD_TODO_SNAP_DIR: HANDSHAKE, ...env },
    });
    let failed = false;
    readline.createInterface({ input: p.stdout }).on("line", (line) => {
      const s = line.match(/^\[snap\] (.+)$/);
      if (s) {
        sh(["simctl", "io", SIM, "screenshot", join(SHOTS, `${s[1].trim()}.png`)]);
        writeFileSync(join(HANDSHAKE, `${s[1].trim()}.done`), "");
      } else if (/^\[(script|widget)\]/.test(line)) {
        console.log(line);
        if (line.includes("失败")) failed = true;
      }
    });
    p.on("close", () => done(!failed));
  });
}

function widgets() {
  return new Promise((done) => {
    const p = spawn("xcrun", ["simctl", "launch", "--console-pty", "--terminate-running-process", SIM, BUNDLE], {
      env: { ...process.env, SIMCTL_CHILD_TODO_DATA_DIR: join(TMP, "data"), SIMCTL_CHILD_TODO_WIDGET_SNAP: SHOTS },
    });
    let failed = false;
    readline.createInterface({ input: p.stdout }).on("line", (line) => {
      if (/^\[widget\]/.test(line)) {
        console.log(line);
        if (line.includes("失败")) failed = true;
      }
    });
    p.on("close", () => done(!failed));
  });
}

if (!existsSync(APP)) throw new Error("先运行 zsh scripts/ios.sh sim");
sh(["simctl", "install", SIM, APP]);
const appearance = spawnSync("xcrun", ["simctl", "ui", SIM, "appearance"], { encoding: "utf8" }).stdout.trim() || "light";
sh(["simctl", "ui", SIM, "appearance", "light"]);
let ok = await run("light", phone(false));
ok = (await widgets()) && ok;
rmSync(join(TMP, "data"), { recursive: true, force: true });
sh(["simctl", "ui", SIM, "appearance", "dark"]);
ok = (await run("dark", phone(true))) && ok;
sh(["simctl", "ui", SIM, "appearance", appearance === "dark" ? "dark" : "light"]);
spawnSync("xcrun", ["simctl", "terminate", SIM, BUNDLE]);
console.log("截图目录", SHOTS, ok ? "全部执行完" : "有失败");
if (!process.argv[2]) rmSync(TMP, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
