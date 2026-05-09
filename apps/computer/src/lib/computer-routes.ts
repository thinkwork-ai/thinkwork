export class InvalidComputerRouteParamError extends Error {
  constructor(routeName: string, value: string) {
    super(`Invalid ${routeName} route parameter: ${value}`);
    this.name = "InvalidComputerRouteParamError";
  }
}

export const COMPUTER_THREADS_ROUTE = "/threads" as const;
export const COMPUTER_NEW_THREAD_ROUTE = "/new" as const;
export const COMPUTER_APPS_ROUTE = "/apps" as const;
export const COMPUTER_MEMORY_ROUTE = "/memory" as const;

export const COMPUTER_ROUTE_LABELS = {
  threads: "Threads",
  newThread: "New",
  apps: "Apps",
  memory: "Memory",
} as const;

export function computerThreadRoute(threadId: string): string {
  return `${COMPUTER_THREADS_ROUTE}/${safeRouteId("thread", threadId)}`;
}

export function computerAppArtifactRoute(artifactId: string): string {
  return `${COMPUTER_APPS_ROUTE}/${safeRouteId("artifact", artifactId)}`;
}

function safeRouteId(routeName: string, value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(trimmed)) {
    throw new InvalidComputerRouteParamError(routeName, value);
  }
  return encodeURIComponent(trimmed);
}
