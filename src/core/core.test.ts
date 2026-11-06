import assert from "node:assert/strict";
import { test } from "node:test";
import { isLegalHoliday, isLegalWorkday, lunarDayName, lunarMonthName, lunarOf, solarOfLunar } from "./cn-calendar.ts";
import { addDays, monthCells, parseClock, weekday, weekOrder } from "./dates.ts";
import { advanceRepeat, firstOccurrence, nextOccurrence, repeatLabel, repeatPresets, sameRepeat, type Repeat } from "./repeat.ts";
import { addFromText, complete, counts, matrix, moveToQuadrant, newTask, quadrantOf, reminders, seedDefaults, setRepeat, setTime, streak, subs, addSub, toggleHabit, todayGroups, tasks, type Task } from "./model.ts";
import { num, parseNL } from "./nl.ts";
import { DEFAULT_PREFS, prefs, setPrefs } from "./settings.ts";
import { accelFromEvent, conflictOf, heldLabel, shortcutLabel } from "./shortcut.ts";
import { encodeDoc, mergeDocs, Store, type Doc, type RemoteItem } from "./store.ts";
import { api as widget, widgetData } from "./widget.ts";

// 2026-11-05 是周四。
const TODAY = "2026-11-05";
const NOW = new Date(2026, 10, 5, 9, 41);
/** TODAY 这天的几点。 */
const at = (hour: number) => new Date(2026, 10, 5, hour, 0);
const p = (s: string, extra = {}) => parseNL(s, { today: TODAY, now: NOW, lists: ["工作", "生活"], ...extra });

function makeStore(device = "a", clock?: () => number) {
  const pushed: RemoteItem[][] = [];
  const store = new Store({ save() {}, push: (i) => pushed.push(i) }, { device, clock });
  return { store, pushed };
}

test("中文数字", () => {
  assert.equal(num("三"), 3);
  assert.equal(num("十"), 10);
  assert.equal(num("十二"), 12);
  assert.equal(num("二十"), 20);
  assert.equal(num("二十五"), 25);
  assert.equal(num("两"), 2);
  assert.equal(num("15"), 15);
});

test("手输时间", () => {
  assert.equal(parseClock("9"), "09:00");
  assert.equal(parseClock("14"), "14:00");
  assert.equal(parseClock("930"), "09:30");
  assert.equal(parseClock("1430"), "14:30");
  assert.equal(parseClock("14:30"), "14:30");
  assert.equal(parseClock("14：05"), "14:05");
  assert.equal(parseClock(""), null);
  assert.equal(parseClock("25"), undefined);
  assert.equal(parseClock("12:75"), undefined);
  assert.equal(parseClock("下午"), undefined);
});

test("设计稿里的例子", () => {
  const r = p("明天下午3点 跟设计过首页 !高 #工作");
  assert.equal(r.title, "跟设计过首页");
  assert.equal(r.date, "2026-11-06");
  assert.equal(r.time, "15:00");
  assert.equal(r.priority, 3);
  assert.equal(r.list, "工作");
  assert.deepEqual(r.tags, []);
});

test("相对日期", () => {
  assert.equal(p("今天 买菜").date, TODAY);
  assert.equal(p("后天 买菜").date, "2026-11-07");
  assert.equal(p("大后天 买菜").date, "2026-11-08");
  assert.equal(p("3天后 买菜").date, "2026-11-08");
  assert.equal(p("两周后 复查").date, "2026-11-19");
  assert.equal(p("一个月后 复查").date, "2026-12-05");
});

test("星期", () => {
  assert.equal(p("周五 开会").date, "2026-11-06"); // 本周五
  assert.equal(p("周四 开会").date, TODAY); // 今天就是周四
  assert.equal(p("周一 开会").date, "2026-11-09"); // 本周一已过，算下周
  assert.equal(p("下周一 开会").date, "2026-11-09");
  assert.equal(p("下周五 开会").date, "2026-11-13");
  assert.equal(p("星期六 开会").date, "2026-11-07");
  assert.equal(p("周末 大扫除").date, "2026-11-07");
  assert.equal(p("周日 开会").date, "2026-11-08");
});

test("月日", () => {
  assert.equal(p("11月20日 交房租").date, "2026-11-20");
  assert.equal(p("十二月一号 交房租").date, "2026-12-01");
  assert.equal(p("3月1日 交房租").date, "2027-03-01"); // 今年已过
  assert.equal(p("20号 交房租").date, "2026-11-20");
  assert.equal(p("1号 交房租").date, "2026-12-01"); // 这个月已过
  assert.equal(p("下个月5号 交房租").date, "2026-12-05");
  assert.equal(p("2月30日 不存在").date, null);
});

test("时间", () => {
  assert.equal(p("下午3点半 开会").time, "15:30");
  assert.equal(p("上午十点 开会").time, "10:00");
  assert.equal(p("晚上8点20 开会").time, "20:20");
  assert.equal(p("晚上8点20分 开会").time, "20:20");
  assert.equal(p("14:30 开会").time, "14:30");
  assert.equal(p("中午12点 吃饭").time, "12:00");
  assert.equal(p("下午三点一刻 开会").time, "15:15");
  assert.equal(p("两点半 开会").time, "02:30");
  assert.equal(p("明早 跑步").time, "09:00");
  assert.equal(p("今晚 看电影").time, "20:00");
  assert.equal(p("明晚九点 看电影").time, "21:00");
  assert.equal(p("明天下午 开会").time, "15:00");
});

