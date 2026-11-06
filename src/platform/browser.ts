import type { DeviceSettings, Platform } from "./types.ts";

const DEFAULTS: DeviceSettings = { theme: "system", quickAdd: "Ctrl+Alt+Space", toggleWindow: "", addTask: "Cmd+N", tray: true, badge: true, openAtLogin: false };

/** 在普通浏览器里调界面用：数据放 localStorage，没有 iCloud 和系统能力。 */
export const browser: Platform = {
  kind: "browser",
  load: async () => localStorage.getItem("todo-state"),
  save: (json) => localStorage.setItem("todo-state", json),
  cloudAvailable: async () => false,
  cloudStart() {},
  cloudPush() {},
  cloudFetch() {},
  onCloud() {},
  onCommand() {},
  onQuickAdd() {},
  setReminders() {},
  notify() {},
  setBadge() {},
  setFocusTitle() {},
  setFocusAlerts() {},
  reloadWidgets() {},
  confirm: async () => true,
  settings: async () => DEFAULTS,
  async setTheme() {},
  async setTray() {},
  async setBadgeEnabled() {},
  async setOpenAtLogin() {},
  async setShortcut() {},
  resetShortcuts: async () => DEFAULTS,
  pauseShortcuts() {},
};
