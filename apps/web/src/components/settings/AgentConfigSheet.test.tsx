/**
 * Config sheet tests (Agent page merge, THINK-132 U1).
 *
 * The Default Agent settings section relocated from the Agents page renders
 * inside a side sheet on the Composer surface. urql hooks are mocked directly
 * so query payloads and mutation captures are deterministic; Radix Select
 * interactions are not exercised in jsdom — field coverage asserts rendered
 * values and the goal-budget save path, which uses plain input + button.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryResponses, executeMutationMock, toastErrorMock } = vi.hoisted(
  () => ({
    queryResponses: new Map<string, { data?: unknown; error?: unknown }>(),
    executeMutationMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
);

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    const key = queryKeyOf(query);
    const response = queryResponses.get(key) ?? {};
    return [
      { data: response.data, error: response.error, fetching: false },
      vi.fn(),
    ];
  },
  useMutation: (mutation: unknown) => [
    { fetching: false },
    (variables: unknown) =>
      Promise.resolve(
        executeMutationMock(queryKeyOf(mutation), variables) ?? {},
      ),
  ],
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", isOperator: true }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

// Identify tagged query documents by their operation name substring. Update
// names are checked first because the read names are substrings of them.
function queryKeyOf(doc: unknown): string {
  const text = JSON.stringify(doc) ?? "";
  for (const name of [
    "UpdateTenantGoalBudget",
    "UpdateTenantAgent",
    "TenantModelCatalog",
    "TenantGoalBudget",
    "TenantAgent",
  ]) {
    if (text.includes(name)) return name;
  }
  return "unknown";
}

import {
  AgentConfigSection,
  AgentConfigSheet,
} from "@/components/settings/AgentConfigSheet";

const SPACES = [
  { id: "space-1", name: "Default" },
  { id: "space-2", name: "Ops" },
];

function seedHappyQueries() {
  queryResponses.set("TenantAgent", {
    data: {
      agent: {
        id: "agent-1",
        runtime: "FLUE",
        model: "kimi-k2.5",
        runtimeConfig: JSON.stringify({ defaultSpaceId: "space-1" }),
      },
    },
  });
  queryResponses.set("TenantModelCatalog", {
    data: {
      tenantModelCatalog: [
        { modelId: "kimi-k2.5", displayName: "Kimi K2.5" },
        { modelId: "sonnet-4.6", displayName: "Sonnet 4.6" },
      ],
    },
  });
  queryResponses.set("TenantGoalBudget", {
    data: { tenant: { settings: { goalDefaultTokenBudget: 100000 } } },
  });
}

beforeEach(() => {
  queryResponses.clear();
  executeMutationMock.mockReset();
  toastErrorMock.mockReset();
  seedHappyQueries();
});

afterEach(() => {
  cleanup();
});

describe("AgentConfigSection", () => {
  it("renders all four Default Agent fields from query data", () => {
    render(<AgentConfigSection spaces={SPACES} />);
    expect(screen.getByText("Runtime")).toBeTruthy();
    expect(screen.getByText("Default Space")).toBeTruthy();
    expect(screen.getByText("Default model")).toBeTruthy();
    expect(screen.getByText("Goal token budget")).toBeTruthy();
    expect(
      (screen.getByLabelText("Goal token budget") as HTMLInputElement).value,
    ).toBe("100000");
  });

  it("saves a valid goal budget through the goal-budget mutation", async () => {
    executeMutationMock.mockReturnValue({ data: {} });
    render(<AgentConfigSection spaces={SPACES} />);
    const input = screen.getByLabelText("Goal token budget");
    fireEvent.change(input, { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByLabelText("Goal token budget");
    expect(executeMutationMock).toHaveBeenCalledWith("UpdateTenantGoalBudget", {
      tenantId: "tenant-1",
      input: { goalDefaultTokenBudget: 250000 },
    });
  });

  it("blocks saving an invalid goal budget", () => {
    render(<AgentConfigSection spaces={SPACES} />);
    const input = screen.getByLabelText("Goal token budget");
    fireEvent.change(input, { target: { value: "-5" } });
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(executeMutationMock).not.toHaveBeenCalled();
  });

  it("clears the budget by saving blank as null", async () => {
    executeMutationMock.mockReturnValue({ data: {} });
    render(<AgentConfigSection spaces={SPACES} />);
    const input = screen.getByLabelText("Goal token budget");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByLabelText("Goal token budget");
    expect(executeMutationMock).toHaveBeenCalledWith("UpdateTenantGoalBudget", {
      tenantId: "tenant-1",
      input: { goalDefaultTokenBudget: null },
    });
  });

  it("shows the degraded model row when the catalog query fails", () => {
    queryResponses.set("TenantModelCatalog", {
      error: new Error("catalog down"),
    });
    render(<AgentConfigSection spaces={SPACES} />);
    expect(screen.getByText("(model catalog unavailable)")).toBeTruthy();
  });
});

describe("AgentConfigSheet", () => {
  it("renders the section inside the sheet when open", () => {
    render(
      <AgentConfigSheet open onOpenChange={vi.fn()} spaces={SPACES} />,
    );
    expect(screen.getByTestId("agent-config-sheet")).toBeTruthy();
    expect(screen.getByText("Agent configuration")).toBeTruthy();
    expect(screen.getByText("Default Agent")).toBeTruthy();
  });

  it("closes via onOpenChange on escape", () => {
    const onOpenChange = vi.fn();
    render(
      <AgentConfigSheet open onOpenChange={onOpenChange} spaces={SPACES} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing when closed", () => {
    render(
      <AgentConfigSheet
        open={false}
        onOpenChange={vi.fn()}
        spaces={SPACES}
      />,
    );
    expect(screen.queryByTestId("agent-config-sheet")).toBeNull();
  });
});
