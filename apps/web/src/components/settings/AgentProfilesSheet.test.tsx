/**
 * Profiles sheet tests (Agent page merge, THINK-132 U2).
 *
 * List → detail editing in a sheet: create lands on detail, built-in
 * profiles keep the delete guard, the Advanced disclosure hides expert
 * fields, no capability chips render for skills/MCP, and saves preserve
 * the policy JSON keys the sheet no longer owns (tree-first grants).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryResponses, executeMutationMock } = vi.hoisted(() => ({
  queryResponses: new Map<string, { data?: unknown; error?: unknown }>(),
  executeMutationMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    const key = docKeyOf(query);
    const response = queryResponses.get(key) ?? {};
    return [
      { data: response.data, error: response.error, fetching: false },
      vi.fn(),
    ];
  },
  useMutation: (mutation: unknown) => [
    { fetching: false },
    (variables: unknown) =>
      Promise.resolve(executeMutationMock(docKeyOf(mutation), variables) ?? {}),
  ],
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", isOperator: true }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function docKeyOf(doc: unknown): string {
  const text = JSON.stringify(doc) ?? "";
  for (const name of [
    "CreateAgentProfile",
    "DeleteAgentProfile",
    "UpdateAgentProfile",
    "AgentProfiles",
  ]) {
    if (text.includes(name)) return name;
  }
  return "unknown";
}

import { AgentProfilesSheet } from "@/components/settings/AgentProfilesSheet";

const ANALYST = {
  id: "profile-analyst",
  slug: "analyst",
  name: "Analyst",
  description: "Delegates data analysis.",
  routingGuidance: "Use for data subtasks.",
  instructions: "Analyze carefully.",
  modelId: "sonnet-4.6",
  model: { displayName: "Sonnet 4.6" },
  enabled: true,
  builtInKey: null,
  toolPolicy: { builtInTools: ["bash"], mcpServers: ["github"] },
  skillPolicy: { skillSlugs: ["repo-review"], pinned: true },
  executionControls: {},
  spaces: [],
};

const REVIEWER = {
  ...ANALYST,
  id: "profile-reviewer",
  slug: "reviewer",
  name: "Reviewer",
  builtInKey: "reviewer",
};

function seed() {
  queryResponses.set("AgentProfiles", {
    data: {
      agentProfiles: [ANALYST, REVIEWER],
      agentProfileEditorCatalog: {
        models: [
          { id: "m1", modelId: "sonnet-4.6", displayName: "Sonnet 4.6" },
        ],
        spaces: [{ id: "space-1", name: "Default" }],
        skills: [],
        builtInTools: ["bash", "execute_code"],
        mcpServers: [],
      },
    },
  });
}

beforeEach(() => {
  queryResponses.clear();
  executeMutationMock.mockReset();
  seed();
});

afterEach(() => cleanup());

describe("AgentProfilesSheet", () => {
  it("renders the profile list with built-in first and a New profile action", () => {
    render(<AgentProfilesSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("profiles-sheet-list")).toBeTruthy();
    expect(screen.getByTestId("profiles-sheet-new")).toBeTruthy();
    const rows = screen.getAllByTestId(/^profiles-sheet-row-/);
    expect(rows[0].getAttribute("data-testid")).toBe(
      "profiles-sheet-row-reviewer",
    );
  });

  it("opens detail from a list row with Basic fields and no skill/MCP chips", () => {
    render(<AgentProfilesSheet open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("profiles-sheet-row-analyst"));
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Spaces")).toBeTruthy();
    expect(screen.queryByText("MCP Servers")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
  });

  it("deep-links straight to a profile's detail via initialProfileId", () => {
    render(
      <AgentProfilesSheet
        open
        onOpenChange={vi.fn()}
        initialProfileId="profile-analyst"
      />,
    );
    expect(screen.queryByTestId("profiles-sheet-list")).toBeNull();
    expect(screen.getByText("Description")).toBeTruthy();
  });

  it("hides Advanced fields behind the disclosure", () => {
    render(
      <AgentProfilesSheet
        open
        onOpenChange={vi.fn()}
        initialProfileId="profile-analyst"
      />,
    );
    expect(screen.queryByTestId("profiles-sheet-advanced")).toBeNull();
    fireEvent.click(screen.getByTestId("profiles-sheet-advanced-toggle"));
    expect(screen.getByTestId("profiles-sheet-advanced")).toBeTruthy();
    expect(screen.getByText("Closed loop")).toBeTruthy();
    expect(screen.getByText("Built-in tools")).toBeTruthy();
  });

  it("hides delete for built-in profiles and shows it for custom ones", () => {
    const { unmount } = render(
      <AgentProfilesSheet
        open
        onOpenChange={vi.fn()}
        initialProfileId="profile-reviewer"
      />,
    );
    expect(screen.queryByTestId("profiles-sheet-delete")).toBeNull();
    unmount();
    render(
      <AgentProfilesSheet
        open
        onOpenChange={vi.fn()}
        initialProfileId="profile-analyst"
      />,
    );
    expect(screen.getByTestId("profiles-sheet-delete")).toBeTruthy();
  });

  it("save preserves tree-owned policy keys verbatim", async () => {
    executeMutationMock.mockReturnValue({ data: {} });
    render(
      <AgentProfilesSheet
        open
        onOpenChange={vi.fn()}
        initialProfileId="profile-analyst"
      />,
    );
    fireEvent.click(screen.getByTestId("profiles-sheet-save"));
    await screen.findByTestId("profiles-sheet-save");
    const call = executeMutationMock.mock.calls.find(
      ([key]) => key === "UpdateAgentProfile",
    );
    expect(call).toBeTruthy();
    const input = (call![1] as { input: Record<string, unknown> }).input;
    expect(input.toolPolicy).toEqual({
      builtInTools: ["bash"],
      mcpServers: ["github"],
    });
    expect(input.skillPolicy).toEqual({
      skillSlugs: ["repo-review"],
      pinned: true,
    });
  });

  it("create fires the default-payload mutation", async () => {
    executeMutationMock.mockReturnValue({
      data: { createAgentProfile: { id: "profile-new" } },
    });
    render(<AgentProfilesSheet open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("profiles-sheet-new"));
    await screen.findByTestId("agent-profiles-sheet");
    const call = executeMutationMock.mock.calls.find(
      ([key]) => key === "CreateAgentProfile",
    );
    expect(call).toBeTruthy();
  });

  it("imports no capability grant/detach mutations (single write path, R12)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/settings/AgentProfilesSheet.tsx"),
      "utf8",
    );
    expect(source).not.toContain("GrantCapability");
    expect(source).not.toContain("DetachCapability");
  });
});
