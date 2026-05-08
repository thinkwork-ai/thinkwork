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
//   1. Computer ownership (`thread.computerId`) — Computer-owned threads route
//      through /computers, regardless of any `?fromAgent` query param.
//   2. Explicit Agent provenance via `?fromAgent=...` — preserve the existing
//      Agent breadcrumb behavior.
//   3. Default — Threads root.
export function buildThreadBreadcrumbs(input: ThreadBreadcrumbInput): Breadcrumb[] {
  const { thread, fromAgentId, fromAgentName } = input;

  const tail: Breadcrumb = {
    label: thread
      ? `${thread.identifier ?? `#${thread.number}`} ${thread.title}`
      : "Loading...",
  };

  if (thread?.computerId) {
    return [
      { label: "Computers", href: "/computers" },
      {
        label: "Computer",
        href: `/computers/${thread.computerId}`,
      },
      tail,
    ];
  }

  if (fromAgentId) {
    return [
      { label: "Agents", href: "/agents" },
      { label: fromAgentName ?? "Agent", href: `/agents/${fromAgentId}` },
      tail,
    ];
  }

  return [{ label: "Threads", href: "/threads" }, tail];
}
