/**
 * THINK-168 U4: docked artifact panel behavior in the transcript.
 *
 * The panel itself is stubbed — its data fetching + live refresh are covered
 * in ThreadArtifactPanel.test.tsx; here we cover the transcript wiring:
 * card click → per-thread panel open/close, survival across re-renders and
 * remounts, and the "(No message content)" placeholder suppression when a
 * collapsed emission's card IS the message content.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskReviewJsonRenderFixture } from "./json-render/fixtures";

vi.mock("@/components/apps/InlineAppletEmbed", () => ({
  InlineAppletEmbed: ({ appId }: { appId: string }) => (
    <div data-testid="inline-applet-embed-stub" data-app-id={appId} />
  ),
}));

const { tenantMock } = vi.hoisted(() => ({
  tenantMock: { isOperator: false, roleResolved: true },
}));
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantMock,
}));

vi.mock("urql", async () => {
  const actual = await vi.importActual<typeof import("urql")>("urql");
  return {
    ...actual,
    useMutation: () => [{ fetching: false }, vi.fn()],
  };
});

// react-resizable-panels chokes on apps/web's ResizeObserver stub — render
// plain passthroughs so the chat/panel split mounts deterministically
// (same workaround as ComposerWorkspaceEditor.test.tsx).
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    ResizablePanelGroup: pass,
    ResizablePanel: pass,
    ResizableHandle: () => <div data-testid="resizable-handle" />,
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a
      href={to.replace(
        /\$(\w+)/g,
        (_match, key: string) => params?.[key] ?? `$${key}`,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

// Stub the panel: renders the artifact id + a close button wired to onClose.
vi.mock("@/components/artifacts/ThreadArtifactPanel", () => ({
  ThreadArtifactPanel: ({
    artifactId,
    onClose,
  }: {
    artifactId: string;
    onClose: () => void;
  }) => (
    <aside data-testid="panel-stub" data-artifact-id={artifactId}>
      <button type="button" data-testid="panel-stub-close" onClick={onClose} />
    </aside>
  ),
}));

import { TaskThreadView, type TaskThread } from "./TaskThreadView";
import { resetThreadArtifactPanels } from "@/components/artifacts/thread-artifact-panel-store";

afterEach(() => {
  cleanup();
  resetThreadArtifactPanels();
});

function bornCanvasThread(
  threadId = "thread-1",
  extraMessages: TaskThread["messages"] = [],
): TaskThread {
  return {
    id: threadId,
    title: "Born as artifact",
    lifecycleStatus: "COMPLETED",
    messages: [
      {
        id: "message-1",
        role: "ASSISTANT",
        // Collapsed emission with no prose — the card is the whole message.
        content: "",
        parts: [createTaskReviewJsonRenderFixture()],
        durableArtifact: {
          id: "artifact-canvas-1",
          title: "Onboarding review canvas",
          type: "DATA_VIEW",
          status: "DRAFT",
          headVersion: 0,
          metadata: {
            kind: "json_render_canvas",
            stablePartId: "json-render:task-review:123",
          },
        },
      },
      ...extraMessages,
    ],
  };
}

describe("TaskThreadView docked artifact panel (THINK-168)", () => {
  it("suppresses the '(No message content)' placeholder when the card is the message content", () => {
    render(<TaskThreadView thread={bornCanvasThread()} />);

    expect(screen.getByTestId("artifact-card")).toBeTruthy();
    expect(screen.queryByText("(No message content)")).toBeNull();
  });

  it("keeps the placeholder for genuinely empty assistant messages", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Empty",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "message-1", role: "ASSISTANT", content: "" }],
        }}
      />,
    );

    expect(screen.getByText("(No message content)")).toBeTruthy();
  });

  it("opens the panel on card click, closes it from the panel, and keeps the thread transcript mounted", () => {
    render(<TaskThreadView thread={bornCanvasThread()} />);

    expect(screen.queryByTestId("panel-stub")).toBeNull();
    fireEvent.click(screen.getByTestId("artifact-card"));

    const panel = screen.getByTestId("panel-stub");
    expect(panel.dataset.artifactId).toBe("artifact-canvas-1");
    // Transcript + composer remain usable beside the panel.
    expect(screen.getByTestId("thread-conversation-content")).toBeTruthy();
    expect(screen.getByLabelText("Follow up")).toBeTruthy();

    fireEvent.click(screen.getByTestId("panel-stub-close"));
    expect(screen.queryByTestId("panel-stub")).toBeNull();
  });

  it("panel state survives re-renders with new messages (message send / refetch)", () => {
    const { rerender } = render(<TaskThreadView thread={bornCanvasThread()} />);
    fireEvent.click(screen.getByTestId("artifact-card"));
    expect(screen.getByTestId("panel-stub")).toBeTruthy();

    // A refetch after sending a message replaces the thread object and adds
    // messages — the panel selection must not reset.
    rerender(
      <TaskThreadView
        thread={bornCanvasThread("thread-1", [
          { id: "message-2", role: "USER", content: "follow up" },
        ])}
      />,
    );
    expect(screen.getByTestId("panel-stub").dataset.artifactId).toBe(
      "artifact-canvas-1",
    );
  });

  it("panel state survives a full unmount/remount of the thread view", () => {
    const { unmount } = render(<TaskThreadView thread={bornCanvasThread()} />);
    fireEvent.click(screen.getByTestId("artifact-card"));
    unmount();

    render(<TaskThreadView thread={bornCanvasThread()} />);
    expect(screen.getByTestId("panel-stub").dataset.artifactId).toBe(
      "artifact-canvas-1",
    );
  });

  it("panel state is per-thread — another thread renders without a panel", () => {
    render(<TaskThreadView thread={bornCanvasThread("thread-1")} />);
    fireEvent.click(screen.getByTestId("artifact-card"));
    cleanup();

    render(<TaskThreadView thread={bornCanvasThread("thread-2")} />);
    expect(screen.queryByTestId("panel-stub")).toBeNull();

    cleanup();
    render(<TaskThreadView thread={bornCanvasThread("thread-1")} />);
    expect(screen.getByTestId("panel-stub")).toBeTruthy();
  });
});
