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
  if (DEEP_LINK_SCHEMES.includes(normalized as DeepLinkScheme)) {
    return normalized as DeepLinkScheme;
  }
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

  if (url.host === "deployment-profile" && url.pathname === "/import") {
    const json = decodeProfileJson(url, options.logger);
    if (!json) return null;
    return { type: "deployment-profile", json };
  }

  if (url.host === "app") {
    const path = parseAppRoutePath(url, options.logger);
    if (!path) return null;
    return { type: "app-route", path };
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

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return {
      error: oauthError,
      ...(url.searchParams.get("error_description")
        ? { errorDescription: url.searchParams.get("error_description") ?? "" }
        : {}),
      ...(url.searchParams.get("state")
        ? { state: url.searchParams.get("state") ?? "" }
        : {}),
    };
  }

  const workosBridge = url.searchParams.get("workos_bridge");
  if (workosBridge) {
    const next = normalizeNext(url.searchParams.get("next"));
    return {
      workos_bridge: workosBridge,
      ...(next ? { next } : {}),
    };
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

function normalizeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://thinkwork.local");
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function parseAppRoutePath(
  url: URL,
  logger: Pick<Console, "warn"> | undefined,
): string | null {
  if (url.hash || url.username || url.password) {
    logger?.warn("[desktop] rejected app-route deep link with unsafe parts");
    return null;
  }

  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) {
    logger?.warn("[desktop] rejected app-route deep link with invalid path");
    return null;
  }

  const path = `${url.pathname}${url.search}`;
  if (
    !(
      path === "/settings" ||
      path.startsWith("/settings/") ||
      path.startsWith("/settings?")
    )
  ) {
    logger?.warn(
      "[desktop] rejected app-route deep link with disallowed route",
    );
    return null;
  }

  return path;
}

function decodeProfileJson(
  url: URL,
  logger: Pick<Console, "warn"> | undefined,
): string | null {
  const encoded = url.searchParams.get("profile");
  const json = url.searchParams.get("json");
  if (encoded && json) {
    logger?.warn(
      "[desktop] rejected deployment profile deep link with two payloads",
    );
    return null;
  }

  if (json?.trim()) return json;

  if (!encoded?.trim()) {
    logger?.warn(
      "[desktop] rejected deployment profile deep link without payload",
    );
    return null;
  }

  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    logger?.warn("[desktop] rejected deployment profile deep link payload");
    return null;
  }
}

export function isDeepLinkUrl(value: string): boolean {
  try {
    const scheme = new URL(value).protocol.replace(/:$/, "");
    return DEEP_LINK_SCHEMES.includes(scheme as DeepLinkScheme);
  } catch {
    return false;
  }
}
