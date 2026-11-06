// 调试和截图用的示例数据，正常使用不会出现。

import { addDays, type Ymd } from "../core/dates.ts";
import { addSub, logFocus, newTask, toggleHabit, complete } from "../core/model.ts";
import type { Store } from "../core/store.ts";

export function seedDemo(s: Store, today: Ymd) {
  const work = "list-work";
  const life = "list-life";
  const study = s.create("list", { name: "学习", color: "#F09A1A", order: 3 });
  const trip = s.create("list", { name: "京都旅行", color: "#E5484D", order: 4 });

  newTask(s, { title: "续交宽带费", date: addDays(today, -1), listId: life, priority: 2 });
  newTask(s, { title: "产品周会", date: today, time: "09:30", endTime: "10:30", listId: work, notes: "议程：上周发布复盘、Q4 路线图确认。" });
  newTask(s, { title: "Q4 预算发给财务", date: today, time: "11:00", listId: work, priority: 3, tags: ["财务"], notes: "财务周五要汇总，先发初稿。" });
  const copy = newTask(s, { title: "改完发布页文案", date: today, time: "14:00", endTime: "16:00", listId: work, priority: 3, notes: "重点是首屏，三秒内要说清楚能替用户省什么。", remind: [15] });
  newTask(s, { title: "给老周回电话", date: today, time: "16:30", listId: work, priority: 2, tags: ["电话"], notes: "合同续约的事，先确认付款周期。" });
  newTask(s, { title: "取快递", date: today, time: "18:00", listId: life, priority: 1, notes: "小区南门快递柜。" });
  newTask(s, { title: "读《置身事内》第三章", date: today, time: "21:00", listId: study });
  const run = newTask(s, { title: "晨跑 5 公里", date: today, time: "07:00", listId: life });
  complete(s, run);

  const a = addSub(s, copy, "首屏标题再短一点");
  const b = addSub(s, copy, "定价表对齐新方案");
  s.update(a, { done: true });
  s.update(b, { done: true });
  addSub(s, copy, "客户案例换成三个新的");
  addSub(s, copy, "FAQ 补退款条款");
  addSub(s, copy, "给法务过一遍");

  newTask(s, { title: "跟设计过首页", date: addDays(today, 1), time: "15:00", listId: work, priority: 3 });
  newTask(s, { title: "交报销单", date: addDays(today, 1), time: "09:00", listId: work, tags: ["财务"] });
  newTask(s, { title: "买猫粮", date: addDays(today, 1), listId: life });
  newTask(s, { title: "带猫打疫苗", date: addDays(today, 2), time: "10:00", listId: life, priority: 2 });
  newTask(s, { title: "京都行程定稿", date: addDays(today, 3), listId: trip, priority: 3 });
  newTask(s, { title: "季度复盘提纲", date: addDays(today, 4), listId: work, priority: 2 });
  newTask(s, { title: "站会", date: today, time: "10:45", listId: work, repeat: { freq: "weekdays" } });
  newTask(s, { title: "还信用卡", date: addDays(today, 5), listId: life, repeat: { freq: "monthly", day: 10 } });
  newTask(s, { title: "预约年度体检", date: addDays(today, 6), listId: life, tags: ["等回复"] });
  newTask(s, { title: "订京都机票", listId: trip, priority: 2 });
  newTask(s, { title: "退掉没用的订阅" });
  newTask(s, { title: "整理照片" });
  newTask(s, { title: "看看新路由器" });

  const names = ["早起", "跑步", "阅读 30 分钟", "喝水 8 杯"];
  const pattern = ["11111111111101", "10110101101011", "01111111101110", "11101111011110"];
  names.forEach((name, i) => {
    const h = s.create("habit", { name, order: i, createdAt: Date.now() });
    [...pattern[i]!].forEach((c, j) => {
      if (c === "1") toggleHabit(s, h, addDays(today, j - 14));
    });
  });

  const start = Date.now();
  logFocus(s, copy, "改完发布页文案", today, start - 3 * 3600000, 25);
  logFocus(s, copy, "改完发布页文案", today, start - 2.4 * 3600000, 25);
  logFocus(s, null, "专注", today, start - 1 * 3600000, 25);
}
