import type { ThinkworkLogger } from "./types";

export const defaultLogger: ThinkworkLogger = {
  debug: (...args) => console.log("[thinkwork]", ...args),
  info: (...args) => console.log("[thinkwork]", ...args),
  warn: (...args) => console.warn("[thinkwork]", ...args),
  error: (...args) => console.error("[thinkwork]", ...args),
};
