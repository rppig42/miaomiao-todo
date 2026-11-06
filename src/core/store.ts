// 本地优先的文档库。每个字段单独记时间戳，合并时逐字段取较新的值，
// 所以两台设备离线改同一条任务的不同字段，都不会丢；结果也和合并顺序无关。
// iCloud 只负责搬运这些文档，规则全在这里，Mac 和 iPhone 共用同一份。

export type Kind = "task" | "sub" | "list" | "habit" | "hlog" | "focus" | "settings";

export interface Doc {
  id: string;
  kind: Kind;
  f: Record<string, unknown>;
  t: Record<string, string>;
}

/** 内置默认数据用的时间戳，任何真实编辑都比它新，新设备首次启动也不会盖掉用户的改动。 */
export const SEED_STAMP = "000000000000000.0000.seed";

export function mergeDocs(a: Doc, b: Doc): Doc {
  const f: Record<string, unknown> = { ...a.f };
  const t: Record<string, string> = { ...a.t };
  for (const key of Object.keys(b.t)) {
    if (!(key in t) || b.t[key]! > t[key]!) {
      f[key] = b.f[key];
      t[key] = b.t[key]!;
    }
  }
  return { id: a.id, kind: a.kind, f, t };
}

function sameStamps(a: Doc, b: Doc): boolean {
  const ka = Object.keys(a.t);
  if (ka.length !== Object.keys(b.t).length) return false;
  return ka.every((k) => a.t[k] === b.t[k]);
}

export interface RemoteItem {
  id: string;
  kind: string;
  payload: string;
}

export interface Persist {
  /** 落盘。 */
  save(json: string): void;
  /** 交给云端。 */
  push(items: RemoteItem[]): void;
}

export function encodeDoc(d: Doc): RemoteItem {
  return { id: d.id, kind: d.kind, payload: JSON.stringify({ f: d.f, t: d.t }) };
}

export function decodeDoc(item: RemoteItem): Doc | null {
  try {
    const v = JSON.parse(item.payload) as { f?: Record<string, unknown>; t?: Record<string, string> };
    if (!v.f || !v.t) return null;
    return { id: item.id, kind: item.kind as Kind, f: v.f, t: v.t };
  } catch {
    return null;
  }
}

export function randomId(): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

export class Store {
  docs = new Map<string, Doc>();
  device: string;
  private lastMs = 0;
  private counter = 0;
  private listeners = new Set<() => void>();
  private dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private clock: () => number;
  /** 改动后多久写盘、多久发给云端。测试里设成 0 手动冲刷。 */
  saveDelay = 250;
  pushDelay = 1200;

  private persist: Persist;

  constructor(persist: Persist, opts: { device?: string; clock?: () => number } = {}) {
    this.persist = persist;
    this.device = opts.device ?? randomId();
    this.clock = opts.clock ?? Date.now;
  }

  load(json: string | null) {
    if (!json) return;
    const v = JSON.parse(json) as { device?: string; docs?: Doc[]; pending?: string[] };
    if (v.device) this.device = v.device;
    for (const d of v.docs ?? []) {
      this.docs.set(d.id, d);
      for (const s of Object.values(d.t)) this.observe(s);
    }
    // 上次退出前还没交给云端的改动。
    for (const id of v.pending ?? []) if (this.docs.has(id)) this.dirty.add(id);
    if (this.dirty.size) this.schedulePush();
  }

