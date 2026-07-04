import { Children, isValidElement } from "react";
import type { ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentLoopForm } from "./AgentLoopForm";
import type {
  AgentLoopMemberOption,
  AgentLoopRoutineOption,
  AgentLoopRow,
  AgentLoopSpaceOption,
  AgentLoopWorkerOption,
} from "./agent-loop-types";

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

vi.mock("@thinkwork/ui", () => {
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
    Dialog: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
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
    DialogContent: ({
      children,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    DialogFooter: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
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

const workers: AgentLoopWorkerOption[] = [
  { id: "agent-1", type: "agent", label: "Default Agent" },
];
const spaces: AgentLoopSpaceOption[] = [
  { id: "space-1", name: "Customer", slug: "customer" },
];
const members: AgentLoopMemberOption[] = [{ id: "user-1", label: "You" }];
const ROUTINE_ID = "33333333-3333-4333-8333-333333333333";
const routines: AgentLoopRoutineOption[] = [
  { id: ROUTINE_ID, name: "Nightly digest" },
];

function baseProps() {
  return {
    tenantId: "tenant-1",
    workerOptions: workers,
    spaceOptions: spaces,
    routineOptions: routines,
    workflowOptions: [] as AgentLoopRoutineOption[],
    memberOptions: members,
    currentUserId: "user-1",
    onCancel: vi.fn(),
  };
}

afterEach(() => cleanup());

describe("AgentLoopForm (compact dialog)", () => {
  it("creates a schedule → routine automation with the correct targetSpec and no Space", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentLoopForm
        mode="create"
        {...baseProps()}
        spaceOptions={[]}
        onSubmit={onSubmit}
      />,
    );

    // Borderless title + prompt live in the dialog body.
    expect(screen.getByLabelText("Automation name")).toBeTruthy();
    expect(screen.getByLabelText("Agent instructions")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Target"), {
      target: { value: "routine" },
    });
    fireEvent.change(screen.getByLabelText("Routine"), {
      target: { value: ROUTINE_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Nightly digest",
        spaceId: null,
        runAsUserId: "user-1",
        triggerSpec: expect.objectContaining({ family: "schedule" }),
        targetSpec: {
          kind: "routine",
          routine: { routineId: ROUTINE_ID },
        },
      }),
    );
  });

  it("requires a Space for webhook → agent_thread and shows the pre-save webhook placeholder", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentLoopForm
        mode="create"
        {...baseProps()}
        spaceOptions={[]}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Trigger"), {
      target: { value: "webhook" },
    });
    expect(screen.getByTestId("webhook-panel")).toBeTruthy();
    expect(
      screen.getByText("URL and token generate after you save."),
    ).toBeTruthy();
    // Inline (not submit-only) space requirement, rendered in the Space row.
    expect(
      screen.getByText("A Space is required for agent-thread automations."),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Agent instructions"), {
      target: { value: "Handle the webhook payload." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));

    expect(screen.getByText("Choose a Space.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("round-trips all R1 fields when editing", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentLoopForm
        mode="edit"
        {...baseProps()}
        initialLoop={editLoop()}
        onSubmit={onSubmit}
      />,
    );

    expect(
      (screen.getByLabelText("Automation name") as HTMLInputElement).value,
    ).toBe("Linear dispatcher");
    expect(
      (screen.getByLabelText("Agent instructions") as HTMLTextAreaElement)
        .value,
    ).toBe("Dispatch issues to the right worker.");
    // Webhook trigger → the Trigger row reads "webhook" and the panel renders.
    expect((screen.getByLabelText("Trigger") as HTMLSelectElement).value).toBe(
      "webhook",
    );
    expect(screen.getByTestId("webhook-panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "loop-1",
        name: "Linear dispatcher",
        runAsUserId: "user-9",
        spaceId: "space-1",
        triggerSpec: expect.objectContaining({ family: "webhook" }),
        targetSpec: expect.objectContaining({
          kind: "agent_thread",
          agentThread: expect.objectContaining({
            instructions: "Dispatch issues to the right worker.",
            threadMode: "new_per_run",
          }),
        }),
      }),
    );
  });

  it("serializes schedule popover presets to EventBridge cron config and renders the row value", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentLoopForm mode="create" {...baseProps()} onSubmit={onSubmit} />,
    );

    // Default seed (rate(7 days)) reads as Weekly on the closed row.
    expect(
      screen.getByRole("button", { name: "Schedule" }).textContent,
    ).toContain("Weekly");

    fireEvent.change(screen.getByLabelText("Schedule preset"), {
      target: { value: "weekdays" },
    });
    // Row value text reflects the preset + time.
    expect(
      screen.getByRole("button", { name: "Schedule" }).textContent,
    ).toContain("Weekdays at 9:00 AM");
    // 15-minute increment time control.
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: String(17 * 60 + 45) },
    });
    expect(
      screen.getByRole("button", { name: "Schedule" }).textContent,
    ).toContain("Weekdays at 5:45 PM");

    fireEvent.change(screen.getByLabelText("Agent instructions"), {
      target: { value: "Review my open Linear issues." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSpec: expect.objectContaining({
          family: "schedule",
          config: expect.objectContaining({
            scheduleType: "cron",
            scheduleExpression: "cron(45 17 ? * MON-FRI *)",
            timezone: "UTC",
          }),
        }),
      }),
    );
  });

  it("passes a custom schedule expression through raw", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentLoopForm mode="create" {...baseProps()} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText("Schedule preset"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("Custom schedule expression"), {
      target: { value: "rate(30 minutes)" },
    });
    expect(
      screen.getByRole("button", { name: "Schedule" }).textContent,
    ).toContain("Custom");

    fireEvent.change(screen.getByLabelText("Agent instructions"), {
      target: { value: "Poll the queue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSpec: expect.objectContaining({
          family: "schedule",
          config: expect.objectContaining({
            scheduleType: "rate",
            scheduleExpression: "rate(30 minutes)",
          }),
        }),
      }),
    );
  });

  it("renders the minted webhook endpoint in edit mode after save", () => {
    render(
      <AgentLoopForm
        mode="edit"
        {...baseProps()}
        initialLoop={editLoop({
          webhookEndpoint: {
            webhookId: "wh-1",
            token: "supersecrettoken",
            path: "/webhooks/supersecrettoken",
            enabled: true,
          },
        })}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("/webhooks/supersecrettoken")).toBeTruthy();
    expect(screen.getByLabelText("Copy token")).toBeTruthy();
    // The pre-save placeholder is gone once an endpoint exists.
    expect(
      screen.queryByText("URL and token generate after you save."),
    ).toBeNull();
  });
});

function editLoop(overrides: Partial<AgentLoopRow> = {}): AgentLoopRow {
  return {
    id: "loop-1",
    tenantId: "tenant-1",
    name: "Linear dispatcher",
    slug: "linear-dispatcher",
    description: "Route Linear work.",
    lifecycleStatus: "active",
    enabled: true,
    runAsUserId: "user-9",
    spaceId: "space-1",
    primaryTriggerFamily: "webhook",
    currentVersionId: "version-1",
    currentVersionNumber: 2,
    currentVersion: {
      id: "version-1",
      versionNumber: 2,
      triggerSpec: { family: "webhook", enabled: true, config: {} },
      goalSpec: {},
      workerSpec: {},
      loopPolicy: {},
      targetSpec: {
        kind: "agent_thread",
        agentThread: {
          instructions: "Dispatch issues to the right worker.",
          workerId: "agent-1",
          workerType: "agent",
          threadMode: "new_per_run",
        },
      },
    },
    lastRunId: null,
    lastRunStatus: null,
    lastRunAt: null,
    lastRunSummary: {},
    createdAt: "2026-06-22T12:00:00.000Z",
    updatedAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  };
}
