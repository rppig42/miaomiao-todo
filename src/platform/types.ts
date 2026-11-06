import type { Reminder } from "../core/model.ts";

/** 只属于这台设备的设置，字段和 settings.go 一一对应。 */
export interface DeviceSettings {
  theme: string;
  quickAdd: string;
  toggleWindow: string;
  addTask: string;
  tray: boolean;
  badge: boolean;
  openAtLogin: boolean;
}

export type ShortcutName = "quickAdd" | "toggleWindow" | "addTask";

/** 界面对平台的全部要求。iPhone 版只要再实现一份这个接口。 */
export interface Platform {
  kind: "desktop" | "browser" | "ios";
  load(): Promise<string | null>;
  save(json: string): void;
  cloudAvailable(): Promise<boolean>;
  cloudStart(): void;
  cloudPush(json: string): void;
  cloudFetch(): void;
  onCloud(fn: (json: string) => void): void;
  onCommand(fn: (command: string) => void): void;
  onQuickAdd(fn: (text: string) => void): void;
  setReminders(list: Reminder[]): void;
  notify(title: string, body: string): void;
  setBadge(n: number): void;
  setFocusTitle(s: string): void;
  /** 专注和休息结束的通知。手机上 App 退到后台时页面不运行，要提前排好。整个替换。 */
  setFocusAlerts(list: Reminder[]): void;
  /** 数据变了，让小组件刷新。 */
  reloadWidgets(): void;
  confirm(message: string, detail: string, action: string): Promise<boolean>;
  settings(): Promise<DeviceSettings>;
  setTheme(theme: string): Promise<void>;
  setTray(on: boolean): Promise<void>;
  setBadgeEnabled(on: boolean): Promise<void>;
  setOpenAtLogin(on: boolean): Promise<void>;
  setShortcut(name: ShortcutName, accel: string): Promise<void>;
  resetShortcuts(): Promise<DeviceSettings>;
  pauseShortcuts(paused: boolean): void;
}