test("只有时间：过了算明天", () => {
  assert.equal(p("10点 开会").date, TODAY);
  assert.equal(p("上午8点 开会").date, "2026-11-06");
});

test("时间段", () => {
  const r = p("14:00-16:00 改文案");
  assert.equal(r.time, "14:00");
  assert.equal(r.endTime, "16:00");
  const s = p("下午2点到4点 改文案");
  assert.equal(s.time, "14:00");
  assert.equal(s.endTime, "16:00");
  assert.equal(s.title, "改文案");
});

test("N 小时后", () => {
  const r = p("半小时后 取外卖");
  assert.equal(r.date, TODAY);
  assert.equal(r.time, "10:11");
  assert.equal(r.title, "取外卖");
  assert.equal(p("两小时后 取外卖").time, "11:41");
});

test("重复", () => {
  assert.deepEqual(p("每天 喝水").repeat, { freq: "daily" });
  assert.equal(p("每天 喝水").date, TODAY);
  assert.deepEqual(p("工作日 站会").repeat, { freq: "weekdays" });
  assert.deepEqual(p("每周一 周报").repeat, { freq: "weekly", days: [1] });
  assert.equal(p("每周一 周报").date, "2026-11-09");
  assert.deepEqual(p("每周二、四 健身").repeat, { freq: "weekly", days: [2, 4] });
  assert.equal(p("每周二、四 健身").date, TODAY);
  assert.deepEqual(p("每月5号 还信用卡").repeat, { freq: "monthly", day: 5 });
  assert.equal(p("每月5号 还信用卡").date, TODAY);
  assert.deepEqual(p("每隔3天 浇花").repeat, { freq: "daily", every: 3 });
  assert.deepEqual(p("每年 体检").repeat, { freq: "yearly" });
  const r = p("每周一上午9点 交周报 !高");
  assert.equal(r.time, "09:00");
  assert.equal(r.title, "交周报");
});

test("优先级、清单、标签", () => {
  assert.equal(p("x !中").priority, 2);
  assert.equal(p("x ！低").priority, 1);
  assert.equal(p("x !!!").priority, 3);
  assert.equal(p("x !").priority, 1);
  const r = p("回邮件 #等回复 #财务 #生活");
  assert.deepEqual(r.tags, ["等回复", "财务"]);
  assert.equal(r.list, "生活");
  assert.equal(r.title, "回邮件");
});

test("普通句子不被误伤，取消识别后当文字", () => {
  const r = p("读《置身事内》第三章");
  assert.equal(r.title, "读《置身事内》第三章");
  assert.equal(r.date, null);
  const q = p("Q4 预算发给财务");
  assert.equal(q.title, "Q4 预算发给财务");
  assert.equal(q.date, null);
  const ig = p("明天的会议纪要", { ignored: ["明天"] });
  assert.equal(ig.title, "明天的会议纪要");
  assert.equal(ig.date, null);
});

test("标记位置和原文一致", () => {
  const s = "明天下午3点 跟设计过首页 !高 #工作";
  for (const t of p(s).tokens) assert.equal(s.slice(t.start, t.end), t.text);
  assert.deepEqual(p(s).tokens.map((t) => t.kind), ["date", "time", "priority", "list"]);
});

test("重复的下一次", () => {
  assert.equal(nextOccurrence({ freq: "daily" }, TODAY), "2026-11-06");
  assert.equal(nextOccurrence({ freq: "daily", every: 3 }, TODAY), "2026-11-08");
  assert.equal(nextOccurrence({ freq: "weekdays" }, "2026-11-06"), "2026-11-09"); // 周五到周一
  assert.equal(nextOccurrence({ freq: "weekly", days: [2, 4] }, TODAY), "2026-11-10");
  assert.equal(nextOccurrence({ freq: "monthly", day: 5 }, TODAY), "2026-12-05");
  assert.equal(nextOccurrence({ freq: "monthly", day: 31 }, "2026-11-05"), "2026-11-30");
  assert.equal(nextOccurrence({ freq: "monthly", day: 31 }, "2026-11-30"), "2026-12-31");
  assert.equal(nextOccurrence({ freq: "yearly" }, TODAY), "2027-11-05");
  assert.equal(firstOccurrence({ freq: "weekly", days: [4] }, TODAY), TODAY);
  assert.equal(repeatLabel({ freq: "weekly", days: [1, 3] }), "每周一、三");
});

test("合并：不同字段都保留，同一字段取新的，与顺序无关", () => {
  const base = (f: Record<string, unknown>, t: Record<string, string>): Doc => ({ id: "x", kind: "task", f, t });
  const a = base({ title: "A", done: false }, { title: "000000000000002.0000.a", done: "000000000000001.0000.a" });
  const b = base({ title: "旧", done: true }, { title: "000000000000001.0000.b", done: "000000000000003.0000.b" });
  const ab = mergeDocs(a, b);
  const ba = mergeDocs(b, a);
  assert.deepEqual(ab.f, { title: "A", done: true });
  assert.deepEqual(ab.t, ba.t);
  assert.deepEqual(ab.f, ba.f);
});

