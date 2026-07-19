/**
 * Review rail tests (THINK-320 U6, R4/R18): candidate rows from the
 * schema-graph feed, the overflow banner, and pagination past the canvas's
 * 30-ghost cap so every candidate stays reachable.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OntologyReviewRail,
  RAIL_PAGE_SIZE,
  ontologyCandidateLabel,
  type OntologyRailCandidate,
} from "./OntologyReviewRail";

afterEach(cleanup);

function candidate(
  index: number,
  overrides: Partial<OntologyRailCandidate> = {},
): OntologyRailCandidate {
  return {
    itemId: `item-${index}`,
    changeSetId: "set-1",
    itemType: "ENTITY_TYPE",
    slug: `candidate_${index}`,
    proposedValue: { slug: `candidate_${index}`, name: `Candidate ${index}` },
    editedValue: null,
    evidenceCount: index,
    origin: "suggestion_engine",
    status: "PENDING_REVIEW",
    ...overrides,
  } as OntologyRailCandidate;
}

describe("OntologyReviewRail", () => {
  it("renders one row per pending candidate with evidence and origin", () => {
    const onSelect = vi.fn();
    render(
      <OntologyReviewRail
        candidates={[candidate(1), candidate(2)]}
        loading={false}
        error={null}
        overflowCount={0}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Candidate 1")).toBeTruthy();
    expect(screen.getByText("Candidate 2")).toBeTruthy();
    expect(screen.getByText("2 evidence")).toBeTruthy();
    expect(screen.getAllByText("suggested")).toHaveLength(2);

    fireEvent.click(screen.getByText("Candidate 1"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "item-1" }),
    );
  });

  it("shows the overflow banner when ghosts spill past the canvas cap (R18)", () => {
    render(
      <OntologyReviewRail
        candidates={[candidate(1)]}
        loading={false}
        error={null}
        overflowCount={12}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("12 proposals");
  });

  it("hides the banner when everything fits on the canvas", () => {
    render(
      <OntologyReviewRail
        candidates={[candidate(1)]}
        loading={false}
        error={null}
        overflowCount={0}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("paginates past the 30-ghost overflow so every candidate is reachable", () => {
    const candidates = Array.from({ length: 65 }, (_, index) =>
      candidate(index + 1),
    );
    render(
      <OntologyReviewRail
        candidates={candidates}
        loading={false}
        error={null}
        overflowCount={35}
        onSelect={vi.fn()}
      />,
    );

    expect(RAIL_PAGE_SIZE).toBe(30);
    expect(screen.getByText("Candidate 30")).toBeTruthy();
    expect(screen.queryByText("Candidate 31")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Show 30 more/ }));
    expect(screen.getByText("Candidate 60")).toBeTruthy();
    expect(screen.queryByText("Candidate 61")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Show 5 more/ }));
    expect(screen.getByText("Candidate 65")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show .* more/ })).toBeNull();
  });

  it("labels candidates from the edited value when present, falling back to slug", () => {
    expect(
      ontologyCandidateLabel(
        candidate(1, {
          editedValue: { name: "Edited Name" },
        }),
      ),
    ).toBe("Edited Name");
    expect(
      ontologyCandidateLabel(
        candidate(2, { proposedValue: {}, editedValue: null }),
      ),
    ).toBe("candidate_2");
  });

  it("renders the steady-state copy instead of a blank rail (U7)", () => {
    render(
      <OntologyReviewRail
        candidates={[]}
        loading={false}
        error={null}
        overflowCount={0}
        onSelect={vi.fn()}
      />,
    );

    const empty = screen.getByText(/All caught up/);
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain("next scheduled scan");
  });
});
