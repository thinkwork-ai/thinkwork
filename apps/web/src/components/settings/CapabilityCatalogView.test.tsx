/**
 * Catalog view tests (THINK-280 U2): the read-only governed-catalog surface.
 * Covers loading, error/retry, first-use empty, filtered-empty, grouping by
 * namespace, admitted-version + candidate badges, and the per-operation
 * contract table with verbatim withheld reasons.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryState, refetchMock, queryDocs } = vi.hoisted(() => ({
  queryState: {
    catalog: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  refetchMock: vi.fn(),
  queryDocs: {
    CapabilityRuntimeCatalogQuery: Symbol("capabilityRuntimeCatalog"),
  },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.CapabilityRuntimeCatalogQuery) {
      return [queryState.catalog, refetchMock];
    }
    throw new Error("unexpected query");
  },
}));
vi.mock("@/lib/capability-runtime-queries", () => queryDocs);

import { CapabilityCatalogView } from "./CapabilityCatalogView";

const CATALOG = [
  {
    id: "def-1",
    tenantId: "tenant-1",
    namespace: "github",
    class: "connection",
    slug: "github-rest",
    displayName: "GitHub REST",
    status: "active",
    createdAt: "2026-07-10T00:00:00Z",
    versions: [
      {
        id: "ver-1",
        version: 1,
        lifecycle: "admitted",
        descriptorFingerprint: "aaaa1111bbbb2222",
        createdAt: "2026-07-10T00:00:00Z",
      },
      {
        id: "ver-2",
        version: 2,
        lifecycle: "candidate",
        descriptorFingerprint: "cccc3333dddd4444",
        createdAt: "2026-07-12T00:00:00Z",
      },
    ],
    admittedVersion: {
      id: "ver-1",
      version: 1,
      lifecycle: "admitted",
      descriptorFingerprint: "aaaa1111bbbb2222",
      admittedAt: "2026-07-11T00:00:00Z",
      operations: [
        {
          operationId: "get_user",
          twcap: "twcap://github/github-rest/1/get_user",
          contractHash: "hash-1",
          effect: "read",
          principalModes: ["requester", "service"],
          approvalPolicy: "never",
          costClass: "low",
          latencyClass: "fast",
          outputClass: "structured",
          executable: true,
          withheldReasons: [],
        },
        {
          operationId: "delete_repo",
          twcap: "twcap://github/github-rest/1/delete_repo",
          contractHash: "hash-2",
          effect: "delete",
          principalModes: ["service"],
          approvalPolicy: "always",
          costClass: "low",
          latencyClass: "fast",
          outputClass: "structured",
          executable: false,
          withheldReasons: ["destructive effect requires unknown output class"],
        },
      ],
    },
  },
  {
    id: "def-2",
    tenantId: null,
    namespace: "stripe",
    class: "connection",
    slug: "stripe-api",
    displayName: "Stripe API",
    status: "active",
    createdAt: "2026-07-09T00:00:00Z",
    versions: [],
    admittedVersion: null,
  },
];

beforeEach(() => {
  queryState.catalog = { data: undefined, fetching: false, error: undefined };
  refetchMock.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("CapabilityCatalogView", () => {
  it("renders the loading skeleton while fetching", () => {
    queryState.catalog = { data: undefined, fetching: true, error: undefined };
    render(<CapabilityCatalogView tenantId="tenant-1" />);
    expect(screen.getByTestId("capability-catalog-loading")).toBeTruthy();
  });

  it("renders the error state and retries on click", () => {
    queryState.catalog = {
      data: undefined,
      fetching: false,
      error: { message: "boom" },
    };
    render(<CapabilityCatalogView tenantId="tenant-1" />);
    expect(screen.getByRole("alert").textContent).toContain("boom");
    fireEvent.click(screen.getByTestId("capability-catalog-retry"));
    expect(refetchMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("renders the first-use empty state when the catalog has no definitions", () => {
    queryState.catalog = {
      data: { capabilityRuntimeCatalog: [] },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityCatalogView tenantId="tenant-1" />);
    expect(screen.getByTestId("capability-catalog-empty")).toBeTruthy();
  });

  it("groups definitions by namespace with admitted version, candidate, and platform badges", () => {
    queryState.catalog = {
      data: { capabilityRuntimeCatalog: CATALOG },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityCatalogView tenantId="tenant-1" />);
    expect(screen.getByTestId("catalog-row-github-rest")).toBeTruthy();
    expect(screen.getByTestId("catalog-row-stripe-api")).toBeTruthy();
    // Admitted version + a newer candidate awaiting review.
    expect(screen.getByText("admitted v1")).toBeTruthy();
    expect(
      screen.getByTestId("catalog-candidate-github-rest").textContent,
    ).toContain("candidate v2");
    // Platform-scoped definition (tenantId null) is labelled.
    expect(screen.getByText("platform")).toBeTruthy();
    // No admitted version on the platform def.
    expect(screen.getByText("no admitted version")).toBeTruthy();
  });

  it("expands a definition to the operation table with verbatim withheld reasons", () => {
    queryState.catalog = {
      data: { capabilityRuntimeCatalog: CATALOG },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityCatalogView tenantId="tenant-1" />);
    fireEvent.click(screen.getByTestId("catalog-row-github-rest"));
    expect(screen.getByTestId("catalog-ops-github-rest")).toBeTruthy();
    expect(screen.getByText("get_user")).toBeTruthy();
    expect(screen.getByText("executable")).toBeTruthy();
    expect(screen.getByText("withheld")).toBeTruthy();
    expect(
      screen.getByTestId("catalog-withheld-github-rest-delete_repo")
        .textContent,
    ).toContain("destructive effect requires unknown output class");
  });

  it("filters definitions and renders the filtered-empty state", () => {
    queryState.catalog = {
      data: { capabilityRuntimeCatalog: CATALOG },
      fetching: false,
      error: undefined,
    };
    render(<CapabilityCatalogView tenantId="tenant-1" />);
    const filter = screen.getByTestId("capability-catalog-filter");
    fireEvent.change(filter, { target: { value: "stripe" } });
    expect(screen.queryByTestId("catalog-row-github-rest")).toBeNull();
    expect(screen.getByTestId("catalog-row-stripe-api")).toBeTruthy();
    fireEvent.change(filter, { target: { value: "no-such-thing" } });
    expect(
      screen.getByTestId("capability-catalog-filtered-empty"),
    ).toBeTruthy();
  });

  it("imports no mutations — read-only by contract", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/settings/CapabilityCatalogView.tsx"),
      "utf8",
    );
    expect(source).not.toContain("useMutation");
  });
});