test("两台设备离线改同一任务，同步后结果一致", () => {
  let tick = 1000;
  const clock = () => ++tick;
  const { store: mac } = makeStore("mac", clock);
  const { store: phone } = makeStore("phone", clock);
  const id = newTask(mac, { title: "原标题" });
  phone.applyRemote([encodeDoc(mac.docs.get(id)!)]);
  mac.update(id, { title: "Mac 改的标题" });
  phone.update(id, { done: true });
  phone.update(id, { priority: 3 });
  const macDoc = encodeDoc(mac.docs.get(id)!);
  const phoneDoc = encodeDoc(phone.docs.get(id)!);
  mac.applyRemote([phoneDoc]);
  phone.applyRemote([macDoc]);
  const a = mac.get<Task>(id)!;
  const b = phone.get<Task>(id)!;
  assert.equal(a.title, "Mac 改的标题");
  assert.equal(a.done, true);
  assert.equal(a.priority, 3);
  assert.deepEqual(a, b);
});

test("合并后比云端新的会再推回去，一样的不推", () => {
  let tick = 1000;
  const { store, pushed } = makeStore("mac", () => ++tick);
  const id = newTask(store, { title: "x" });
  store.flushPush();
  assert.equal(pushed.length, 1);
  // 云端发回同样的内容：不再推。
  store.applyRemote([encodeDoc(store.docs.get(id)!)]);
  store.flushPush();
  assert.equal(pushed.length, 1);
  // 云端是旧版本：本地更新，要推回去。
  const old = JSON.parse(JSON.stringify(store.docs.get(id)!)) as Doc;
  store.update(id, { title: "新" });
  store.flushPush();
  assert.equal(pushed.length, 2);
  store.applyRemote([encodeDoc(old)]);
  store.flushPush();
  assert.equal(pushed.length, 3);
  assert.equal(store.get<Task>(id)!.title, "新");
});

test("上传冲突：合并结果一定推回去，内容相同也推", () => {
  let tick = 1000;
  const { store, pushed } = makeStore("mac", () => ++tick);
  const id = newTask(store, { title: "x" });
  store.flushPush();
  assert.equal(pushed.length, 1);
  const same = encodeDoc(store.docs.get(id)!);
  store.applyRemote([same], true);
  assert.equal(store.hasUnpushed(), true);
  store.flushPush();
  assert.equal(pushed.length, 2);
  assert.equal(store.hasUnpushed(), false);
  // 普通收到相同内容不推。
  store.applyRemote([same]);
  assert.equal(store.hasUnpushed(), false);
});

test("时钟被追上：收到更新的时间戳后，本地编辑仍然排在后面", () => {
  const { store } = makeStore("mac", () => 100);
  const id = newTask(store, { title: "x" });
  const future: Doc = { id, kind: "task", f: { title: "未来" }, t: { title: "000000000000999.0000.phone" } };
  store.applyRemote([encodeDoc(future)]);
  assert.equal(store.get<Task>(id)!.title, "未来");
  store.update(id, { title: "之后的编辑" });
  assert.equal(store.get<Task>(id)!.title, "之后的编辑");
  assert.ok(store.docs.get(id)!.t.title! > "000000000000999.0000.phone");
});

test("默认清单：新设备不会盖掉用户改过的名字，也不会复活已删除的", () => {
  let tick = 1000;
  const { store: a } = makeStore("a", () => ++tick);
  seedDefaults(a);
  a.update("list-work", { name: "公司" });
  a.remove("list-life");
  const { store: b } = makeStore("b", () => ++tick);
  seedDefaults(b);
  b.applyRemote([encodeDoc(a.docs.get("list-work")!), encodeDoc(a.docs.get("list-life")!)]);
  assert.equal(b.get<{ name: string }>("list-work")!.name, "公司");
  assert.equal(b.all("list").length, 1);
});

test("保存再读取，未推送的改动不丢", () => {
  const saved: string[] = [];
  const s = new Store({ save: (j) => saved.push(j), push() {} }, { device: "d" });
  const id = newTask(s, { title: "x" });
  s.flushSave();
  const pushed: RemoteItem[][] = [];
  const r = new Store({ save() {}, push: (i) => pushed.push(i) });
  r.load(saved.at(-1)!);
  assert.equal(r.device, "d");
  assert.equal(r.get<Task>(id)!.title, "x");
  r.flushPush();
  assert.equal(pushed[0]!.length, 1);
});

test("快捷添加用上当前视图的默认值，文字优先", () => {
  const { store } = makeStore();
  seedDefaults(store);
  const a = addFromText(store, "买牛奶", TODAY, { date: "2026-11-06", listId: "list-life" }, [], NOW)!;
  const t = store.get<Task>(a.id)!;
  assert.equal(t.date, "2026-11-06");
  assert.equal(t.listId, "list-life");
  const b = addFromText(store, "周日 大扫除 #工作", TODAY, { date: "2026-11-06", listId: "list-life" }, [], NOW)!;
  const u = store.get<Task>(b.id)!;
  assert.equal(u.date, "2026-11-08");
  assert.equal(u.listId, "list-work");
  assert.equal(addFromText(store, "明天", TODAY, {}, [], NOW), null);
});

