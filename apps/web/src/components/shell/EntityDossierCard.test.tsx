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
import type { EntityDossierResult } from "@/gql/graphql";

function renderCard(
  result: EntityDossierResult | null,
  overrides?: Partial<Parameters<typeof EntityDossierCard>[0]>,
) {
  const onOpenThread = vi.fn();
  const onOpenArtifact = vi.fn();
  const onSelectEntity = vi.fn();
  const utils = render(
    <EntityDossierCard
      result={result}
      fetching={false}
      onOpenThread={onOpenThread}
      onOpenArtifact={onOpenArtifact}
      onSelectEntity={onSelectEntity}
      {...overrides}
    />,
  );
  return {
    ...utils,
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
      canonicalEntityId: null,
      entityType: null,
      twinProjected: false,
      memories: [],
      threads: [],
      artifacts: [],
      ...match,
    },
  } as EntityDossierResult;
}

describe("EntityDossierCard", () => {
  afterEach(cleanup);

  it("renders a match with memories, threads, and artifacts (no entity open row — THINK-339 U15)", () => {
    const { onOpenThread } = renderCard(
      matchResult({
        canonicalEntityId: "can-acme",
        entityType: "customer",
        twinProjected: true,
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

    // Entity label heading; the twin-explorer open row retired with the
    // in-product Company Brain surfaces (THINK-339 U15).
    expect(screen.getByTestId("group-heading").textContent).toContain(
      "Acme Corp",
    );
    expect(screen.queryByText("Open Acme Corp")).toBeNull();
    expect(screen.getByText("Acme renewed their contract")).toBeTruthy();
    expect(screen.getByText("Acme onboarding")).toBeTruthy();
    expect(screen.getByText("Acme proposal")).toBeTruthy();

    fireEvent.click(screen.getByText("Acme onboarding"));
    expect(onOpenThread).toHaveBeenCalledWith({ id: "t9", spaceId: "space-2" });
  });

  it("renders memories and threads without any entity open action", () => {
    renderCard(
      matchResult({
        canonicalEntityId: null,
        entityType: "customer",
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

    expect(screen.queryByText(/^Open /)).toBeNull();
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
