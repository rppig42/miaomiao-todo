import { useEffect, useState } from "preact/hooks";
import { events, Native, Store } from "../mygo.ts";
import { NLInput } from "./common.tsx";

interface SavedDoc {
  kind: string;
  f: { name?: string; deleted?: boolean };
}

async function listNames(): Promise<string[]> {
  try {
    const v = JSON.parse((await Store.load()) || "{}") as { docs?: SavedDoc[] };
    return (v.docs ?? []).filter((d) => d.kind === "list" && !d.f.deleted).map((d) => d.f.name ?? "");
  } catch {
    return [];
  }
}

/** 全局快捷键呼出的小面板，只负责收一句话，交给主窗口去解析和创建。 */
export function QuickPanel() {
  const [names, setNames] = useState<string[]>([]);
  const [key, setKey] = useState(1);
  useEffect(() => {
    void listNames().then(setNames);
    return events.panelshown.on(() => {
      void listNames().then(setNames);
      setKey((k) => k + 1);
    });
  }, []);
  return (
    <div class="qp">
      <NLInput
        key={key}
        class="qp-in"
        placeholder="添加任务"
        lists={names}
        autoFocus
        focusKey={key}
        onEscape={() => void Native.hidePanel()}
        onSubmit={(text) => {
          void Native.submitQuickAdd(text);
          return true;
        }}
      />
    </div>
  );
}