test("有时间的任务默认准时提醒", () => {
  const { store } = makeStore();
  const a = addFromText(store, "明天下午3点 开会", TODAY, {}, [], NOW)!;
  assert.deepEqual(store.get<Task>(a.id)!.remind, [0]);
  const list = reminders(store, NOW.getTime());
  assert.equal(list.length, 1);
  assert.equal(list[0]!.title, "开会");
  assert.equal(new Date(list[0]!.at).getHours(), 15);
  store.update(a.id, { done: true });
  assert.equal(reminders(store, NOW.getTime()).length, 0);
});

test("完成重复任务：留一条记录，原任务滚到下一次，检查项重置", () => {
  const { store } = makeStore();
  const id = newTask(store, { title: "周报", date: TODAY, repeat: { freq: "weekly", days: [4] } });
  const sub = addSub(store, id, "写");
  store.update(sub, { done: true });
  complete(store, id, NOW.getTime());
  const all = tasks(store);
  assert.equal(all.length, 2);
  const open = store.get<Task>(id)!;
  assert.equal(open.done, false);
  assert.equal(open.date, "2026-11-12");
  assert.equal(subs(store, id)[0]!.done, false);
  const rec = all.find((t) => t.done)!;
  assert.equal(rec.date, TODAY);
  assert.equal(rec.repeat, null);
});

test("农历：和公布过的日期对得上", () => {
  // 春节。2027 年系统日历会算错成 2 月 7 日。
  const spring: Record<number, string> = { 2025: "2025-01-29", 2026: "2026-02-17", 2027: "2027-02-06", 2028: "2028-01-26", 2029: "2029-02-13", 2030: "2030-02-03", 2031: "2031-01-23", 2032: "2032-02-11", 2033: "2033-01-31", 2034: "2034-02-19", 2035: "2035-02-08" };
  for (const [y, d] of Object.entries(spring)) {
    assert.deepEqual(lunarOf(d), { year: Number(y), month: 1, leap: false, day: 1 }, d);
    assert.equal(solarOfLunar(Number(y), 1, 1), d);
  }
  // 国务院放假通知里的端午和中秋。
  assert.equal(solarOfLunar(2025, 5, 5), "2025-05-31");
  assert.equal(solarOfLunar(2025, 8, 15), "2025-10-06");
  assert.equal(solarOfLunar(2026, 5, 5), "2026-06-19");
  assert.equal(solarOfLunar(2026, 8, 15), "2026-09-25");
  assert.deepEqual(lunarOf(TODAY), { year: 2026, month: 9, leap: false, day: 27 });
  assert.equal(lunarOf("2026-11-09").day, 1);
  // 闰月。
  assert.deepEqual(lunarOf("2025-07-25"), { year: 2025, month: 6, leap: true, day: 1 });
  assert.equal(lunarDayName(27), "廿七");
  assert.equal(lunarDayName(1), "初一");
  assert.equal(lunarDayName(10), "初十");
  assert.equal(lunarDayName(20), "二十");
  assert.equal(lunarDayName(30), "三十");
  assert.equal(lunarMonthName(12), "腊月");
});

test("法定假期：有官方安排的年份", () => {
  assert.equal(isLegalHoliday("2026-10-01"), true);
  assert.equal(isLegalHoliday("2026-02-22"), true); // 春节连休里的周日
  assert.equal(isLegalHoliday("2026-11-05"), false);
  assert.equal(isLegalWorkday("2026-10-10"), true); // 周六调休
  assert.equal(isLegalWorkday("2026-02-14"), true); // 周六调休
  assert.equal(isLegalWorkday("2026-10-01"), false);
  assert.equal(isLegalWorkday("2026-11-06"), true);
  assert.equal(isLegalWorkday("2026-11-07"), false);
});

test("法定假期：还没公布安排的年份按法定天数算", () => {
  // 除夕到初三。
  for (const d of ["2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08"]) assert.equal(isLegalHoliday(d), true, d);
  assert.equal(isLegalHoliday("2027-02-09"), false);
  assert.equal(isLegalHoliday("2027-01-01"), true);
  assert.equal(isLegalHoliday("2027-04-05"), true); // 清明
  assert.equal(isLegalHoliday("2027-05-02"), true);
  assert.equal(isLegalHoliday("2027-10-03"), true);
  assert.equal(isLegalWorkday("2027-01-01"), false);
  assert.equal(isLegalWorkday("2027-01-04"), true);
});

test("重复：截图里的自定义规则，每 2 周的周六", () => {
  const r: Repeat = { freq: "weekly", every: 2, days: [6] };
  assert.equal(firstOccurrence(r, TODAY), "2026-11-07");
  assert.equal(nextOccurrence(r, "2026-11-07"), "2026-11-21");
  assert.equal(repeatLabel(r), "每 2 周的周六");
  assert.equal(repeatLabel({ freq: "weekly", days: [1, 3] }), "每周一、三");
  assert.equal(repeatLabel({ freq: "monthly", day: 5 }), "每月 5 日");
  assert.equal(repeatLabel({ freq: "monthly", every: 3, day: 5 }), "每 3 个月的 5 日");
});

test("重复：隔周的多个星期几", () => {
  const r: Repeat = { freq: "weekly", every: 2, days: [1, 3] };
  assert.equal(nextOccurrence(r, "2026-11-02"), "2026-11-04"); // 周一到同一周周三
  assert.equal(nextOccurrence(r, "2026-11-04"), "2026-11-16"); // 跳过一周
});

