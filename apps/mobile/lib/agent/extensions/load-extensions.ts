// load-extensions — run extension factories against a concrete ExtensionAPI.
//
// Builds the live API an extension's `register` receives (a small typed event bus + a
// tool registry), runs each factory, and returns the collected tools plus a `dispatch`
// the session/loop calls to fire events. `before_agent_start` is special: its handlers
// CHAIN — each receives the system prompt the previous one produced — which is how
// extensions compose the prompt (mirrors Pi's before_agent_start, cloud PR #1847).
//
// An extension whose `register` throws is logged + skipped so one bad extension can't
// take down the turn. Kept deliberately small: the bus is a Map<event, handler[]>, not a
// config/policy engine.

import type { Tool } from "../types";
import type {
  ExtensionAPI,
  ExtensionEventName,
  ExtensionEvents,
  ExtensionFactory,
  ExtensionHandler,
  Logger,
} from "./types";

export interface LoadedExtensions {
  /** Tools registered by all loaded extensions, in registration order. */
  tools: Tool[];
  /**
   * Fire an event to all registered handlers, in registration order. For
   * `before_agent_start` the handlers chain (each sees the prior result); the resolved
   * payload is returned. For other events handlers are awaited fire-and-forget and the
   * (possibly mutated) payload is returned for symmetry.
   */
  dispatch<E extends ExtensionEventName>(
    type: E,
    payload: ExtensionEvents[E]["payload"],
  ): Promise<ExtensionEvents[E]["payload"]>;
}

const consoleLogger: Logger = {
  debug: (...a) => console.debug("[ext]", ...a),
  info: (...a) => console.info("[ext]", ...a),
  warn: (...a) => console.warn("[ext]", ...a),
  error: (...a) => console.error("[ext]", ...a),
};

export async function loadExtensions(
  factories: ExtensionFactory[],
  options: { logger?: Logger } = {},
): Promise<LoadedExtensions> {
  const logger = options.logger ?? consoleLogger;
  const tools: Tool[] = [];
  // One handler list per event name, preserving registration order across extensions.
  const handlers = new Map<ExtensionEventName, ExtensionHandler<never>[]>();

  const api: ExtensionAPI = {
    registerTool(tool: Tool) {
      tools.push(tool);
      return () => {
        const i = tools.indexOf(tool);
        if (i >= 0) tools.splice(i, 1);
      };
    },
    on<E extends ExtensionEventName>(type: E, handler: ExtensionHandler<E>) {
      const list = handlers.get(type) ?? [];
      list.push(handler as ExtensionHandler<never>);
      handlers.set(type, list);
      return () => {
        const cur = handlers.get(type);
        if (!cur) return;
        const i = cur.indexOf(handler as ExtensionHandler<never>);
        if (i >= 0) cur.splice(i, 1);
      };
    },
    logger,
  };

  for (const factory of factories) {
    try {
      await factory.register(api);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`extension "${factory.name}" failed to register: ${message}`);
      // Skip the bad extension; others still load.
    }
  }

  async function dispatch<E extends ExtensionEventName>(
    type: E,
    payload: ExtensionEvents[E]["payload"],
  ): Promise<ExtensionEvents[E]["payload"]> {
    const list = handlers.get(type);
    if (!list || list.length === 0) return payload;
    let current = payload;
    for (const handler of list) {
      try {
        const result = await (handler as ExtensionHandler<E>)(current);
        // before_agent_start (and any future result-bearing event): fold the handler's
        // returned fields back into the payload so the next handler sees them.
        if (result && typeof result === "object") {
          current = { ...current, ...(result as object) };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`handler for "${type}" threw: ${message}`);
        // A throwing handler must not break the turn or the rest of the chain.
      }
    }
    return current;
  }

  return { tools, dispatch };
}
