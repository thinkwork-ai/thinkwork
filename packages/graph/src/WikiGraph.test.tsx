import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WikiGraph } from "./WikiGraph.js";
import { WikiGraphQuery } from "./queries.js";

const urqlMocks = vi.hoisted(() => ({
  useQuery: vi.fn(() => [{ fetching: true, data: null, error: null }, vi.fn()]),
  query: vi.fn(() => ({ toPromise: vi.fn() })),
}));

vi.mock("urql", () => ({
  useClient: () => ({ query: urqlMocks.query }),
  useQuery: urqlMocks.useQuery,
}));

vi.mock("react-force-graph-3d", async () => {
  const ReactActual = await vi.importActual<typeof React>("react");
  return {
    default: ReactActual.forwardRef(() =>
      ReactActual.createElement("div", { "data-testid": "force-graph" }),
    ),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WikiGraph", () => {
  it("revalidates the graph query so an empty cached graph cannot stick", () => {
    render(
      <WikiGraph tenantId="tenant-1" useRequesterScope searchQuery="Paris" />,
    );

    expect(urqlMocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: WikiGraphQuery,
        variables: { tenantId: "tenant-1", userId: null },
        requestPolicy: "cache-and-network",
        pause: false,
      }),
    );
  });
});