test("重复：每 N 个月、每 N 年", () => {
  assert.equal(nextOccurrence({ freq: "monthly", every: 3, day: 5 }, TODAY), "2027-02-05");
  assert.equal(nextOccurrence({ freq: "monthly", every: 2, day: 31 }, "2026-12-31"), "2027-02-28");
  assert.equal(nextOccurrence({ freq: "yearly", every: 2 }, TODAY), "2028-11-05");
});

test("重复：工作日和节假日", () => {
  assert.equal(nextOccurrence({ freq: "weekends" }, TODAY), "2026-11-07");
  assert.equal(nextOccurrence({ freq: "weekends" }, "2026-11-07"), "2026-11-08");
  // 法定工作日跳过 9 月 25 到 27 的中秋连休。
  assert.equal(nextOccurrence({ freq: "workdays" }, "2026-09-24"), "2026-09-28");
  // 调休的周日也算工作日。
  assert.equal(nextOccurrence({ freq: "workdays" }, "2026-09-19"), "2026-09-20");
  // 今年的法定假期已经过完，下一个是 2027 年元旦。
  assert.equal(nextOccurrence({ freq: "holidays" }, TODAY), "2027-01-01");
});

test("重复：农历", () => {
  assert.equal(nextOccurrence({ freq: "lunarMonthly", day: 27 }, TODAY), "2026-12-05"); // 十月初一是 11 月 9 日
  assert.equal(nextOccurrence({ freq: "lunarYearly", month: 9, day: 27 }, TODAY), "2027-10-26");
  assert.equal(firstOccurrence({ freq: "lunarMonthly", day: 27 }, TODAY), TODAY);
  // 除夕：腊月三十，小月算在月底。2026 年腊月小月，除夕是 2027-02-05（腊月廿九）。
  assert.equal(nextOccurrence({ freq: "lunarYearly", month: 12, day: 30 }, TODAY), "2027-02-05");
  // 闰月不算：2025 闰六月初一不是六月初一。
  assert.equal(nextOccurrence({ freq: "lunarYearly", month: 6, day: 1 }, "2025-06-26"), "2026-07-14");
});

test("重复：艾宾浩斯按 1、2、4、7、15、30 天复习，然后结束", () => {
  let r: Repeat = { freq: "ebbinghaus", start: TODAY, step: 0 };
  let due = TODAY;
  const seen: string[] = [];
  for (;;) {
    const next = advanceRepeat(r, due, due);
    if (!next) break;
    seen.push(next.date);
    r = next.repeat;
    due = next.date;
  }
  assert.deepEqual(seen, ["2026-11-06", "2026-11-07", "2026-11-09", "2026-11-12", "2026-11-20", "2026-12-05"]);
});

test("重复：过期后完成直接跳到今天或之后，按完成日期从完成那天算", () => {
  // 每天的任务过期 3 天，今天完成不会变成前天。
  assert.equal(advanceRepeat({ freq: "daily" }, "2026-11-02", TODAY)!.date, TODAY);
  // 今天到期今天完成，下一次是明天。
  assert.equal(advanceRepeat({ freq: "daily" }, TODAY, TODAY)!.date, "2026-11-06");
  // 提前完成，还是按到期日期往后。
  assert.equal(advanceRepeat({ freq: "daily" }, "2026-11-10", TODAY)!.date, "2026-11-11");
  // 按完成日期：每 2 周，过期完成也从今天起算。
  assert.equal(advanceRepeat({ freq: "daily", every: 14, from: "done" }, "2026-11-01", TODAY)!.date, "2026-11-19");
  assert.equal(repeatLabel({ freq: "daily", every: 14, from: "done" }), "每 14 天（按完成日期）");
});

test("重复：菜单预设从日期推出来，能认出当前选中的是哪个", () => {
  const p = repeatPresets("2026-09-05"); // 周六
  assert.deepEqual(p.weekly, { freq: "weekly", days: [6] });
  assert.deepEqual(p.monthly, { freq: "monthly", day: 5 });
  assert.equal(sameRepeat({ freq: "weekly", every: 1, days: [6] }, p.weekly), true);
  assert.equal(sameRepeat({ freq: "weekly", every: 2, days: [6] }, p.weekly), false);
  assert.equal(sameRepeat({ freq: "weekly", days: [6], from: "done" }, p.weekly), false);
  assert.equal(sameRepeat({ freq: "ebbinghaus", start: "2026-01-01", step: 3 }, p.ebbinghaus), true);
  assert.equal(sameRepeat(null, null), true);
  assert.equal(sameRepeat(null, p.daily), false);
});

test("设置重复：日期不符合规则时挪到第一次符合的那天，清除时不动日期", () => {
  const { store } = makeStore();
  const id = newTask(store, { title: "x", date: TODAY }); // 周四
  setRepeat(store, id, { freq: "weekly", every: 2, days: [6] }, TODAY);
  assert.equal(store.get<Task>(id)!.date, "2026-11-07");
  setRepeat(store, id, null, TODAY);
  assert.equal(store.get<Task>(id)!.date, "2026-11-07");
  assert.equal(store.get<Task>(id)!.repeat, null);
  const n = newTask(store, { title: "没日期" });
  setRepeat(store, n, { freq: "weekends" }, TODAY);
  assert.equal(store.get<Task>(n)!.date, "2026-11-07");
});

