import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutateMock, bindingData, kbDocs } = vi.hoisted(() => ({
  mutateMock: vi.fn((_input: unknown) => Promise.resolve({ error: undefined })),
  bindingData: {
    tenantAgent: {
      id: "agent-1",
      knowledgeBases: [{ knowledgeBaseId: "other-kb" }],
    },
    spaces: [{ id: "space-1", name: "Onboarding", knowledgeBases: [] }],
  },
  kbDocs: {
    KnowledgeBaseBindingsQuery: Symbol("bindings"),
    SetAgentKnowledgeBasesMutation: Symbol("setAgent"),
    SetSpaceKnowledgeBasesMutation: Symbol("setSpace"),
  },
}));

vi.mock("urql", () => ({
  useQuery: () => [{ data: bindingData, fetching: false }, vi.fn()],
  useMutation: () => [{ fetching: false }, mutateMock],
}));

vi.mock("@/lib/kb-queries", () => kbDocs);

import { SettingsKnowledgeBaseBinding } from "./SettingsKnowledgeBaseBinding";

beforeEach(() => mutateMock.mockClear());
afterEach(cleanup);

describe("SettingsKnowledgeBaseBinding", () => {
  it("renders tenant-wide + per-Space toggles", () => {
    render(<SettingsKnowledgeBaseBinding kbId="kb-1" tenantId="t1" />);
    expect(screen.getByText("Tenant-wide")).toBeTruthy();
    expect(screen.getByText("Onboarding")).toBeTruthy();
    // kb-1 is not yet bound tenant-wide → switch is off.
    expect(screen.getAllByRole("switch")[0].getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("writes the union set when binding tenant-wide (replace-all semantics)", async () => {
    render(<SettingsKnowledgeBaseBinding kbId="kb-1" tenantId="t1" />);
    fireEvent.click(screen.getAllByRole("switch")[0]); // tenant-wide
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0][0] as {
      agentId: string;
      knowledgeBases: { knowledgeBaseId: string }[];
    };
    expect(arg.agentId).toBe("agent-1");
    const ids = arg.knowledgeBases.map((b) => b.knowledgeBaseId).sort();
    expect(ids).toEqual(["kb-1", "other-kb"]); // existing binding preserved
  });

  it("writes the space set with this KB added when binding per-Space", async () => {
    render(<SettingsKnowledgeBaseBinding kbId="kb-1" tenantId="t1" />);
    fireEvent.click(screen.getAllByRole("switch")[1]); // space row
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0][0] as {
      input: { spaceId: string; knowledgeBases: { knowledgeBaseId: string }[] };
    };
    expect(arg.input.spaceId).toBe("space-1");
    expect(arg.input.knowledgeBases).toEqual([{ knowledgeBaseId: "kb-1" }]);
  });
});
