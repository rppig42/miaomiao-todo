import { isMyGo } from "mygo-runtime";
import { render } from "preact";
import { ymd } from "./core/dates.ts";
import { addFromText, counts, reminders, seedDefaults } from "./core/model.ts";
import { Store, type RemoteItem } from "./core/store.ts";
import type { Platform } from "./platform/types.ts";
import { App, handleCommand } from "./ui/app.tsx";
import { prefs } from "./core/settings.ts";
import { shortenFocus, startFocus, syncFocusPrefs, timer } from "./ui/focus.tsx";
import { bindApp, go, refresh, select, toast, ui, viewDefaults } from "./ui/state.ts";
import "./ui/style.css";

async function loadPlatform(): Promise<Platform> {
  if (window.webkit?.messageHandlers?.todo) return (await import("./platform/ios.ts")).ios;
  return isMyGo() ? (await import("./platform/desktop.ts")).desktop : (await import("./platform/browser.ts")).browser;
}

function handleCloud(store: Store, json: string) {
  let v: { type: string; state?: string; message?: string; environment?: string; pending?: number; items?: RemoteItem[]; change?: string };
  try {
    v = JSON.parse(json);
  } catch {
    return;
  }
  switch (v.type) {
    case "records":
      store.applyRemote(v.items ?? []);
      break;
    case "conflict":
      store.applyRemote(v.items ?? [], true);
      break;
    case "account":
      // 第一次登录、换账号，或云端被清空：把本地的全部内容传上去。
      if (v.change === "signIn" || v.change === "switch" || v.change === "zoneDeleted") store.pushAll();
      break;
    case "status":
      ui.sync = { enabled: true, state: (v.state ?? "idle") as typeof ui.sync.state, message: v.message, environment: v.environment, pending: v.pending };
      refresh();
      break;
  }
}

async function boot() {
  const panel = new URLSearchParams(location.search).get("panel") === "quick";
  const root = document.getElementById("app")!;
  const platform = await loadPlatform();
  document.documentElement.classList.add(platform.kind);

  if (panel) {
    document.documentElement.classList.add("panel");
    const { QuickPanel } = await import("./ui/panel.tsx");
    render(<QuickPanel />, root);
    return;
  }

  const store = new Store({
    save: (json) => platform.save(json),
    push: (items) => platform.cloudPush(JSON.stringify(items)),
  });
  try {
    store.load(await platform.load());
  } catch (err) {
    // 读不出来时不能继续：接着用就会写入空数据，把原来的文件覆盖掉。
    root.textContent = `读取数据失败：${err instanceof Error ? err.message : err}`;
    return;
  }
  seedDefaults(store);
  bindApp(store, platform);
  ui.device = await platform.settings();
  syncFocusPrefs();

  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  const syncSystem = () => {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      // 手机上 App 不常驻，要提前排好通知。系统最多留 64 条，排得远一点、挑最近的。
      platform.setReminders(platform.kind === "ios" ? reminders(store, Date.now(), 30).slice(0, 50) : reminders(store, Date.now()));
      platform.setBadge(counts(store, ui.today).today);
      platform.reloadWidgets();
    }, 400);
  };
  store.subscribe(() => {
    syncFocusPrefs();
    refresh();
    syncSystem();
  });
  syncSystem();

  // 过了零点，“今天”要跟着变。
  setInterval(() => {
    const now = ymd(new Date());
    if (now !== ui.today) {
      ui.today = now;
      refresh();
    }
    syncSystem();
  }, 60000);

  platform.onCommand((cmd) => {
    if (cmd !== "foreground") {
      handleCommand(cmd);
      return;
    }
    // 回到前台：小组件可能改过文件，后台时定时器也没跑。
    void platform.load().then((json) => {
      store.absorbFile(json);
      const now = ymd(new Date());
      if (now !== ui.today) ui.today = now;
      refresh();
      syncSystem();
    });
    platform.cloudFetch();
  });
  platform.onQuickAdd((text) => {
    const r = addFromText(store, text, ui.today, {});
    if (r) toast(`已添加“${r.parsed.title}”`, () => store.remove(r.id));
  });

  if (platform.kind === "ios") {
    const { MobileApp } = await import("./ui/mobile.tsx");
    render(<MobileApp />, root);
  } else {
    render(<App />, root);
  }

  if (await platform.cloudAvailable()) {
    ui.sync = { enabled: true, state: "syncing" };
    platform.onCloud((json) => handleCloud(store, json));
    platform.cloudStart();
    refresh();
  }

  // 调试入口：自动测试通过它灌示例数据、读内部状态。
  Object.assign(window, {
    __todo: {
      store,
      ui,
      platform,
      prefs: () => prefs(store),
      go,
      select,
      refresh,
      timer,
      startFocus,
      shortenFocus,
      viewDefaults,
      handleCommand,
      cloud: (json: string) => handleCloud(store, json),
      cloudFetch: () => platform.cloudFetch(),
      serialize: () => store.serialize(),
      flush: () => {
        store.flushPush();
        store.flushSave();
      },
      seed: async () => {
        const { seedDemo } = await import("./ui/seed.ts");
        seedDemo(store, ui.today);
        refresh();
      },
    },
  });
}

void boot();
