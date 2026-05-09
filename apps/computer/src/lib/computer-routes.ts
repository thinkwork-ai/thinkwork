export class InvalidComputerRouteParamError extends Error {
  constructor(routeName: string, value: string) {
    super(`Invalid ${routeName} route parameter: ${value}`);
    this.name = "InvalidComputerRouteParamError";
  }
}

export const COMPUTER_WORKBENCH_ROUTE = "/computer" as const;
export const COMPUTER_TASKS_ROUTE = "/tasks" as const;
export const COMPUTER_APPS_ROUTE = "/apps" as const;

export const COMPUTER_ROUTE_LABELS = {
  computer: "Computer",
  tasks: "Threads",
  apps: "Apps",
} as const;

export function computerTaskRoute(taskId: string): string {
  return `${COMPUTER_TASKS_ROUTE}/${safeRouteId("task", taskId)}`;
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
