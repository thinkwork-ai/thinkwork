import { THREAD_GENUI_ACTION_KINDS } from "./spec.js";

export const threadGenUIActionKinds = THREAD_GENUI_ACTION_KINDS;

export function isThreadGenUIActionKind(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (THREAD_GENUI_ACTION_KINDS as readonly string[]).includes(value)
  );
}