test("完成重复任务：走完的规则正常完成", () => {
  const { store } = makeStore();
  const id = newTask(store, { title: "背单词", date: "2026-12-05", repeat: { freq: "ebbinghaus", start: TODAY, step: 6 } });
  complete(store, id, new Date(2026, 11, 5, 12).getTime());
  const t = store.get<Task>(id)!;
  assert.equal(t.done, true);
  assert.equal(t.repeat, null);
  assert.equal(tasks(store).length, 1);
});

test("今天的分组和计数", () => {
  const { store } = makeStore();
  newTask(store, { title: "过期", date: "2026-11-04" });
  newTask(store, { title: "晚的", date: TODAY, time: "21:00" });
  newTask(store, { title: "早的", date: TODAY, time: "09:30" });
  newTask(store, { title: "全天高", date: TODAY, priority: 3 });
  newTask(store, { title: "明天", date: addDays(TODAY, 1) });
  newTask(store, { title: "做完", date: TODAY, done: true, doneAt: 1 });
  newTask(store, { title: "无日期" });
  const g = todayGroups(store, TODAY);
  assert.deepEqual(g.map((x) => x.key), ["overdue", "today", "done"]);
  assert.deepEqual(g[1]!.tasks.map((t) => t.title), ["早的", "晚的", "全天高"]);
  const c = counts(store, TODAY);
  assert.equal(c.today, 4);
  assert.equal(c.tomorrow, 1);
  assert.equal(c.week, 5);
  assert.equal(c.inbox, 6);
});

test("四象限：归类和拖动", () => {
  const { store } = makeStore();
  const a = newTask(store, { title: "a", date: TODAY, priority: 3 });
  const b = newTask(store, { title: "b", date: "2026-11-20", priority: 2 });
  const c = newTask(store, { title: "c", date: TODAY });
  const d = newTask(store, { title: "d" });
  const m = matrix(store, TODAY);
  assert.deepEqual([m[1][0]!.id, m[2][0]!.id, m[3][0]!.id, m[4][0]!.id], [a, b, c, d]);
  moveToQuadrant(store, d, 1, TODAY);
  assert.equal(quadrantOf(store.get<Task>(d)!, TODAY), 1);
  moveToQuadrant(store, a, 4, TODAY);
  const t = store.get<Task>(a)!;
  assert.equal(quadrantOf(t, TODAY), 4);
  assert.equal(t.priority, 1);
  assert.equal(t.date, "2026-11-06");
});

test("习惯：连续天数，今天没打不算断", () => {
  const { store } = makeStore();
  const h = store.create("habit", { name: "早起", order: 1, createdAt: 1 });
  toggleHabit(store, h, addDays(TODAY, -1));
  toggleHabit(store, h, addDays(TODAY, -2));
  assert.equal(streak(store, h, TODAY), 2);
  toggleHabit(store, h, TODAY);
  assert.equal(streak(store, h, TODAY), 3);
  toggleHabit(store, h, TODAY);
  assert.equal(streak(store, h, TODAY), 2);
  toggleHabit(store, h, addDays(TODAY, -1));
  assert.equal(streak(store, h, TODAY), 0);
  assert.equal(weekday(TODAY), 4);
});

// ── 设置 ─────────────────────────────────────────────

