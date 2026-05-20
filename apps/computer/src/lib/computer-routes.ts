export class InvalidComputerRouteParamError extends Error {
  constructor(routeName: string, value: string) {
    super(`Invalid ${routeName} route parameter: ${value}`);
    this.name = "InvalidComputerRouteParamError";
  }
}

export const COMPUTER_THREADS_ROUTE = "/threads" as const;
export const COMPUTER_SPACES_ROUTE = "/spaces" as const;
// Legacy route that redirects into Spaces for older bookmarks and callbacks.
export const COMPUTER_NEW_THREAD_ROUTE = "/new" as const;
export const COMPUTER_ADMIN_ROUTE = "/admin" as const;
export const COMPUTER_ARTIFACTS_ROUTE = "/artifacts" as const;
export const COMPUTER_MEMORY_ROUTE = "/memory" as const;
export const COMPUTER_CUSTOMIZE_ROUTE = "/customize" as const;

export const COMPUTER_ROUTE_LABELS = {
  threads: "Chat",
  spaces: "Spaces",
  newThread: "Spaces",
  admin: "Admin",
  artifacts: "Artifacts",
  memory: "Memory",
  customize: "Customize",
} as const;

export function computerThreadRoute(threadId: string): string {
  return `${COMPUTER_THREADS_ROUTE}/${safeRouteId("thread", threadId)}`;
}

export function computerArtifactRoute(artifactId: string): string {
  return `${COMPUTER_ARTIFACTS_ROUTE}/${safeRouteId("artifact", artifactId)}`;
}

export function adminAppHref(origin = globalThis.location?.origin): string {
  try {
    const url = new URL(origin);
    if (url.hostname.startsWith("app.")) {
      url.hostname = url.hostname.replace(/^app\./, "admin.");
      return url.toString();
    }
    if (url.hostname.startsWith("computer.")) {
      url.hostname = url.hostname.replace(/^computer\./, "admin.");
      return url.toString();
    }
    return "/admin";
  } catch {
    return "/admin";
  }
}

function safeRouteId(routeName: string, value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(trimmed)) {
    throw new InvalidComputerRouteParamError(routeName, value);
  }
  return encodeURIComponent(trimmed);
}
