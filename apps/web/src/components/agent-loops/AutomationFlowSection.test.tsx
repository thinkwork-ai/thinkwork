import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
} from "react";
import type { ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationFlowSection } from "./AutomationFlowSection";
import type { AgentLoopRow, SaveAgentLoopPayload } from "./agent-loop-types";
import type { RoutineAslGraph } from "@/components/routines/routineAslGraph";

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

vi.mock("urql", () => ({
  useQuery: () => [{ data: undefined, fetching: false }],
}));

// The real canvas is React Flow; render its nodes as plain buttons so tests
// can click-select without a DOM layout engine.
vi.mock("@/components/routines/RoutineFlowCanvas", () => ({
  RoutineFlowCanvas: ({
    graph,
    onSelectNode,
  }: {
    graph: RoutineAslGraph;
    onSelectNode?: (nodeId: string | null) => void;
  }) => (
    <div data-testid="canvas">
      {graph.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          data-testid={`canvas-node-${node.id}`}
          onClick={() => onSelectNode?.(node.id)}
        >
          {node.label}
          {node.subtitle ? ` — ${node.subtitle}` : ""}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@thinkwork/ui", () => {
  const SheetContext = createContext<{
    open: boolean;
    setOpen: (open: boolean) => void;
  }>({
    open: false,
    setOpen: () => undefined,
  });
  const findTriggerProps = (children: React.ReactNode) => {
    let props: { id?: string; "aria-label"?: string } = {};
    Children.forEach(children, (child) => {
      if (
        isValidElement(child) &&
        (child as ReactElement<{ "aria-label"?: string }>).props["aria-label"]
      ) {
        props = (child as ReactElement<{ id?: string; "aria-label"?: string }>)
          .props;
      }
    });
    return props;
  };
  return {
    Sheet: ({
      open = false,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      children: React.ReactNode;
    }) => (
      <SheetContext.Provider
        value={{ open, setOpen: (next) => onOpenChange?.(next) }}
      >
        {children}
      </SheetContext.Provider>
    ),
    SheetTrigger: ({
      children,
    }: {
      children: React.ReactElement<{
        onClick?: React.MouseEventHandler<HTMLElement>;
      }>;
    }) => {
      const sheet = useContext(SheetContext);
      return cloneElement(children, { onClick: () => sheet.setOpen(true) });
    },
    SheetContent: ({ children }: { children: React.ReactNode }) => {
      const sheet = useContext(SheetContext);
      return sheet.open ? (
        <div role="dialog">
          {children}
          <button
            type="button"
            aria-label="Close"
            onClick={() => sheet.setOpen(false)}
          />
        </div>
      ) : null;
    },
    SheetHeader: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    SheetTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    SheetDescription: ({ children }: { children: React.ReactNode }) => (
      <p>{children}</p>
    ),
    Button: ({
      children,
      variant: _variant,
      size: _size,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: string;
      size?: string;
    }) => <button {...props}>{children}</button>,
    Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea {...props} />
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input {...props} />
    ),
    Popover: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    PopoverContent: ({
      children,
    }: {
      children: React.ReactNode;
      className?: string;
      align?: string;
    }) => <div>{children}</div>,
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => {
      const trigger = findTriggerProps(children);
      return (
        <select
          id={trigger.id}
          aria-label={trigger["aria-label"]}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectItem: ({
      value,
      children,
      disabled,
    }: {
      value: string;
      children: React.ReactNode;
      disabled?: boolean;
    }) => (
      <option value={value} disabled={disabled}>
        {children}
      </option>
    ),
  };
});

const LOOP: AgentLoopRow = {
  id: "loop-1",
  tenantId: "tenant-1",
  name: "THINK-227 Smoke Report Daily",
  slug: "smoke-report",
  description: null,
  lifecycleStatus: "active",
  enabled: true,
  runAsUserId: "user-1",
  spaceId: "space-1",
  primaryTriggerFamily: "schedule",
  currentVersion: {
    id: "v-1",
    versionNumber: 4,
    triggerSpec: {
      family: "schedule",
      enabled: true,
      config: {
        scheduleType: "cron",
        scheduleExpression: "cron(0 9 ? * MON-FRI *)",
        timezone: "America/Chicago",
      },
    },
    targetSpec: {
      kind: "agent_thread",
      agentThread: {
        instructions: "Refresh the smoke report",
        threadMode: "new_per_run",
        workerId: "agent-1",
        workerType: "agent",
      },
      documentBinding: { mode: "existing", artifactId: "art-1" },
      delivery: {
        recipients: ["eric@thinkwork.ai"],
        subjectTemplate: "Daily Update",
      },
    },
  },
  createdAt: "2026-07-08T00:00:00Z",
  updatedAt: "2026-07-08T00:00:00Z",
};

function renderSection(overrides?: {
  onSave?: (payload: SaveAgentLoopPayload) => Promise<void>;
  loop?: AgentLoopRow;
}) {
  const onSave = overrides?.onSave ?? vi.fn().mockResolvedValue(undefined);
  render(
    <AutomationFlowSection
      tenantId="tenant-1"
      loop={overrides?.loop ?? LOOP}
      workerOptions={[{ id: "agent-1", type: "agent", label: "ThinkWork" }]}
      spaceOptions={[{ id: "space-1", name: "General" }]}
      routineOptions={[]}
      workflowOptions={[]}
      memberOptions={[{ id: "user-1", label: "You" }]}
      currentUserId="user-1"
      statusRail={<div data-testid="status-rail">rail</div>}
      onSave={onSave}
    />,
  );
  return { onSave };
}

afterEach(() => cleanup());

describe("AutomationFlowSection (THINK-247)", () => {
  it("draws the automation as canvas nodes and shows the status rail until a node is selected", () => {
    renderSection();
    expect(screen.getByTestId("canvas-node-trigger")).toBeTruthy();
    expect(screen.getByTestId("canvas-node-work")).toBeTruthy();
    expect(screen.getByTestId("canvas-node-document")).toBeTruthy();
    expect(screen.getByTestId("canvas-node-deliver")).toBeTruthy();
    expect(screen.queryByTestId("status-rail")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(screen.getByTestId("status-rail")).toBeTruthy();
  });

  it("opens the typed deliver inspector with editable recipients and subject", () => {
    renderSection();
    fireEvent.click(screen.getByTestId("canvas-node-deliver"));
    expect(screen.getByTestId("automation-inspector-deliver")).toBeTruthy();
    const recipients = screen.getByLabelText(
      "Delivery recipients",
    ) as HTMLInputElement;
    const subject = screen.getByLabelText("Email subject") as HTMLInputElement;
    expect(recipients.value).toBe("eric@thinkwork.ai");
    expect(subject.value).toBe("Daily Update");
    expect(screen.queryByTestId("status-rail")).toBeNull();
  });

  it("saves edited delivery fields through draftToPayload", async () => {
    const { onSave } = renderSection();
    fireEvent.click(screen.getByTestId("canvas-node-deliver"));
    fireEvent.change(screen.getByLabelText("Delivery recipients"), {
      target: { value: "eric@thinkwork.ai, ops@thinkwork.ai" },
    });
    fireEvent.change(screen.getByLabelText("Email subject"), {
      target: { value: "New subject" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = (onSave as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SaveAgentLoopPayload;
    expect(payload.id).toBe("loop-1");
    expect(payload.targetSpec.delivery).toEqual({
      recipients: ["eric@thinkwork.ai", "ops@thinkwork.ai"],
      subjectTemplate: "New subject",
    });
    // The binding rode along untouched.
    expect(payload.targetSpec.documentBinding).toEqual({
      mode: "existing",
      artifactId: "art-1",
    });
  });

  it("edits instructions from the work inspector and mirrors them onto the node", () => {
    renderSection();
    fireEvent.click(screen.getByTestId("canvas-node-work"));
    fireEvent.change(screen.getByLabelText("Agent instructions"), {
      target: { value: "Completely new marching orders" },
    });
    expect(screen.getByTestId("canvas-node-work").textContent).toContain(
      "Completely new marching orders",
    );
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
  });

  it("surfaces validation errors instead of saving", async () => {
    const { onSave } = renderSection();
    fireEvent.click(screen.getByTestId("canvas-node-work"));
    fireEvent.change(screen.getByLabelText("Agent instructions"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Instructions are required.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("routes an unbound deliver node to the document inspector", () => {
    const loop: AgentLoopRow = {
      ...LOOP,
      currentVersion: {
        ...LOOP.currentVersion!,
        targetSpec: {
          kind: "agent_thread",
          agentThread: {
            instructions: "Refresh the smoke report",
            threadMode: "new_per_run",
          },
        },
      },
    };
    renderSection({ loop });
    fireEvent.click(screen.getByTestId("canvas-node-deliver"));
    fireEvent.click(
      screen.getByRole("button", { name: "Set up the document" }),
    );
    expect(screen.getByTestId("automation-inspector-document")).toBeTruthy();
    expect(screen.getByLabelText("Maintains document")).toBeTruthy();
  });

  it("renaming the automation from the trigger inspector reaches the payload", async () => {
    const { onSave } = renderSection();
    fireEvent.click(screen.getByTestId("canvas-node-trigger"));
    fireEvent.change(screen.getByLabelText("Automation name"), {
      target: { value: "Renamed Automation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = (onSave as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as SaveAgentLoopPayload;
    expect(payload.name).toBe("Renamed Automation");
  });
});
