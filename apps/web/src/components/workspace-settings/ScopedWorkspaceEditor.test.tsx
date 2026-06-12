import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFilesClient } from "@thinkwork/workspace-editor";
import type { WorkspaceFilesTarget } from "@/lib/workspace-files-api";

const { editorSpy, tenant, apiFetch } = vi.hoisted(() => ({
  editorSpy: vi.fn(),
  tenant: { isOperator: true, roleResolved: true },
  apiFetch: vi.fn(),
}));

vi.mock("@thinkwork/workspace-editor", () => ({
  WorkspaceFileEditor: (props: Record<string, unknown>) => {
    editorSpy(props);
    return <div data-testid="editor" data-readonly={String(props.readOnly)} />;
  },
}));
vi.mock("@/context/TenantContext", () => ({ useTenant: () => tenant }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

import { ScopedWorkspaceEditor } from "./ScopedWorkspaceEditor";
import { spacesWorkspaceFilesClient } from "@/lib/workspace-files-api";

function lastEditorProps(): {
  target: WorkspaceFilesTarget;
  client: WorkspaceFilesClient<WorkspaceFilesTarget>;
  readOnly: boolean;
  defaultOpenFile?: string;
  targetKey: string;
} {
  return editorSpy.mock.calls.at(-1)![0];
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  tenant.isOperator = true;
  tenant.roleResolved = true;
});

describe("ScopedWorkspaceEditor", () => {
  it("passes the single source target straight through with the shared client", () => {
    render(
      <ScopedWorkspaceEditor
        target={{ agentId: "agent-1" }}
        targetKey="agent:agent-1"
      />,
    );
    const props = lastEditorProps();
    // No consolidated wrapper: the agent surface only ever addresses the agent
    // source — there is no userId/spaceId for the tree to fan out to.
    expect(props.target).toEqual({ agentId: "agent-1" });
    expect(props.client).toBe(spacesWorkspaceFilesClient);
    expect(props.readOnly).toBe(false);
  });

  it("scopes the user surface to the userId target (AE6)", () => {
    render(
      <ScopedWorkspaceEditor
        target={{ userId: "user-9" }}
        targetKey="user:user-9"
      />,
    );
    const props = lastEditorProps();
    expect(props.target).toEqual({ userId: "user-9" });
    expect(props.client).toBe(spacesWorkspaceFilesClient);
  });

  it("scopes the Space surface to the spaceId target", () => {
    render(
      <ScopedWorkspaceEditor
        target={{ spaceId: "space-1" }}
        targetKey="space:space-1"
      />,
    );
    expect(lastEditorProps().target).toEqual({ spaceId: "space-1" });
  });

  it("renders read-only for a non-operator", () => {
    tenant.isOperator = false;
    render(
      <ScopedWorkspaceEditor
        target={{ userId: "user-9" }}
        targetKey="user:user-9"
      />,
    );
    expect(screen.getByTestId("editor").getAttribute("data-readonly")).toBe(
      "true",
    );
  });

  it("renders read-only until the caller's role resolves", () => {
    tenant.roleResolved = false;
    render(
      <ScopedWorkspaceEditor
        target={{ agentId: "agent-1" }}
        targetKey="agent:agent-1"
      />,
    );
    expect(screen.getByTestId("editor").getAttribute("data-readonly")).toBe(
      "true",
    );
  });

  it("narrows to a sub-folder when pathPrefix is set: lists only that subtree and re-prefixes writes", async () => {
    render(
      <ScopedWorkspaceEditor
        target={{ agentId: "agent-1" }}
        targetKey="agent-profiles:agent-1"
        pathPrefix="agents/"
      />,
    );
    const { client } = lastEditorProps();
    expect(client).not.toBe(spacesWorkspaceFilesClient);

    apiFetch.mockResolvedValueOnce({
      files: [
        { path: "AGENTS.md", source: "agent", sha256: "" },
        { path: "agents/research.md", source: "agent", sha256: "" },
        { path: "skills/web/SKILL.md", source: "agent", sha256: "" },
      ],
    });
    const { files } = await client.listFiles({ agentId: "agent-1" });
    // The baseline and skills/ stay invisible inside the agents/ scope.
    expect(files.map((f) => f.path)).toEqual(["research.md"]);

    apiFetch.mockResolvedValueOnce({ ok: true });
    await client.putFile({ agentId: "agent-1" }, "research.md", "body");
    const body = JSON.parse(apiFetch.mock.calls.at(-1)![1].body as string);
    expect(body).toMatchObject({
      action: "put",
      agentId: "agent-1",
      path: "agents/research.md",
    });
  });
});
