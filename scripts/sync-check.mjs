// 端到端测 iCloud 同步，只写 CloudKit 开发环境，不碰生产环境的数据。
// 每个实例用自己的数据目录和同步状态，相当于一台设备：全新实例会从云端完整下载一遍，
// 旧实例用过期的版本写入会触发真实的版本冲突，最后两个实例同时在线互传。
//
//   npm run signed
//   node scripts/sync-check.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP_NAME = JSON.parse(readFileSync(join(ROOT, "mygo.json"), "utf8")).name;
const BIN = join(ROOT, `build/signed-development/darwin-arm64/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`);
if (!existsSync(BIN)) throw new Error("先运行 npm run signed");

const TMP = mkdtempSync(join(tmpdir(), "todo-sync-"));
const J = "window.__todo";
const stamp = Date.now();
const T1 = `同步测试一 ${stamp}`;
const T2 = `同步测试二 ${stamp}`;
const CID = `conflict-${stamp}`;
const NEW_TITLE = `A 改的标题 ${stamp}`;
const ev = (label, code) => ({ label, eval: code });
const task = (title) => `{title:${JSON.stringify(title)},notes:'',listId:'inbox',tags:[],priority:0,date:null,time:null,endTime:null,repeat:null,remind:[],done:false,doneAt:null,pomoEst:0,createdAt:Date.now()}`;
const has = (title) => `${J}.store.all('task').some(t=>t.title===${JSON.stringify(title)})`;
const poll = (cond) => `const n=Date.now(); if(!window.__last||n-window.__last>5000){window.__last=n; ${J}.cloudFetch();} return !!(${cond})`;
const ready = { label: "同步就绪", wait: `return ${J}.ui.sync.enabled && ${J}.ui.sync.state!=='syncing'`, timeout: 40 };
const uploaded = { label: "上传完成", wait: `return !${J}.store.hasUnpushed() && ${J}.ui.sync.state==='idle' && ${J}.ui.sync.pending===0`, timeout: 60 };
const conflictInfo = `const t=${J}.store.get(${JSON.stringify(CID)}); return t?[t.title,t.priority,t.done]:null`;

function phase(name, dataName, steps) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "script.json");
  writeFileSync(script, JSON.stringify(steps));
  const data = join(TMP, "data-" + dataName);
  console.log(`\n── ${name}`);
  return new Promise((resolve) => {
    const p = spawn(BIN, [], { env: { ...process.env, TODO_SCRIPT: script, TODO_SNAP_DIR: dir, TODO_DATA_DIR: data } });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
      process.stdout.write(String(d).split("\n").map((l) => l.slice(0, 200)).join("\n"));
    });
    p.on("exit", (code) => {
      const logFile = join(data, "cloud.log");
      if (process.env.SHOW_LOG && existsSync(logFile)) console.log(readFileSync(logFile, "utf8"));
      resolve({ code, out });
    });
  });
}

console.log(spawnSync(BIN, ["--cloud-reset-dev"], { encoding: "utf8" }).stdout.trim());

const a1 = await phase("A：全新实例，新建两条任务并上传", "a", [
  ready,
  ev("新建", `${J}.store.create('task',${task(T1)}); ${J}.store.create('task',${task("冲突任务")},${JSON.stringify(CID)}); ${J}.store.flushPush(); return true`),
  { sleep: 800 },
  uploaded,
  ev("A 状态", `return ${J}.ui.sync`),
]);

const b = await phase("B：全新实例，下载后改优先级、再加一条", "b", [
  ready,
  { label: "下载到 A 的任务", wait: poll(`${has(T1)} && ${J}.store.get(${JSON.stringify(CID)})`), timeout: 60 },
  ev("B 看到", `return [${has(T1)}, ${J}.store.get(${JSON.stringify(CID)})?.title]`),
  ev("B 改优先级，加任务", `${J}.store.update(${JSON.stringify(CID)},{priority:3}); ${J}.store.create('task',${task(T2)}); ${J}.store.flushPush(); return true`),
  { sleep: 800 },
  uploaded,
  ev("B 状态", `return ${J}.ui.sync`),
]);

const a2 = await phase("A：旧实例重开，在过期版本上改标题，触发版本冲突", "a", [
  ready,
  ev("A 改标题", `${J}.store.update(${JSON.stringify(CID)},{title:${JSON.stringify(NEW_TITLE)}}); ${J}.store.flushPush(); return true`),
  { label: "合并到 B 的优先级", wait: poll(`${J}.store.get(${JSON.stringify(CID)})?.priority===3`), timeout: 60 },
  ev("A 合并结果", conflictInfo),
  uploaded,
]);

const c = await phase("C：全新实例，检查云端的最终结果", "c", [
  ready,
  { label: "下载完整数据", wait: poll(`${has(T1)} && ${has(T2)} && ${J}.store.get(${JSON.stringify(CID)})?.priority===3 && ${J}.store.get(${JSON.stringify(CID)})?.title===${JSON.stringify(NEW_TITLE)}`), timeout: 60 },
  ev("C 最终结果", conflictInfo),
  ev("C 两条任务", `return [${has(T1)}, ${has(T2)}]`),
]);

// 两个实例同时在线：运行中也要能收到对方的新改动。
const T3 = `在线测试三 ${stamp}`;
const T4 = `在线测试四 ${stamp}`;
const [d1, d2] = await Promise.all([
  phase("D1：在线，等 D2 的任务，再回一条", "d1", [
    ready,
    { label: "收到 D2 的任务", wait: poll(has(T3)), timeout: 90 },
    ev("D1 收到", `return ${has(T3)}`),
    ev("D1 回一条", `${J}.store.create('task',${task(T4)}); ${J}.store.flushPush(); return true`),
    { sleep: 800 },
    uploaded,
    { sleep: 15000 },
  ]),
  phase("D2：在线，发任务，等 D1 回复", "d2", [
    ready,
    { sleep: 6000 },
    ev("D2 发任务", `${J}.store.create('task',${task(T3)}); ${J}.store.flushPush(); return true`),
    { sleep: 800 },
    uploaded,
    { label: "收到 D1 的回复", wait: poll(has(T4)), timeout: 90 },
    ev("D2 收到", `return ${has(T4)}`),
  ]),
]);

console.log("\n" + spawnSync(BIN, ["--cloud-reset-dev"], { encoding: "utf8" }).stdout.trim());
const failed = [a1, b, a2, c, d1, d2].some((r) => r.code || r.out.includes("失败"));
console.log(failed ? "\n结果：失败" : "\n结果：上传、完整下载、版本冲突后的字段级合并、同时在线互传都通过");
if (!process.env.KEEP) rmSync(TMP, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
