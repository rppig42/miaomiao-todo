// 交通灯的位置：走一遍窗口的生命周期，每一步都读实际坐标，并模拟被系统放回默认位置。
// 会弹出真实窗口，用临时数据目录，不碰你的真实数据。
//
//   npm run build:debug
//   node scripts/lights-check.mjs [截图目录]
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP_NAME = JSON.parse(readFileSync(join(ROOT, "mygo.json"), "utf8")).name;
const BIN = process.env.TODO_BIN || join(ROOT, `build/debug/darwin-arm64/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`);
const INSET = 19;
const TMP = mkdtempSync(join(tmpdir(), "todo-lights-"));
const OUT = process.argv[2] || join(TMP, "shots");
mkdirSync(OUT, { recursive: true });

const at = (win, wait = 900) => [{ win }, { sleep: wait }, { lights: win }];
const steps = [
  { sleep: 800 },
  { lights: "启动" },
  { shot: "launch" },
  ...at("reset", 800),
  { shot: "healed" },
  ...at("away", 1500),
  ...at("reset", 800),
  ...at("focus", 1000),
  ...at("hide"),
  ...at("show"),
  ...at("minimize", 1200),
  ...at("restore", 1200),
  ...at("maximize", 1200),
  ...at("unmaximize", 1200),
  ...at("fullscreen", 2000),
  ...at("windowed", 2000),
  ...at("reset", 800),
  ...at("screens", 800),
];
const script = join(TMP, "script.json");
writeFileSync(script, JSON.stringify(steps));
const r = spawnSync(BIN, [], {
  env: { ...process.env, TODO_SCRIPT: script, TODO_SHOW: "1", TODO_SNAP_DIR: OUT, TODO_DATA_DIR: join(TMP, "data") },
  encoding: "utf8",
  timeout: 90000,
});

let bad = r.status === 0 ? 0 : 1;
let gap = null;
const lines = (r.stdout || "").split("\n");
for (let i = 0; i < lines.length; i++) {
  const head = lines[i].match(/^\[lights\] (\S+) window=(\S+) screen=(\S+) key=(\S+) healed=(\d+) xs=(\d+),(\d+),(\d+)/);
  if (!head) {
    if (lines[i].startsWith("[script]")) console.log(lines[i]);
    continue;
  }
  const close = lines[i + 1].match(/frame=\(([\d.]+),([\d.]+) /);
  const fullscreen = head[1] === "fullscreen";
  const [x0, x1, x2] = [Number(head[6]), Number(head[7]), Number(head[8])];
  gap ??= x1 - x0;
  // 三个按钮等距，间距不能变。全屏时按钮归系统管。
  const ok = fullscreen || (Number(close[1]) === INSET && Number(close[2]) === INSET && x1 - x0 === gap && x2 - x1 === gap);
  if (!ok) bad++;
  console.log(`${ok ? "通过" : "失败"} ${head[1].padEnd(10)} 关闭按钮 (${close[1]}, ${close[2]})  三个按钮 x=${x0},${x1},${x2}  窗口 ${head[2]} @${head[3]}  放回 ${head[5]} 次`);
}
console.log("截图目录", OUT);
if (!process.argv[2]) rmSync(TMP, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
