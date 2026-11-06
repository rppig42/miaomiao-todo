import { api } from "./widget.ts";

(globalThis as unknown as { TodoCore: typeof api }).TodoCore = api;