  serialize(): string {
    return JSON.stringify({ device: this.device, docs: [...this.docs.values()], pending: [...this.dirty] });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private observe(stamp: string) {
    const ms = Number(stamp.slice(0, 15));
    if (ms > this.lastMs) {
      this.lastMs = ms;
      this.counter = Number(stamp.slice(16, 20)) || 0;
    }
  }

  private stamp(): string {
    const now = this.clock();
    if (now > this.lastMs) {
      this.lastMs = now;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return `${String(this.lastMs).padStart(15, "0")}.${String(this.counter).padStart(4, "0")}.${this.device}`;
  }

  get<T = Record<string, unknown>>(id: string): (T & { id: string }) | null {
    const d = this.docs.get(id);
    return d ? ({ ...d.f, id } as T & { id: string }) : null;
  }

  all<T = Record<string, unknown>>(kind: Kind): (T & { id: string })[] {
    const out: (T & { id: string })[] = [];
    for (const d of this.docs.values()) if (d.kind === kind && !d.f.deleted) out.push({ ...d.f, id: d.id } as T & { id: string });
    return out;
  }

  /** 包括放进垃圾桶的。 */
  allWithDeleted<T = Record<string, unknown>>(kind: Kind): (T & { id: string })[] {
    const out: (T & { id: string })[] = [];
    for (const d of this.docs.values()) if (d.kind === kind) out.push({ ...d.f, id: d.id } as T & { id: string });
    return out;
  }

  create(kind: Kind, fields: Record<string, unknown>, id: string = randomId()): string {
    const prev = this.docs.get(id);
    const d: Doc = prev ?? { id, kind, f: {}, t: {} };
    const s = this.stamp();
    for (const [k, v] of Object.entries(fields)) {
      d.f[k] = v;
      d.t[k] = s;
    }
    this.docs.set(id, d);
    this.touched(id);
    return id;
  }

  /** 内置默认数据：只在文档不存在时创建，时间戳最旧。 */
  seed(kind: Kind, id: string, fields: Record<string, unknown>) {
    if (this.docs.has(id)) return;
    const t: Record<string, string> = {};
    for (const k of Object.keys(fields)) t[k] = SEED_STAMP;
    this.docs.set(id, { id, kind, f: { ...fields }, t });
  }

  update(id: string, patch: Record<string, unknown>) {
    const d = this.docs.get(id);
    if (!d) return;
    const s = this.stamp();
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(d.f[k]) === JSON.stringify(v)) continue;
      d.f[k] = v;
      d.t[k] = s;
      changed = true;
    }
    if (changed) this.touched(id);
  }

  remove(id: string) {
    this.update(id, { deleted: true, deletedAt: this.clock() });
  }

  restore(id: string) {
    this.update(id, { deleted: false, deletedAt: null });
  }

  /** 还有没交给云端的改动。 */
  hasUnpushed(): boolean {
    return this.dirty.size > 0;
  }

  /**
   * 收到云端的文档。合并后比云端新的再推回去，比本地新的就刷新界面。
   * mustPush 用于上传冲突：同步层在等合并结果，不管有没有差别都要推回去。
   */
  applyRemote(items: RemoteItem[], mustPush = false) {
    let changed = false;
    for (const item of items) {
      const remote = decodeDoc(item);
      if (!remote) continue;
      for (const s of Object.values(remote.t)) this.observe(s);
      const local = this.docs.get(remote.id);
      if (mustPush) this.dirty.add(remote.id);
      if (!local) {
        this.docs.set(remote.id, remote);
        changed = true;
        continue;
      }
      const merged = mergeDocs(local, remote);
      if (!sameStamps(merged, local)) changed = true;
      this.docs.set(remote.id, merged);
      if (!sameStamps(merged, remote)) this.dirty.add(remote.id);
    }
    if (changed || this.dirty.size) {
      this.scheduleSave();
      this.schedulePush();
    }
    if (changed) this.emit();
  }

  /**
   * 把文件里的状态合并进来。手机上小组件会直接改这个文件，回到前台时调用。
   * 文件里记着没传上云的文档也接过来；它们合并后可能和本地一样，只靠 applyRemote 判断不出要上传。
   */
  absorbFile(json: string | null) {
    if (!json) return;
    const v = JSON.parse(json) as { docs?: Doc[]; pending?: string[] };
    this.applyRemote((v.docs ?? []).map(encodeDoc));
    let added = false;
    for (const id of v.pending ?? []) {
      if (this.docs.has(id) && !this.dirty.has(id)) {
        this.dirty.add(id);
        added = true;
      }
    }
    if (added) {
      this.scheduleSave();
      this.schedulePush();
    }
  }

  /** 登录 iCloud、换环境或云端数据被清空后，把本地全部文档重新上传。 */
  pushAll() {
    for (const id of this.docs.keys()) this.dirty.add(id);
    this.schedulePush();
  }

  private touched(id: string) {
    this.dirty.add(id);
    this.scheduleSave();
    this.schedulePush();
    this.emit();
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flushSave(), this.saveDelay);
  }

  private schedulePush() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.flushPush(), this.pushDelay);
  }

  flushSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.persist.save(this.serialize());
  }

  flushPush() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    if (!this.dirty.size) return;
    const items: RemoteItem[] = [];
    for (const id of this.dirty) {
      const d = this.docs.get(id);
      if (d) items.push(encodeDoc(d));
    }
    this.dirty.clear();
    this.persist.push(items);
    this.flushSave();
  }

  /** 退出前把还没写盘的写掉。 */
  flush() {
    this.flushSave();
  }
}
