// 快捷键：把按键变成加速键字符串（"Ctrl+Alt+Space"），再显示成 ⌃⌥Space。

export interface KeyLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// 用 code 不用 key：按住 Option 时 key 是特殊符号，换输入法也会变。
const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

function keyOf(code: string): string | null {
  const letter = code.match(/^Key([A-Z])$/);
  if (letter) return letter[1]!;
  const digit = code.match(/^Digit(\d)$/);
  if (digit) return digit[1]!;
  if (/^F([1-9]|1\d|20)$/.test(code)) return code;
  return NAMED[code] ?? null;
}

/** 按住的修饰键，顺序和系统菜单一样。 */
function modifiersOf(e: KeyLike): string[] {
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Cmd"].filter(Boolean) as string[];
}

/**
 * 这次按键能不能当快捷键。只按了修饰键、或者没带 ⌘⌃⌥ 的普通键都返回 null：
 * 单独的字母和 ⇧ 加字母是在打字。功能键可以单独用。
 */
export function accelFromEvent(e: KeyLike): string | null {
  const key = keyOf(e.code);
  if (!key) return null;
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !/^F\d+$/.test(key)) return null;
  return [...modifiersOf(e), key].join("+");
}

const MOD_SIGN: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘" };
const KEY_SIGN: Record<string, string> = { Up: "↑", Down: "↓", Left: "←", Right: "→", Enter: "↩", Tab: "⇥", Backspace: "⌫", Delete: "⌦" };

export function shortcutLabel(accel: string): string {
  // 按键本身可能是 "+" 以外的符号，只按第一层拆，最后一段就是键。
  const parts = accel.split("+");
  const key = parts.pop()!;
  return parts.map((m) => MOD_SIGN[m] ?? m).join("") + (KEY_SIGN[key] ?? key);
}

/** 录制时显示正按住的修饰键。 */
export function heldLabel(e: KeyLike): string {
  return modifiersOf(e).map((m) => MOD_SIGN[m]).join("");
}

/** 菜单里已经用掉的快捷键，不能再给别的功能。 */
export const RESERVED: Record<string, string> = {
  "Cmd+Q": "退出",
  "Cmd+W": "关闭窗口",
  "Cmd+H": "隐藏",
  "Alt+Cmd+H": "隐藏其他",
  "Cmd+M": "最小化",
  "Ctrl+Cmd+F": "进入全屏",
  "Cmd+Z": "撤销",
  "Shift+Cmd+Z": "重做",
  "Cmd+X": "剪切",
  "Cmd+C": "拷贝",
  "Cmd+V": "粘贴",
  "Cmd+A": "全选",
  "Cmd+F": "搜索",
  "Cmd+R": "立即同步",
  "Shift+Cmd+N": "新建清单",
  "Cmd+,": "设置",
  "Cmd+1": "今天",
  "Cmd+2": "明天",
  "Cmd+3": "最近 7 天",
  "Cmd+4": "收件箱",
  "Cmd+5": "日历",
  "Cmd+6": "四象限",
  "Cmd+7": "专注",
  "Cmd+8": "习惯",
};

/** 这个快捷键已经被谁占了。others 是其他可以改的快捷键。 */
export function conflictOf(accel: string, others: { label: string; accel: string }[]): string | null {
  return others.find((o) => o.accel === accel)?.label ?? RESERVED[accel] ?? null;
}
