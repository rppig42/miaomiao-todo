// 更新法定假期数据：node scripts/update-holidays.mjs
// 数据来自 NateScarlet/holiday-cn（整理自国务院办公厅的通知）。每年 11 月前后公布下一年的安排，公布后跑一次、重新打包。
// 只读 JSON 数据，生成 src/core/holidays-data.ts。
import { writeFileSync } from "node:fs";

const OUT = new URL("../src/core/holidays-data.ts", import.meta.url);
const now = new Date().getFullYear();
const years = [now - 1, now, now + 1];
const entries = [];

for (const y of years) {
  const res = await fetch(`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${y}.json`);
  if (!res.ok) {
    console.log(`${y}: 没有数据（${res.status}）`);
    continue;
  }
  const v = await res.json();
  const days = Array.isArray(v.days) ? v.days : [];
  const valid = days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && typeof d.isOffDay === "boolean");
  if (!valid.length) {
    console.log(`${y}: 还没公布`);
    continue;
  }
  const off = valid.filter((d) => d.isOffDay).map((d) => d.date).sort();
  const work = valid.filter((d) => !d.isOffDay).map((d) => d.date).sort();
  console.log(`${y}: 放假 ${off.length} 天，调休上班 ${work.length} 天`);
  entries.push({ y, off, work, source: (v.papers ?? [])[0] ?? "" });
}

const list = (a) => `[${a.map((s) => JSON.stringify(s)).join(", ")}]`;
const body = entries.map((e) => `  ${e.y}: {\n    source: ${JSON.stringify(e.source)},\n    off: ${list(e.off)},\n    work: ${list(e.work)},\n  },`).join("\n");
writeFileSync(OUT, `// 由 scripts/update-holidays.mjs 生成，不要手改。\nexport const HOLIDAY_DATA: Record<number, { source: string; off: string[]; work: string[] }> = {\n${body}\n};\n`);
