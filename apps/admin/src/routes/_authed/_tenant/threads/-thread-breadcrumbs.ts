// Pure breadcrumb-decision helper for the thread detail route.
// Extracted so it can be unit-tested without rendering the route. Files prefixed
// with `-` are ignored by TanStack Router's file-based route generation.

export type ThreadBreadcrumbInput = {
  thread:
    | {
        identifier?: string | null;
        number: number;
        title: string;
        computerId?: string | null;
      }
    | null
    | undefined;
  fromAgentId?: string | null;
  fromAgentName?: string | null;
};

export type Breadcrumb = {
  label: string;
  href?: string;
};

// Decision order:
//   1. Explicit Agent provenance via `?fromAgent=...` — preserve the Agent
//      breadcrumb when arriving from an agent page.
//   2. Default — Threads root.
export function buildThreadBreadcrumbs(input: ThreadBreadcrumbInput): Breadcrumb[] {
  const { thread, fromAgentId, fromAgentName } = input;

  const tail: Breadcrumb = {
    label: thread
      ? `${thread.identifier ?? `#${thread.number}`} ${thread.title}`
      : "Loading...",
  };

  if (fromAgentId) {
    return [
      { label: "Agents", href: "/agents" },
      { label: fromAgentName ?? "Agent", href: `/agents/${fromAgentId}` },
      tail,
    ];
  }

  return [{ label: "Threads", href: "/threads" }, tail];
}
