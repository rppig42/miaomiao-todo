// 在真实的 WKWebView 里跑界面：Chrome 通过不代表这里也行。
// 用临时数据目录，不碰你的真实数据；窗口不显示、不抢焦点。
//
//   npm run build:debug
//   node scripts/wk-check.mjs [截图目录]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP_NAME = JSON.parse(readFileSync(join(ROOT, "mygo.json"), "utf8")).name;
const BIN = process.env.TODO_BIN || join(ROOT, `build/debug/darwin-arm64/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`);
if (!existsSync(BIN)) throw new Error("先运行 npm run build:debug");

const TMP = mkdtempSync(join(tmpdir(), "todo-wk-"));
const OUT = process.argv[2] || join(TMP, "shots");
mkdirSync(OUT, { recursive: true });

const J = "window.__todo";
const ev = (label, code) => ({ label, eval: code });
const snap = (name) => [{ sleep: 350 }, { snap: name }];
const wait = (ms = 60) => `await new Promise(r=>setTimeout(r,${ms}));`;
const go = (v) => `${J}.go(${JSON.stringify(v)}); ${wait()}`;
const rowBy = (title) => `[...document.querySelectorAll('.t')].find(r=>r.querySelector('.tt')?.textContent===${JSON.stringify(title)})`;
const type = (sel, text) => `{const el=document.querySelector(${JSON.stringify(sel)});el.focus();el.value=${JSON.stringify(text)};el.dispatchEvent(new InputEvent('input',{bubbles:true}));}`;
const enter = (sel) => `document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`;

const seg = (row, text) => `[...[...document.querySelectorAll('.set-r')].find(r=>r.firstChild.textContent===${JSON.stringify(row)}).querySelectorAll('.seg button')].find(b=>b.textContent===${JSON.stringify(text)}).click();`;
const toggle = (row) => `[...document.querySelectorAll('.set-r')].find(r=>r.firstChild.textContent===${JSON.stringify(row)}).querySelector('.sw').click();`;
const select = (pref, value) => `{const el=document.querySelector('[data-pref=${pref}]'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true}));}`;
const num = (i, value) => `{const el=document.querySelectorAll('.set-num')[${i}]; el.focus(); el.value=${JSON.stringify(value)}; el.dispatchEvent(new FocusEvent('blur'));}`;
const record = (name) => `document.querySelector('[data-shortcut=${name}]').click(); ${wait(120)}`;
const press = (init) => `window.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ bubbles: true, cancelable: true, ...init })}));`;

