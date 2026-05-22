import type { DeepLinkCallback } from "@thinkwork/desktop-ipc";

export const DEEP_LINK_SCHEMES = [
  "thinkwork",
  "thinkwork-dev",
  "thinkwork-canary",
] as const;

export type DeepLinkScheme = (typeof DEEP_LINK_SCHEMES)[number];
export type DeepLinkDispatcher = (callback: DeepLinkCallback) => void;

export interface DeepLinkController {
  scheme: DeepLinkScheme;
  handleUrl(url: string): DeepLinkCallback | null;
  handleArgv(argv: readonly string[]): DeepLinkCallback[];
  markReady(dispatcher: DeepLinkDispatcher): void;
  consumePending(): DeepLinkCallback | null;
  consumeAllPending(): DeepLinkCallback[];
  pendingCount(): number;
}

export interface CreateDeepLinkControllerOptions {
  scheme: DeepLinkScheme;
  logger?: Pick<Console, "warn">;
}

export function resolveDeepLinkScheme(
  stage: string | null | undefined,
): DeepLinkScheme {
  const normalized = (stage ?? "").trim().toLowerCase();
  if (normalized === "canary") return "thinkwork-canary";
  if (
    normalized === "prod" ||
    normalized === "production" ||
    normalized === "stable"
  ) {
    return "thinkwork";
  }
  return "thinkwork-dev";
}

export function createDeepLinkController(
  options: CreateDeepLinkControllerOptions,
): DeepLinkController {
  const pending: DeepLinkCallback[] = [];
  let dispatcher: DeepLinkDispatcher | null = null;

  function route(callback: DeepLinkCallback): void {
    if (dispatcher) {
      dispatcher(callback);
      return;
    }

    pending.push(callback);
  }

  function handleUrl(url: string): DeepLinkCallback | null {
    const callback = parseDeepLinkCallback(url, {
      allowedSchemes: [options.scheme],
      logger: options.logger,
    });

    if (!callback) return null;
    route(callback);
    return callback;
  }

  return {
    scheme: options.scheme,
    handleUrl,
    handleArgv(argv) {
      const callbacks: DeepLinkCallback[] = [];

      for (const arg of argv) {
        if (!isDeepLinkUrl(arg)) continue;
        const callback = handleUrl(arg);
        if (callback) callbacks.push(callback);
      }

      return callbacks;
    },
    markReady(nextDispatcher) {
      dispatcher = nextDispatcher;
      for (const callback of pending.splice(0)) {
        dispatcher(callback);
      }
    },
    consumePending() {
      return pending.shift() ?? null;
    },
    consumeAllPending() {
      return pending.splice(0);
    },
    pendingCount() {
      return pending.length;
    },
  };
}

export interface ParseDeepLinkCallbackOptions {
  allowedSchemes?: readonly DeepLinkScheme[];
  logger?: Pick<Console, "warn">;
}

export function parseDeepLinkCallback(
  rawUrl: string,
  options: ParseDeepLinkCallbackOptions = {},
): DeepLinkCallback | null {
  const allowedSchemes = options.allowedSchemes ?? DEEP_LINK_SCHEMES;
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    options.logger?.warn("[desktop] rejected malformed deep link");
    return null;
  }

  const scheme = url.protocol.replace(/:$/, "") as DeepLinkScheme;
  if (!allowedSchemes.includes(scheme)) {
    options.logger?.warn("[desktop] rejected deep link with unexpected scheme");
    return null;
  }

  if (
    url.host !== "oauth" ||
    url.pathname !== "/callback" ||
    url.hash ||
    url.username ||
    url.password
  ) {
    options.logger?.warn("[desktop] rejected deep link with unexpected path");
    return null;
  }

  if (!url.searchParams.has("code") || !url.searchParams.has("state")) {
    options.logger?.warn("[desktop] rejected deep link with unexpected query");
    return null;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    options.logger?.warn(
      "[desktop] rejected deep link with missing callback data",
    );
    return null;
  }

  return { code, state };
}

export function isDeepLinkUrl(value: string): boolean {
  try {
    const scheme = new URL(value).protocol.replace(/:$/, "");
    return DEEP_LINK_SCHEMES.includes(scheme as DeepLinkScheme);
  } catch {
    return false;
  }
}
