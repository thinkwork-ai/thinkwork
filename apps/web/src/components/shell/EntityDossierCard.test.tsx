import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Minimal Command primitives (mirrors SearchPalette.test.tsx) so we exercise the
// card's rendering logic without cmdk's jsdom quirks.
vi.mock("@thinkwork/ui", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
  CommandGroup: ({
    heading,
    children,
  }: {
    heading?: ReactNode;
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
    onSelect?: () => void;
    children: ReactNode;
  }) => (
    <div role="option" data-value={value} onClick={() => onSelect?.()}>
      {children}
    </div>
  ),
  CommandShortcut: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

import { EntityDossierCard } from "./EntityDossierCard";
import { WikiPageType } from "@/gql/graphql";
import type { EntityDossierResult } from "@/gql/graphql";

function renderCard(
  result: EntityDossierResult | null,
  overrides?: Partial<Parameters<typeof EntityDossierCard>[0]>,
) {
  const onOpenWikiPage = vi.fn();
  const onOpenThread = vi.fn();
  const onOpenArtifact = vi.fn();
  const onSelectEntity = vi.fn();
  const utils = render(
    <EntityDossierCard
      result={result}
      fetching={false}
      onOpenWikiPage={onOpenWikiPage}
      onOpenThread={onOpenThread}
      onOpenArtifact={onOpenArtifact}
      onSelectEntity={onSelectEntity}
      {...overrides}
    />,
  );
  return {
    ...utils,
    onOpenWikiPage,
    onOpenThread,
    onOpenArtifact,
    onSelectEntity,
  };
}

// Loosely typed (like SearchPalette.test.tsx's leg builders) so partial fixture
// objects — e.g. a wikiPage with only the fields the card reads — don't have to
// satisfy every generated schema field.
function matchResult(match: Record<string, unknown>): EntityDossierResult {
  return {
    disambiguation: [],
    match: {
      entityId: "e1",
      label: "Acme Corp",
      ontologyTypeSlug: "customer",
      summary: null,
      aliases: ["Acme"],
      wikiPage: null,
      memories: [],
      threads: [],
      artifacts: [],
      ...match,
    },
  } as EntityDossierResult;
}

describe("EntityDossierCard", () => {
  afterEach(cleanup);

  it("renders a match with a wiki row plus memories, threads, and artifacts", () => {
    const { onOpenWikiPage, onOpenThread } = renderCard(
      matchResult({
        wikiPage: {
          id: "w1",
          type: WikiPageType.Entity,
          slug: "acme",
          title: "Acme Corp",
          displayType: "Customer",
        },
        memories: [
          {
            memoryRecordId: "m1",
            text: "Acme renewed their contract",
            score: 0.9,
            threadId: "t-mem",
            createdAt: "2026-07-12T00:00:00.000Z",
          },
        ],
        threads: [
          {
            id: "t9",
            identifier: "T-9",
            title: "Acme onboarding",
            spaceId: "space-2",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        ],
        artifacts: [
          {
            id: "a1",
            title: "Acme proposal",
            type: "document",
            threadId: null,
          },
        ],
      }),
    );

    // Entity label heading + wiki row.
    expect(screen.getByTestId("group-heading").textContent).toContain(
      "Acme Corp",
    );
    expect(screen.getByText("Open Acme Corp page")).toBeTruthy();
    expect(screen.getByText("Acme renewed their contract")).toBeTruthy();
    expect(screen.getByText("Acme onboarding")).toBeTruthy();
    expect(screen.getByText("Acme proposal")).toBeTruthy();

    fireEvent.click(screen.getByText("Open Acme Corp page"));
    expect(onOpenWikiPage).toHaveBeenCalledWith({
      type: "ENTITY",
      slug: "acme",
    });

    fireEvent.click(screen.getByText("Acme onboarding"));
    expect(onOpenThread).toHaveBeenCalledWith({ id: "t9", spaceId: "space-2" });
  });

  it("degrades to memories/threads when the entity has no wiki page", () => {
    renderCard(
      matchResult({
        wikiPage: null,
        memories: [
          {
            memoryRecordId: "m1",
            text: "A grounded memory",
            score: 0.5,
            threadId: null,
            createdAt: null,
          },
        ],
        threads: [
          {
            id: "t1",
            identifier: "T-1",
            title: "Kickoff",
            spaceId: null,
            updatedAt: null,
          },
        ],
      }),
    );

    expect(screen.queryByText(/page$/)).toBeNull();
    expect(screen.getByText("A grounded memory")).toBeTruthy();
    expect(screen.getByText("Kickoff")).toBeTruthy();
  });

  it("renders 'Did you mean…' candidates and selects one", () => {
    const { onSelectEntity } = renderCard({
      match: null,
      disambiguation: [
        {
          entityId: "e1",
          label: "Acme Corp",
          ontologyTypeSlug: "customer",
          summary: null,
          aliases: [],
          evidenceCount: 3,
        },
        {
          entityId: "e2",
          label: "Acme Inc",
          ontologyTypeSlug: "customer",
          summary: null,
          aliases: [],
          evidenceCount: 1,
        },
      ],
    } as EntityDossierResult);

    expect(screen.getByText("Did you mean…")).toBeTruthy();
    expect(screen.getByText("customer · 3 mentions")).toBeTruthy();
    expect(screen.getByText("customer · 1 mention")).toBeTruthy();

    fireEvent.click(screen.getByText("Acme Inc"));
    expect(onSelectEntity).toHaveBeenCalledWith("e2");
  });

  it("renders nothing with no match and no disambiguation", () => {
    const { container } = renderCard({
      match: null,
      disambiguation: [],
    } as EntityDossierResult);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while fetching before any result", () => {
    const { container } = renderCard(null, { fetching: true });
    expect(container.innerHTML).toBe("");
  });

  it("shows a fallback row for a match with no details", () => {
    renderCard(matchResult({}));
    expect(screen.getByText("No details found for this entity.")).toBeTruthy();
  });
});
