import type { Reminder } from "../core/model.ts";
import type { DeviceSettings, Platform } from "./types.ts";

// 原生部分在 ios/App/WebViewController.swift。页面 → 原生走 messageHandlers，原生 → 页面调 window.__todoNative。
declare global {
  interface Window {
    webkit?: { messageHandlers?: { todo?: { postMessage(body: unknown): Promise<unknown> } } };
    __todoNative?: { cloud(json: string): void; command(cmd: string): void };
  }
}

function call<T = void>(method: string, ...args: unknown[]): Promise<T> {
  return window.webkit!.messageHandlers!.todo!.postMessage({ method, args }) as Promise<T>;
}

let onCloud: (json: string) => void = () => {};
let onCommand: (cmd: string) => void = () => {};
window.__todoNative = {
  cloud: (json) => onCloud(json),
  command: (cmd) => onCommand(cmd),
};

export const ios: Platform = {
  kind: "ios",
  load: async () => (await call<string>("load")) || null,
  save: (json) => void call("save", json).catch((e) => console.error("保存失败", e)),
  cloudAvailable: () => call<boolean>("cloudAvailable"),
  cloudStart: () => void call("cloudStart"),
  cloudPush: (json) => void call("cloudPush", json),
  cloudFetch: () => void call("cloudFetch"),
  onCloud: (fn) => void (onCloud = fn),
  onCommand: (fn) => {
    onCommand = fn;
    // 从小组件或通知打开时，命令在页面准备好之前就到了，原生先存着。
    void call("ready");
  },
  onQuickAdd() {},
  setReminders: (list: Reminder[]) => void call("setReminders", list),
  notify() {},
  setBadge: (n) => void call("setBadge", n),
  setFocusTitle() {},
  setFocusAlerts: (list: Reminder[]) => void call("setFocusAlerts", list),
  confirm: (message, detail, action) => call<boolean>("confirm", message, detail, action),
  reloadWidgets: () => void call("reloadWidgets"),
  settings: () => call<DeviceSettings>("settings"),
  setTheme: (theme) => call("setTheme", theme),
  setTray: async () => {},
  setBadgeEnabled: (on) => call("setBadgeEnabled", on),
  setOpenAtLogin: async () => {},
  setShortcut: async () => {},
  resetShortcuts: () => call<DeviceSettings>("settings"),
  pauseShortcuts() {},
};
