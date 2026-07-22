import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Deterministic per-rail broker results, keyed by the requested source. Each
// test seeds this before rendering.
const legResults = vi.hoisted(
  () =>
    new Map<
      string,
      { data?: unknown; fetching?: boolean; error?: { message: string } }
    >(),
);

vi.mock("urql", () => ({
  useQuery: (opts: { variables: { sources: string[] } }) => {
    const source = opts.variables.sources[0];
    const result = legResults.get(source) ?? { fetching: true };
    return [result, vi.fn()];
  },
}));

// Minimal Command primitives so we exercise SearchPalette's logic without
// cmdk's jsdom quirks (scrollIntoView, virtual focus, etc.).
vi.mock("@thinkwork/ui", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div role="dialog">{children}</div> : null),
  CommandInput: ({
    value,
    onValueChange,
    onKeyDown,
    ...rest
  }: {
    value: string;
    onValueChange: (v: string) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    [key: string]: unknown;
  }) => (
    <input
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={onKeyDown}
      {...(rest as Record<string, unknown>)}
    />
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => (
    <div data-testid="command-empty">{children}</div>
  ),
  CommandGroup: ({
    heading,
    children,
  }: {
    heading?: string;
    children: ReactNode;
  }) => (
    <div>
      {heading ? <div data-testid="group-heading">{heading}</div> : null}
      {children}
    </div>
  ),
  CommandItem: ({
    value,
    onSelect,
    children,
  }: {
    value: string;
    onSelect: () => void;
    children: ReactNode;
  }) => (
    <div role="option" data-value={value} onClick={onSelect}>
      {children}
    </div>
  ),
  CommandShortcut: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

import { SearchPalette } from "./SearchPalette";
import type { ChatThreadSummary } from "./chat-sidebar-types";

function threadSummary(
  overrides: Partial<ChatThreadSummary> & { id: string },
): ChatThreadSummary {
  return {
    title: `Thread ${overrides.id}`,
    lastActivityAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  } as ChatThreadSummary;
}

function okLeg(source: string, hits: Record<string, unknown>) {
  return {
    data: {
      search: {
        queryId: "q1",
        legs: [{ source, status: "OK", error: null, ...hits }],
      },
    },
    fetching: false,
  };
}

function renderPalette(props?: Partial<Parameters<typeof SearchPalette>[0]>) {
  const onSelectThread = vi.fn();
  const onSelectEntity = vi.fn();
  const onAsk = vi.fn();
  const onResearch = vi.fn();
  const utils = render(
    <SearchPalette
      open
      onOpenChange={vi.fn()}
      tenantId="tenant-1"
      search=""
      onSearchChange={vi.fn()}
      emptyStateThreads={[]}
      pinnedThreadIds={new Set()}
      defaultSpaceIds={new Set()}
      locallyReadThreadAt={new Map()}
      onSelectThread={onSelectThread}
      onSelectEntity={onSelectEntity}
      onAsk={onAsk}
      onResearch={onResearch}
      emptyStateLoading={false}
      emptyStateError={null}
      railsEnabled
      {...props}
    />,
  );
  return {
    ...utils,
    onSelectThread,
    onSelectEntity,
    onAsk,
    onResearch,
  };
}

describe("SearchPalette", () => {
  beforeEach(() => legResults.clear());
  afterEach(cleanup);

  it("empty query shows today's pinned + recent grouped thread view", () => {
    renderPalette({
      search: "",
      emptyStateThreads: [threadSummary({ id: "t1", title: "Kickoff chat" })],
    });

    expect(screen.getByText("Chats")).toBeTruthy();
    expect(screen.getByText("Kickoff chat")).toBeTruthy();
    // No rails or Ask row on an empty query.
    expect(screen.queryByText("Threads")).toBeNull();
  });

  it("typed query renders rails per source and selecting a thread navigates", async () => {
    legResults.set(
      "THREADS",
      okLeg("THREADS", {
        threadHits: [
          {
            id: "t9",
            identifier: "T-9",
            title: "Acme onboarding",
            spaceId: "space-2",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        ],
      }),
    );
    legResults.set(
      "ENTITIES",
      okLeg("ENTITIES", {
        entityHits: [
          {
            entityId: "e1",
            label: "Acme Corp",
            summary: null,
            ontologyTypeSlug: "customer",
            aliases: ["Acme"],
            evidenceCount: 3,
          },
        ],
      }),
    );

    const { onSelectThread } = renderPalette({ search: "acme" });

    await waitFor(() => expect(screen.getByText("Threads")).toBeTruthy());
    // No Wiki rail (THINK-327 U7) — threads + entities only.
    expect(screen.queryByText("Wiki")).toBeNull();
    expect(screen.getByText("Entities")).toBeTruthy();
    expect(screen.getByText("Acme onboarding")).toBeTruthy();
    expect(screen.getAllByText("Acme Corp").length).toBe(1);

    fireEvent.click(screen.getByText("Acme onboarding"));
    expect(onSelectThread).toHaveBeenCalledWith({
      id: "t9",
      spaceId: "space-2",
    });
  });

  it("a rail with zero hits shows its own empty state while others show results", async () => {
    legResults.set(
      "THREADS",
      okLeg("THREADS", {
        threadHits: [
          {
            id: "t9",
            title: "Acme onboarding",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        ],
      }),
    );
    legResults.set("ENTITIES", okLeg("ENTITIES", { entityHits: [] }));

    renderPalette({ search: "acme" });

    await waitFor(() =>
      expect(screen.getByText("Acme onboarding")).toBeTruthy(),
    );
    expect(screen.getAllByText("No matches").length).toBeGreaterThanOrEqual(1);
  });

  it("shows distinct timeout and error rail states without blocking others", async () => {
    legResults.set("THREADS", {
      data: {
        search: {
          queryId: "q1",
          legs: [{ source: "THREADS", status: "TIMEOUT", threadHits: [] }],
        },
      },
      fetching: false,
    });
    legResults.set("ENTITIES", {
      data: {
        search: {
          queryId: "q1",
          legs: [
            {
              source: "ENTITIES",
              status: "ERROR",
              error: "boom",
              entityHits: [],
            },
          ],
        },
      },
      fetching: false,
    });

    renderPalette({ search: "acme" });

    await waitFor(() =>
      expect(screen.getByText("Still searching…")).toBeTruthy(),
    );
    expect(screen.getByText("Search unavailable")).toBeTruthy();
  });

  it("⌘Enter escalates to ask with the current query", () => {
    const { onAsk } = renderPalette({ search: "acme" });
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onAsk).toHaveBeenCalledWith("acme");
  });

  it("the Ask row activates ask", async () => {
    legResults.set("THREADS", okLeg("THREADS", { threadHits: [] }));
    legResults.set("ENTITIES", okLeg("ENTITIES", { entityHits: [] }));

    const { onAsk } = renderPalette({ search: "acme" });
    const askRow = await screen.findByText(/Ask/);
    fireEvent.click(askRow);
    expect(onAsk).toHaveBeenCalledWith("acme");
  });

  it("the Research this row renders on a typed query and activates research", async () => {
    legResults.set("THREADS", okLeg("THREADS", { threadHits: [] }));
    legResults.set("ENTITIES", okLeg("ENTITIES", { entityHits: [] }));

    const { onResearch } = renderPalette({ search: "acme" });
    const researchRow = await screen.findByText(/Research this/);
    fireEvent.click(researchRow);
    expect(onResearch).toHaveBeenCalledWith("acme");
  });

  it("renders the ask view in place of the rails when askView is active", () => {
    legResults.set("THREADS", okLeg("THREADS", { threadHits: [] }));
    legResults.set("ENTITIES", okLeg("ENTITIES", { entityHits: [] }));

    renderPalette({
      search: "acme",
      askView: {
        query: "acme",
        status: "answered",
        activity: [],
        answer: "The renewal closes Friday.",
        error: null,
        threadId: "thread-hidden",
      },
      onAskOpenPermalink: vi.fn(),
      onAskBack: vi.fn(),
    });

    // The ask answer + permalink render; the broker rails do not.
    expect(screen.getByText("The renewal closes Friday.")).toBeTruthy();
    expect(screen.getByText(/open in thread/i)).toBeTruthy();
    expect(screen.queryByText("Wiki")).toBeNull();
    expect(screen.queryByText(/^Ask/)).toBeNull();
  });

  it("with the rails gate off, a typed query renders only thread-only behavior", () => {
    renderPalette({
      search: "acme",
      railsEnabled: false,
      emptyStateThreads: [threadSummary({ id: "t1", title: "Kickoff chat" })],
    });

    expect(screen.getByText("Kickoff chat")).toBeTruthy();
    // No broker rails, no Ask row.
    expect(screen.queryByText("Wiki")).toBeNull();
    expect(screen.queryByText("Entities")).toBeNull();
    expect(screen.queryByText(/Ask/)).toBeNull();
  });
});