test("月历按每周第一天排", () => {
  assert.deepEqual(weekOrder(0), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(weekOrder(1), [1, 2, 3, 4, 5, 6, 0]);
  // 2026 年 11 月 1 日是周日。
  const sun = monthCells("2026-11", 0);
  assert.equal(sun[0], "2026-11-01");
  assert.equal(sun.length, 35);
  const mon = monthCells("2026-11", 1);
  assert.equal(mon[0], "2026-10-26");
  assert.equal(weekday(mon[0]!), 1);
  assert.equal(mon.length, 42);
  assert.equal(mon[mon.length - 1], "2026-12-06");
  // 2 月 1 日是周一、周一开始时，刚好四周。
  assert.equal(monthCells("2027-02", 1).length, 28);
  assert.equal(monthCells("2027-02", 1)[0], "2027-02-01");
});

test("没设置过就用默认值", () => {
  const { store } = makeStore();
  assert.deepEqual(prefs(store), DEFAULT_PREFS);
  // 只读不应该产生要同步的文档。
  assert.equal(store.docs.size, 0);
});

test("新任务用设置里的默认清单、日期和提醒", () => {
  const { store } = makeStore();
  seedDefaults(store);
  setPrefs(store, { defaultList: "list-work", defaultDate: "tomorrow", defaultRemind: 15 });
  // 上午和晚上加都一样：只写了时间不等于写明了日期。
  for (const hour of [9, 20]) {
    const a = store.get<Task>(addFromText(store, "写周报 14:00", TODAY, {}, [], at(hour))!.id)!;
    assert.equal(a.listId, "list-work");
    assert.equal(a.date, "2026-11-06");
    assert.deepEqual(a.remind, [15]);
  }
  // 没有具体时间的任务不提醒。
  assert.deepEqual(store.get<Task>(addFromText(store, "买牛奶", TODAY, {})!.id)!.remind, []);
});

test("只写了时间：视图给的是别的哪天就用那天，今天才按钟点推", () => {
  const { store } = makeStore();
  seedDefaults(store);
  const dateOf = (text: string, defaults: Partial<Task>, hour: number) => store.get<Task>(addFromText(store, text, TODAY, defaults, [], at(hour))!.id)!.date;
  assert.equal(dateOf("A 9:00", { date: "2026-11-20" }, 8), "2026-11-20");
  assert.equal(dateOf("B 9:00", { date: "2026-11-06" }, 8), "2026-11-06");
  assert.equal(dateOf("C 9:00", { date: TODAY }, 8), TODAY);
  assert.equal(dateOf("D 9:00", { date: TODAY }, 20), "2026-11-06");
  assert.equal(dateOf("E 9:00", {}, 20), "2026-11-06");
  // 四象限“不紧急”明确不要日期，但写了时间就该有日期。
  assert.equal(dateOf("F 9:00", { date: null }, 8), TODAY);
  // 写明了日期的照写的来。
  assert.equal(dateOf("G 明天 9:00", { date: "2026-11-20" }, 8), "2026-11-06");
});

test("当前视图和文字里写明的优先于默认值", () => {
  const { store } = makeStore();
  seedDefaults(store);
  setPrefs(store, { defaultList: "list-work", defaultDate: "tomorrow" });
  const inList = store.get<Task>(addFromText(store, "A", TODAY, { listId: "list-life" })!.id)!;
  assert.equal(inList.listId, "list-life");
  assert.equal(store.get<Task>(addFromText(store, "B", TODAY, { date: TODAY })!.id)!.date, TODAY);
  assert.equal(store.get<Task>(addFromText(store, "C 后天", TODAY, {})!.id)!.date, "2026-11-07");
  assert.equal(store.get<Task>(addFromText(store, "D #生活", TODAY, {})!.id)!.listId, "list-life");
  // 四象限的“不紧急”明确不要日期，不能被默认日期变成紧急。
  const notUrgent = store.get<Task>(addFromText(store, "E", TODAY, { date: null })!.id)!;
  assert.equal(notUrgent.date, null);
});

test("默认清单被删掉后回到收件箱", () => {
  const { store } = makeStore();
  seedDefaults(store);
  setPrefs(store, { defaultList: "list-work" });
  store.remove("list-work");
  assert.equal(store.get<Task>(addFromText(store, "A", TODAY, {})!.id)!.listId, "inbox");
});

test("默认不提醒时，定时间也不会加提醒", () => {
  const { store } = makeStore();
  setPrefs(store, { defaultRemind: null });
  const id = newTask(store, { title: "A", date: TODAY, time: "10:00" });
  assert.deepEqual(store.get<Task>(id)!.remind, []);
  const other = newTask(store, { title: "B", date: TODAY });
  setTime(store, other, "11:00");
  assert.deepEqual(store.get<Task>(other)!.remind, []);
});

test("全天任务按设置的时间提醒", () => {
  const { store } = makeStore();
  setPrefs(store, { allDayAt: "08:30" });
  newTask(store, { title: "A", date: "2026-11-06", remind: [0] });
  const [r] = reminders(store, NOW.getTime());
  assert.equal(r!.at, new Date(2026, 10, 6, 8, 30).getTime());
});

test("两台设备改不同的设置都留下", () => {
  const a = makeStore("a", () => 1000);
  const b = makeStore("b", () => 2000);
  setPrefs(a.store, { weekStart: 1 });
  setPrefs(b.store, { focusMinutes: 40 });
  a.store.flushPush();
  b.store.flushPush();
  a.store.applyRemote(b.pushed.flat());
  b.store.applyRemote(a.pushed.flat());
  for (const s of [a.store, b.store]) {
    assert.equal(prefs(s).weekStart, 1);
    assert.equal(prefs(s).focusMinutes, 40);
  }
});

const key = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

test("按键变成快捷键", () => {
  assert.equal(accelFromEvent(key("Space", { ctrlKey: true, altKey: true })), "Ctrl+Alt+Space");
  assert.equal(accelFromEvent(key("KeyN", { metaKey: true })), "Cmd+N");
  assert.equal(accelFromEvent(key("KeyK", { metaKey: true, shiftKey: true })), "Shift+Cmd+K");
  assert.equal(accelFromEvent(key("Digit9", { altKey: true })), "Alt+9");
  assert.equal(accelFromEvent(key("Comma", { metaKey: true })), "Cmd+,");
  assert.equal(accelFromEvent(key("ArrowUp", { ctrlKey: true })), "Ctrl+Up");
  // 功能键可以单独用。
  assert.equal(accelFromEvent(key("F5")), "F5");
  // 不带修饰键的字母、⇧ 加字母是在打字；单按修饰键还没按完。
  assert.equal(accelFromEvent(key("KeyA")), null);
  assert.equal(accelFromEvent(key("KeyA", { shiftKey: true })), null);
  assert.equal(accelFromEvent(key("Space")), null);
  assert.equal(accelFromEvent(key("MetaLeft", { metaKey: true })), null);
  assert.equal(accelFromEvent(key("ShiftLeft", { shiftKey: true })), null);
});

test("快捷键的显示", () => {
  assert.equal(shortcutLabel("Ctrl+Alt+Space"), "⌃⌥Space");
  assert.equal(shortcutLabel("Shift+Cmd+K"), "⇧⌘K");
  assert.equal(shortcutLabel("Cmd+,"), "⌘,");
  assert.equal(shortcutLabel("Ctrl+Up"), "⌃↑");
  assert.equal(shortcutLabel("F5"), "F5");
  assert.equal(heldLabel(key("MetaLeft", { metaKey: true, ctrlKey: true })), "⌃⌘");
});

test("快捷键冲突", () => {
  const others = [{ label: "快速添加", accel: "Ctrl+Alt+Space" }];
  assert.equal(conflictOf("Ctrl+Alt+Space", others), "快速添加");
  assert.equal(conflictOf("Cmd+F", others), "搜索");
  assert.equal(conflictOf("Cmd+,", others), "设置");
  assert.equal(conflictOf("Cmd+K", others), null);
});

// ── 小组件 ───────────────────────────────────────────

test("小组件只看今天和已过期，过期的排前面", () => {
  const { store } = makeStore();
  seedDefaults(store);
  newTask(store, { title: "今天下午", date: TODAY, time: "15:00", listId: "list-work", repeat: { freq: "daily" } });
  newTask(store, { title: "今天上午", date: TODAY, time: "09:00" });
  newTask(store, { title: "昨天的", date: addDays(TODAY, -1) });
  newTask(store, { title: "明天的", date: addDays(TODAY, 1) });
  newTask(store, { title: "没日期" });
  const done = newTask(store, { title: "做完了", date: TODAY });
  complete(store, done);
  const d = widgetData(store, TODAY);
  assert.equal(d.count, 3);
  assert.equal(d.label, "11月5日 周四");
  assert.deepEqual(d.tasks.map((t) => t.title), ["昨天的", "今天上午", "今天下午"]);
  assert.equal(d.tasks[0]!.overdue, true);
  assert.equal(d.tasks[2]!.repeat, true);
  assert.equal(d.tasks[2]!.color, "#2F6BFF");
  assert.equal(d.tasks[1]!.color, null);
});

test("小组件数量只截断列表，不截断总数", () => {
  const { store } = makeStore();
  for (let i = 0; i < 20; i++) newTask(store, { title: `t${i}`, date: TODAY });
  const d = widgetData(store, TODAY, 12);
  assert.equal(d.count, 20);
  assert.equal(d.tasks.length, 12);
});

test("小组件完成任务：返回新状态和要上传的文档", () => {
  const { store } = makeStore("phone", () => 1000);
  const id = newTask(store, { title: "A", date: TODAY });
  const r = JSON.parse(widget.complete(store.serialize(), id, 5000)) as { state: string; changed: RemoteItem[] };
  assert.deepEqual(r.changed.map((x) => x.id), [id]);
  const after = new Store({ save() {}, push() {} });
  after.load(r.state);
  assert.equal(after.get<Task>(id)!.done, true);
  assert.equal(after.get<Task>(id)!.doneAt, 5000);
  // 还没传上云的要记着，App 打开时接着传。
  assert.ok((JSON.parse(r.state) as { pending: string[] }).pending.includes(id));
  // 设备身份不变，不然时间戳的来源就乱了。
  assert.equal((JSON.parse(r.state) as { device: string }).device, "phone");
});

test("小组件完成重复任务：滚到下一次，和 App 里算的一样", () => {
  const { store } = makeStore("phone");
  const id = newTask(store, { title: "A", date: TODAY, repeat: { freq: "weekly", days: [4] } });
  const now = new Date(2026, 10, 5, 12).getTime();
  const r = JSON.parse(widget.complete(store.serialize(), id, now)) as { state: string; changed: RemoteItem[] };
  // 原任务滚到下周四，多一条已完成的记录。
  assert.equal(r.changed.length, 2);
  const after = new Store({ save() {}, push() {} });
  after.load(r.state);
  assert.equal(after.get<Task>(id)!.date, "2026-11-12");
  assert.equal(after.get<Task>(id)!.done, false);
  assert.equal(after.all<Task>("task").filter((t) => t.done).length, 1);
});

test("回到前台时合并小组件改过的文件", () => {
  const phone = makeStore("phone", () => 1000);
  const id = newTask(phone.store, { title: "A", date: TODAY });
  phone.store.flushPush();
  phone.pushed.length = 0;
  const file = JSON.parse(widget.complete(phone.store.serialize(), id, 9000)).state as string;
  phone.store.absorbFile(file);
  assert.equal(phone.store.get<Task>(id)!.done, true);
  // 文件里记着要上传的，也要接过来。
  phone.store.flushPush();
  assert.ok(phone.pushed.flat().some((x) => x.id === id));
});

test("合并同一条文档的两个版本，逐字段取新的", () => {
  const a = JSON.stringify({ f: { title: "A", done: false }, t: { title: "000000000000002.0000.a", done: "000000000000001.0000.a" } });
  const b = JSON.stringify({ f: { title: "B", done: true }, t: { title: "000000000000001.0000.b", done: "000000000000002.0000.b" } });
  const m = JSON.parse(widget.merge(a, b)) as { f: { title: string; done: boolean } };
  assert.deepEqual(m.f, { title: "A", done: true });
});