const steps = [
  // 截图拿不到窗口后面的系统材质，WK_BG=1 时铺一张彩色底，用来看半透明层次。
  ...(process.env.WK_BG ? [ev("彩色底", `document.documentElement.style.background='radial-gradient(60% 60% at 6% 8%,#8fd0f7 0,transparent 100%),radial-gradient(60% 60% at 96% 14%,#fbc4ae 0,transparent 100%),radial-gradient(70% 60% at 22% 90%,#a9e7d2 0,transparent 100%),radial-gradient(60% 60% at 90% 90%,#aec1fd 0,transparent 100%),#e6edf6'; return true`)] : []),
  ev("平台", `return document.documentElement.className`),
  ev("窗口标题", `return document.title`),
  { native: true },
  ev("没有 iCloud 权限时不启动同步", `return ${J}.ui.sync.enabled`),
  ...snap("01-empty"),
  ev("灌示例数据", `await ${J}.seed(); return ${J}.store.docs.size`),
  ...snap("02-today"),
  ev("选中任务看详情", `${rowBy("改完发布页文案")}.click(); await new Promise(r=>setTimeout(r,100)); return document.querySelector('.d-tt').value + ' / ' + document.querySelectorAll('.st:not(.add)').length`),
  ...snap("03-detail"),
  ev("快捷添加高亮", `${type(".m-qa textarea", "明天下午3点 跟设计过首页 !高 #工作 #重要")} await new Promise(r=>setTimeout(r,100)); return [...document.querySelectorAll('.m-qa .nl-m span')].map(s=>s.className+':'+s.textContent).join(' | ')+' // '+[...document.querySelectorAll('.m-qa .chip')].map(c=>c.textContent).join(',')`),
  ...snap("04-quickadd"),
  ev("取消识别一项", `document.querySelector('.m-qa .chip.k-priority').click(); await new Promise(r=>setTimeout(r,60)); return [...document.querySelectorAll('.m-qa .chip')].map(c=>c.textContent).join(',')`),
  ev("回车添加", `const n=${J}.store.all('task').length; ${enter(".m-qa textarea")}; await new Promise(r=>setTimeout(r,60)); const t=${J}.store.all('task').find(t=>t.title.includes('跟设计过首页 !高')); return [${J}.store.all('task').length-n, t?.title, t?.date, t?.time, t?.listId, JSON.stringify(t?.tags), document.querySelector('.m-qa textarea').value]`),
  ev("勾选完成并撤销", `const r=${rowBy("取快递")}; r.querySelector('.ck').click(); await new Promise(r=>setTimeout(r,60)); const a=${J}.store.all('task').find(t=>t.title==='取快递').done; const toast=document.querySelector('.toast span')?.textContent; document.querySelector('.toast button').click(); await new Promise(r=>setTimeout(r,60)); return [a, toast, ${J}.store.all('task').find(t=>t.title==='取快递').done]`),
  ev("打开日期选择", `${rowBy("改完发布页文案")}.click(); await new Promise(r=>setTimeout(r,60)); document.querySelector('.dh-date').click(); await new Promise(r=>setTimeout(r,60)); return !!document.querySelector('.dp')`),
  ...snap("05-datepicker"),
  ev("关闭弹层", `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); ${J}.ui.pop=null; ${J}.refresh(); return true`),
  ev("明天", `${go({ k: "tomorrow" })} return document.querySelector('.mh h1').textContent`),
  ...snap("06-tomorrow"),
  ev("最近 7 天", `${go({ k: "week" })} return document.querySelectorAll('.g').length`),
  ...snap("07-week"),
  ev("清单", `${go({ k: "list", id: "list-work" })} return document.querySelector('.mh h1').textContent`),
  ...snap("08-list"),
  ev("日历", `${go({ k: "calendar" })} return document.querySelectorAll('.cc').length`),
  ...snap("09-calendar"),
  ev("拖任务到别的日期（合成事件）", `const chip=document.querySelector('.cc.today .chipt'); const title=chip.textContent; const id=${J}.store.all('task').find(t=>t.title===title).id; const dt=new DataTransfer(); dt.setData('text/x-task',id); const target=document.querySelector('.cc.today').nextElementSibling; target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})); return [title, ${J}.store.get(id).date===target.dataset.day]`),
  ev("四象限", `${go({ k: "matrix" })} return [...document.querySelectorAll('.q h3 em')].map(e=>e.textContent)`),
  ...snap("10-matrix"),
  ev("专注", `${go({ k: "focus" })} return document.querySelector('.f-ring b').textContent`),
  ...snap("11-focus"),
  ev("专注开始", `const id=${J}.store.all('task').find(t=>t.title==='改完发布页文案').id; ${J}.startFocus(id,25); ${J}.refresh(); await new Promise(r=>setTimeout(r,1300)); return [${J}.timer.phase, document.querySelector('.f-ring b').textContent, document.querySelector('.f-task').textContent]`),
  ...snap("12-focus-run"),
  ev("专注结束写记录", `const n=document.querySelectorAll('.f-item').length; ${J}.shortenFocus(1); await new Promise(r=>setTimeout(r,2300)); return [n, document.querySelectorAll('.f-item').length, ${J}.timer.phase]`),
  ev("习惯", `${go({ k: "habits" })} ${J}.ui.habit=${J}.store.all('habit')[0].id; ${J}.refresh(); await new Promise(r=>setTimeout(r,60)); return document.querySelectorAll('.hb-r').length`),
  ...snap("13-habits"),
  ev("习惯打卡", `const b=document.querySelector('.hb-r .hb-d.today'); const a=b.classList.contains('on'); b.click(); await new Promise(r=>setTimeout(r,60)); return [a, document.querySelector('.hb-r .hb-d.today').classList.contains('on'), document.querySelector('.hb-r .hb-s').textContent]`),
  ev("搜索", `${type(".sr input", "财务")} await new Promise(r=>setTimeout(r,60)); return [...document.querySelectorAll('.t .tt')].map(e=>e.textContent)`),
  ...snap("14-search"),
  ev("清空搜索", `const i=document.querySelector('.sr input'); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,60)); return ${J}.ui.view.k`),
  ev("删除并进垃圾桶", `${J}.select(${J}.store.all('task').find(t=>t.title==='整理照片').id); await new Promise(r=>setTimeout(r,60)); document.body.focus(); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true})); await new Promise(r=>setTimeout(r,60)); ${go({ k: "trash" })} return [...document.querySelectorAll('.t .tt')].map(e=>e.textContent)`),
  ...snap("15-trash"),
  ev("已完成", `${go({ k: "completed" })} return document.querySelectorAll('.t.done').length`),
  ...snap("16-completed"),
  ev("新建清单", `${J}.handleCommand('newList'); await new Promise(r=>setTimeout(r,60)); return !!document.querySelector('.sheet')`),
  ...snap("17-newlist"),
  ev("时间框：手输 930 变成 09:30", `${J}.ui.listEdit=null; ${go({ k: "today" })} ${rowBy("取快递")}.click(); ${wait()} document.querySelector('.dh-date').click(); ${wait()} const f=document.querySelector('.tf'); f.focus(); f.value='930'; f.blur(); ${wait()} const r=${J}.store.all('task').find(t=>t.title==='取快递').time; ${J}.ui.pop=null; ${J}.refresh(); return r`),
  ev("日历：重叠的任务并排", `${go({ k: "calendar" })} ${J}.select(null); ${J}.ui.calDay=${J}.ui.today; ${J}.refresh(); ${wait()} const rs=[...document.querySelectorAll('.ev')].map(e=>e.getBoundingClientRect()); let bad=0; rs.forEach((a,i)=>rs.slice(i+1).forEach(b=>{ if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1) bad++; })); return ['事件',rs.length,'互相盖住',bad]`),
  ...snap("18-agenda"),
  ev("四象限选中后详情顶到上沿", `${go({ k: "matrix" })} ${J}.select(${J}.store.all('task').find(t=>t.title==='改完发布页文案').id); ${wait()} return document.querySelector('.detail').getBoundingClientRect().top`),
  ...snap("19-matrix-detail"),
  ev("习惯详情顶到上沿", `${J}.select(null); ${go({ k: "habits" })} ${J}.ui.habit=${J}.store.all('habit')[0].id; ${J}.refresh(); ${wait()} return document.querySelector('.detail').getBoundingClientRect().top`),
  ...snap("20-habits"),
  ev("重复菜单：内容和设计一致", `${J}.select(null); ${go({ k: "today" })} ${rowBy("读《置身事内》第三章")}.click(); ${wait()} document.querySelector('.dh-date').click(); ${wait()} document.querySelector('.dp-val').click(); ${wait()} return [...document.querySelectorAll('.rm > .ri, .rm > .ri-w > .ri')].map(b=>b.textContent)`),
  ...snap("22-repeat-menu"),
  ev("重复菜单：子菜单", `const out={}; for (const w of document.querySelectorAll('.ri-w')) { w.dispatchEvent(new MouseEvent('mouseenter')); ${wait()} out[w.querySelector('.ri span').textContent]=[...w.querySelectorAll('.ri-sub .ri')].map(b=>b.textContent); if (w.querySelector('.ri span').textContent==='农历重复') continue; w.dispatchEvent(new MouseEvent('mouseleave')); ${wait()} } return out`),
  ...snap("23-repeat-submenu"),
  ev("选农历每年，日历上有重复图标", `document.querySelector('.ri-sub .ri:last-child').click(); ${wait()} const t=${J}.store.all('task').find(t=>t.title==='读《置身事内》第三章'); return [JSON.stringify(t.repeat), document.querySelector('.dp-val span').textContent, !!document.querySelector('.rm'), !!document.querySelector('.dp')]`),
  ev("打开自定义", `document.querySelector('.dp-val').click(); ${wait()} [...document.querySelectorAll('.rm > .ri')].find(b=>b.textContent==='自定义').click(); ${wait()} return [!!document.querySelector('.rc'), [...document.querySelectorAll('.rc-sel')[0].options].map(o=>o.textContent), [...document.querySelectorAll('.rc-sel')[1].options].map(o=>o.textContent), document.querySelectorAll('.rc input[type=checkbox]').length, document.querySelector('.rc').textContent.includes('跳过')]`),
  ev("自定义：每 2 周的周六", `const n=document.querySelector('.rc-every input'); n.focus(); n.value='2'; n.dispatchEvent(new InputEvent('input',{bubbles:true})); n.blur(); ${wait()} const days=[...document.querySelectorAll('.rc-days button')]; days[6].click(); ${wait()} days[new Date(${J}.ui.today+'T12:00').getDay()].click(); ${wait()} return [...document.querySelectorAll('.rc-days .on')].map(b=>b.textContent)`),
  ...snap("24-repeat-custom"),
  ev("自定义：单位下拉框没有被挤出去", `const a=document.querySelector('.rc').getBoundingClientRect(); const b=document.querySelector('.rc-row .rc-sel').getBoundingClientRect(); return b.right<=a.right+0.5 && b.width>80`),
  ev("自定义：切到月，显示日期", `const u=document.querySelector('.rc-row .rc-sel'); u.value='monthly'; u.dispatchEvent(new Event('change',{bubbles:true})); ${wait()} return [document.querySelectorAll('.rc-month button').length, document.querySelectorAll('.rc-days').length]`),
  ...snap("25-repeat-month"),
  ev("自定义：切回周", `const u=document.querySelector('.rc-row .rc-sel'); u.value='weekly'; u.dispatchEvent(new Event('change',{bubbles:true})); ${wait()} return document.querySelectorAll('.rc-days .on').length`),
  ev("确定", `document.querySelector('.rc-ok').click(); ${wait()} const t=${J}.store.all('task').find(t=>t.title==='读《置身事内》第三章'); return [JSON.stringify(t.repeat), t.date, document.querySelector('.dp-val span').textContent, !!document.querySelector('.rc')]`),
  ev("再打开时自定义打勾", `document.querySelector('.dp-val').click(); ${wait()} return [...document.querySelectorAll('.rm .ri.on')].map(b=>b.textContent)`),
  ev("Esc 只关上面一层", `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); ${wait()} return [!!document.querySelector('.rm'), !!document.querySelector('.dp')]`),
  ev("清除重复", `document.querySelector('.dp-x').click(); ${wait()} const t=${J}.store.all('task').find(t=>t.title==='读《置身事内》第三章'); return [t.repeat, document.querySelector('.dp-val span').textContent]`),
  ev("关闭日期面板", `${J}.ui.pop=null; ${J}.refresh(); ${wait()} return true`),
  { label: "面板输入", panel: `const el=document.querySelector('textarea'); el.focus(); el.value='明晚8点 看电影 #生活'; el.dispatchEvent(new InputEvent('input',{bubbles:true})); await new Promise(r=>setTimeout(r,120)); return [...document.querySelectorAll('.chip')].map(c=>c.textContent)` },
  { sleep: 200 },
  { panelSnap: "21-panel" },
  { label: "面板回车，交给主窗口", panel: `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true` },
  { sleep: 300 },
  ev("主窗口收到面板的任务", `const t=${J}.store.all('task').find(t=>t.title==='看电影'); return [t?.date, t?.time, !!t, document.querySelector('.toast span')?.textContent]`),
  ev("键盘：下移和空格", `${J}.ui.listEdit=null; ${go({ k: "today" })} ${J}.select(null); ${wait()} document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); await new Promise(r=>setTimeout(r,60)); return ${J}.store.get(${J}.ui.selected)?.title`),

  // ── 设置 ──
  ev("打开设置", `document.querySelector('[data-settings]').click(); ${wait()} return [document.querySelector('.mh h1').textContent, document.querySelectorAll('.set-r').length, document.querySelector('.set').scrollWidth <= document.querySelector('.set').clientWidth]`),
  ...snap("30-settings"),
  ev("切深色", `${seg("外观", "深色")} ${wait(300)} return [matchMedia('(prefers-color-scheme: dark)').matches, (await ${J}.platform.settings()).theme]`),
  ...snap("31-settings-dark"),
  ev("切浅色", `${seg("外观", "浅色")} ${wait(300)} return [matchMedia('(prefers-color-scheme: dark)').matches, (await ${J}.platform.settings()).theme]`),
  ev("跟随系统", `${seg("外观", "跟随系统")} ${wait(300)} return (await ${J}.platform.settings()).theme`),
  ev("每周开始于周一", `${seg("每周开始于", "周一")} ${wait()} ${go({ k: "calendar" })} return [document.querySelector('.cal-w span').textContent, new Date(document.querySelector('.cc').dataset.day+'T00:00').getDay(), document.querySelectorAll('.cc').length % 7]`),
  ev("每周开始于周日", `${go({ k: "settings" })} ${seg("每周开始于", "周日")} ${wait()} ${go({ k: "calendar" })} return [document.querySelector('.cal-w span').textContent, new Date(document.querySelector('.cc').dataset.day+'T00:00').getDay()]`),
  ev("回到设置", go({ k: "settings" }) + " return true"),
  ev("录制全局快速添加 ⌃⌥K", `${record("quickAdd")} ${press({ code: "KeyK", ctrlKey: true, altKey: true })} ${wait(200)} return [(await ${J}.platform.settings()).quickAdd, document.querySelector('[data-shortcut=quickAdd]').textContent]`),
  { hotkeys: ["Ctrl+Alt+K", "Ctrl+Alt+Space"] },
  ev("录制时显示正按住的修饰键", `${record("toggleWindow")} ${press({ code: "MetaLeft", metaKey: true })} ${wait()} return document.querySelector('[data-shortcut=toggleWindow]').textContent`),
  ev("单独的字母不算", `${press({ code: "KeyA" })} ${wait()} return [!!document.querySelector('.kb.rec'), (await ${J}.platform.settings()).toggleWindow]`),
  ev("和其他快捷键冲突", `${press({ code: "KeyK", ctrlKey: true, altKey: true })} ${wait()} return [${J}.ui.toast?.text, !!document.querySelector('.kb.rec'), (await ${J}.platform.settings()).toggleWindow]`),
  ev("和菜单冲突", `${press({ code: "KeyF", metaKey: true })} ${wait()} return [${J}.ui.toast?.text, !!document.querySelector('.kb.rec')]`),
  ev("Esc 取消录制", `${press({ code: "Escape", key: "Escape" })} ${wait()} return [!!document.querySelector('.kb.rec'), document.querySelector('[data-shortcut=toggleWindow]').textContent]`),
  ev("录制全局显示窗口", `${record("toggleWindow")} ${press({ code: "KeyM", ctrlKey: true, shiftKey: true })} ${wait(200)} return (await ${J}.platform.settings()).toggleWindow`),
  { hotkeys: ["Ctrl+Shift+M"] },
  ev("× 清除", `document.querySelector('[aria-label="清除全局显示或隐藏窗口"]').click(); ${wait(200)} return [(await ${J}.platform.settings()).toggleWindow, document.querySelector('[data-shortcut=toggleWindow]').textContent]`),
  { hotkeys: ["Ctrl+Shift+M"] },
  ev("恢复默认", `[...document.querySelectorAll('.set h6 .lnk')].find(b=>b.textContent==='恢复默认').click(); ${wait(300)} const d=await ${J}.platform.settings(); return [d.quickAdd, d.toggleWindow, d.addTask]`),
  { hotkeys: ["Ctrl+Alt+Space", "Ctrl+Alt+K"] },
  ev("关菜单栏图标", `${toggle("菜单栏图标")} ${wait(200)} return (await ${J}.platform.settings()).tray`),
  { hotkeys: ["Ctrl+Alt+Space"] },
  ev("开菜单栏图标", `${toggle("菜单栏图标")} ${wait(200)} return (await ${J}.platform.settings()).tray`),
  { hotkeys: ["Ctrl+Alt+Space"] },
  ev("Dock 数字开关", `${toggle("Dock 图标显示今天的待办数")} ${wait(200)} const a=(await ${J}.platform.settings()).badge; ${toggle("Dock 图标显示今天的待办数")} ${wait(200)} return [a,(await ${J}.platform.settings()).badge]`),
  ev("开机启动在测试里不动系统", `${toggle("开机时启动")} ${wait(200)} const a=(await ${J}.platform.settings()).openAtLogin; ${toggle("开机时启动")} ${wait(200)} return [a,(await ${J}.platform.settings()).openAtLogin]`),
  ev("默认清单和日期", `${select("defaultList", "list-work")} ${seg("默认日期", "明天")} ${select("defaultRemind", "15")} ${wait()} const p=${J}.prefs(); return [p.defaultList,p.defaultDate,p.defaultRemind]`),
  { label: "面板输入", panel: `const t=document.querySelector('textarea'); t.value='设置默认值测试 15点'; t.dispatchEvent(new InputEvent('input',{bubbles:true})); return true` },
  { sleep: 100 },
  { label: "面板回车", panel: `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true` },
  { sleep: 400 },
  ev("面板添加的任务用了默认值", `const t=${J}.store.all('task').find(t=>t.title==='设置默认值测试'); return [t?.listId,t?.date===${J}.ui.today?null:t?.date>${J}.ui.today,t?.remind]`),
  ev("四象限的不紧急不受默认日期影响", `${go({ k: "matrix" })} const el=document.querySelector('[data-q="4"] textarea'); el.focus(); el.value='不紧急测试'; el.dispatchEvent(new InputEvent('input',{bubbles:true})); ${wait()} el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); ${wait()} const t=${J}.store.all('task').find(t=>t.title==='不紧急测试'); return [t?.date, !!document.querySelector('[data-q="4"]').textContent.includes('不紧急测试')]`),
  ev("专注时长", `${go({ k: "settings" })} ${num(0, "30")} ${num(1, "2")} ${wait()} const p=${J}.prefs(); return [p.focusMinutes,p.breakMinutes,${J}.timer.phase,${J}.timer.minutes]`),
  ev("这一轮结束后用新时长", `${go({ k: "focus" })} document.querySelector('.ghost.big')?.click(); ${wait()} return [${J}.timer.phase,${J}.timer.minutes,${J}.timer.left,...document.querySelectorAll('.f-dur button')].map(b=>b.textContent?b.textContent+(b.classList.contains('on')?'*':''):b)`),
  ev("空闲时改时长马上生效", `${go({ k: "settings" })} ${num(0, "35")} ${wait()} const a=[${J}.timer.minutes,${J}.timer.left]; ${num(0, "30")} ${wait()} return [...a,${J}.timer.minutes]`),
  ev("专注页多一个 30", `${go({ k: "focus" })} return [...document.querySelectorAll('.f-dur button')].map(b=>b.textContent+(b.classList.contains('on')?'*':''))`),
  ev("休息按设置的时长", `${J}.startFocus(null); ${J}.shortenFocus(1); await new Promise(r=>setTimeout(r,2200)); return [${J}.timer.phase, ${J}.timer.breakMinutes, ${J}.timer.left<=120&&${J}.timer.left>100]`),
  ev("超出范围夹回来", `document.querySelector('.ghost.big').click(); ${go({ k: "settings" })} ${num(0, "999")} ${wait()} return ${J}.prefs().focusMinutes`),
  ev("全天提醒时间", `const t=document.querySelector('.set-time input'); t.focus(); t.value='830'; t.dispatchEvent(new FocusEvent('blur')); ${wait()} const a=${J}.prefs().allDayAt; t.focus(); t.value=''; t.dispatchEvent(new FocusEvent('blur')); ${wait()} return [a,${J}.prefs().allDayAt,t.value]`),
  ev("设置进了同步文档", `const d=JSON.parse(${J}.serialize()).docs.find(d=>d.id==='settings'); return [d?.kind, Object.keys(d?.f??{}).sort().join(',')]`),
  ev("设置页按 ⌘N 回到今天", `${J}.handleCommand('add'); ${wait()} return ${J}.ui.view.k`),
];

const scriptPath = join(TMP, "script.json");
writeFileSync(scriptPath, JSON.stringify(steps));
const r = spawnSync(BIN, [], { env: { ...process.env, TODO_SCRIPT: scriptPath, TODO_SNAP_DIR: OUT, TODO_DATA_DIR: join(TMP, "data") }, encoding: "utf8", timeout: 120000 });
console.log(r.stdout);
if (r.stderr) console.error(r.stderr.split("\n").filter((l) => !/^\s*$/.test(l)).slice(0, 20).join("\n"));
console.log("截图目录", OUT, "退出码", r.status);
if (!process.argv[2]) rmSync(TMP, { recursive: true, force: true });
process.exit(r.status ?? 1);
