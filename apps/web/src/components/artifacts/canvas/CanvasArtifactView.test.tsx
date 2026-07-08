/**
 * CanvasArtifactView render-half test (THINK-228 U7, AE3).
 *
 * The load-bearing DOM assertion the plan requires: a `run_query`-bound
 * canvas whose headless refresh wrote new `boundData` must show the NEW
 * numbers in the RENDERED widget — not just carry them in the stored JSON.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTableJsonRenderFixture } from "@/components/workbench/json-render/fixtures";
import { CanvasArtifactView } from "./CanvasArtifactView";

vi.mock("urql", () => ({
  useMutation: () => [undefined, vi.fn()],
  useQuery: () => [{ data: undefined, fetching: false }, vi.fn()],
}));

afterEach(() => cleanup());

const ENVELOPE = {
  columns: [
    { name: "name", pg_type: "text" },
    { name: "owner", pg_type: "text" },
    { name: "score", pg_type: "int4" },
  ],
  rows: [["Refreshed row from Postgres", "Analyst", 42]],
  row_count: 1,
  truncated: false,
  stats: {},
  result_file: null,
};

function artifactContent(withBoundData: boolean): string {
  const part = createTableJsonRenderFixture();
  return JSON.stringify({
    type: "data-json-render",
    id: part.id,
    data: part.data,
    ...(withBoundData
      ? {
          boundData: {
            "": {
              payload: {
                content: [{ type: "text", text: JSON.stringify(ENVELOPE) }],
                isError: false,
              },
              fetchedAt: "2026-07-08T12:00:00.000Z",
              shapeHash: "analyst-cols-fnv1a:test",
            },
          },
        }
      : {}),
  });
}

function artifact(content: string) {
  return {
    id: "artifact-1",
    title: "Threads per tenant",
    status: "active",
    headVersion: 1,
    content,
    versions: [],
  };
}

describe("CanvasArtifactView (AE3 render half)", () => {
  it("renders the emission-time numbers when no refresh has happened", () => {
    render(<CanvasArtifactView artifact={artifact(artifactContent(false))} />);
    expect(screen.getByText("Kickoff onboarding")).toBeTruthy();
    expect(screen.queryByText("Refreshed row from Postgres")).toBeNull();
  });

  it("renders the REFRESHED numbers once boundData carries a run_query envelope", () => {
    render(<CanvasArtifactView artifact={artifact(artifactContent(true))} />);
    // The rendered table shows the refreshed data…
    expect(screen.getByText("Refreshed row from Postgres")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    // …and the stale emission-time rows are gone from the DOM.
    expect(screen.queryByText("Kickoff onboarding")).toBeNull();
  });
});
