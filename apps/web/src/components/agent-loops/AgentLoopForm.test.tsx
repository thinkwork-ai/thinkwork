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
  AgentLoopSpaceOption,
  AgentLoopWorkerOption,
} from "./agent-loop-types";

vi.mock("@/components/schedule-picker/SchedulePicker", () => ({
  SchedulePicker: ({
    value,
  }: {
    value: { scheduleExpression: string; timezone: string };
  }) => (
    <div data-testid="schedule-picker">
      {value.scheduleExpression} {value.timezone}
    </div>
  ),
}));

vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsPageTitle: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
  SettingsSection: ({
    label,
    children,
  }: {
    label?: string;
    children: React.ReactNode;
  }) => (
    <section>
      {label ? <h2>{label}</h2> : null}
      {children}
    </section>
  ),
  SettingsRow: ({
    label,
    children,
  }: {
    label: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div>
      <div>{label}</div>
      {children}
    </div>
  ),
}));

vi.mock("@thinkwork/ui", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
  Sheet: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
  Tabs: ({
    children,
    value: _value,
    onValueChange: _onValueChange,
    ...props
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => <div {...props}>{children}</div>,
  TabsContent: ({
    children,
    value: _value,
    ...props
  }: {
    children: React.ReactNode;
    value?: string;
  }) => <div {...props}>{children}</div>,
  TabsList: ({
    children,
    variant: _variant,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { variant?: string }) => (
    <div {...props}>{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value?: string }) => (
    <button {...props} type="button" data-value={value}>
      {children}
    </button>
  ),
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

const workers: AgentLoopWorkerOption[] = [
  { id: "agent-1", type: "agent", label: "Default Agent" },
];
const spaces: AgentLoopSpaceOption[] = [
  { id: "space-1", name: "Customer", slug: "customer" },
];

afterEach(() => cleanup());

describe("AgentLoopForm", () => {
  it("requires a prompt before saving", () => {
    render(
      <AgentLoopForm
        mode="create"
        tenantId="tenant-1"
        workerOptions={workers}
        spaceOptions={spaces}
        defaultSpaceId="space-1"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Create from Chat Draft",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("Goal intent is required.")).toBeTruthy();
  });

  it("saves Manual mode from prompt and default runtime settings", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentLoopForm
        mode="create"
        tenantId="tenant-1"
        workerOptions={workers}
        spaceOptions={spaces}
        defaultSpaceId="space-1"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    expect(screen.queryByText("Worker")).toBeNull();

    fireEvent.change(screen.getByLabelText("Automation prompt"), {
      target: { value: "Route Linear issues to the right worker." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Automation" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        name: "Route Linear issues to the right worker",
        spaceId: "space-1",
        triggerSpec: expect.objectContaining({ family: "manual" }),
        workerSpec: expect.objectContaining({ type: "agent", id: "agent-1" }),
        sourceMetadata: expect.objectContaining({
          creationMode: "easy",
          createdFrom: "settings.automations.easy",
        }),
      }),
    );
  });

  it("defaults creation to chat and confirms a builder draft before saving", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onConfirmBuilderDraft = vi.fn().mockResolvedValue(undefined);
    const onStartBuilder = vi.fn().mockResolvedValue({
      threadCreated: true,
      setupPrompt: "Builder questions",
      draft: {
        creationMode: "chat",
        name: "Linear routing automation",
        objective:
          "Every weekday morning, route Linear issues to the right worker.",
        triggerFamily: "manual",
        scheduleType: "rate",
        scheduleExpression: "rate(7 days)",
        timezone: "UTC",
        maxIterations: "1",
        maxRuntimeMinutes: "30",
        maxTokens: "100000",
        retryBackoffMinutes: "5",
        retentionDays: "30",
        builderThreadId: "thread-1",
      },
      thread: { id: "thread-1", title: "Automation setup" },
    });

    render(
      <AgentLoopForm
        mode="create"
        tenantId="tenant-1"
        workerOptions={workers}
        spaceOptions={spaces}
        defaultSpaceId="space-1"
        onSubmit={onSubmit}
        onStartBuilder={onStartBuilder}
        onConfirmBuilderDraft={onConfirmBuilderDraft}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Chat" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.change(screen.getByLabelText("Automation prompt"), {
      target: {
        value:
          "Every weekday morning, route Linear issues to the right worker.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start chat builder" }));

    await waitFor(() => expect(onStartBuilder).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Open setup thread")).toBeTruthy();
    expect(screen.getByTestId("automation-builder-questions")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Create from Chat Draft",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Apply builder answers" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create from Chat Draft" }),
    );

    await waitFor(() => expect(onConfirmBuilderDraft).toHaveBeenCalledTimes(1));
    expect(onConfirmBuilderDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        name: "Linear routing automation",
        spaceId: "space-1",
        triggerSpec: expect.objectContaining({
          family: "schedule",
          config: expect.objectContaining({
            scheduleExpression: "cron(0 9 ? * MON-FRI *)",
          }),
        }),
        sourceMetadata: expect.objectContaining({
          creationMode: "chat",
          builderThreadId: "thread-1",
        }),
      }),
      "thread-1",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the entered prompt when the builder returns an incomplete draft", async () => {
    const onStartBuilder = vi.fn().mockResolvedValue({
      threadCreated: true,
      setupPrompt: "Builder questions",
      draft: {},
      thread: { id: "thread-1", title: "Automation setup" },
    });

    render(
      <AgentLoopForm
        mode="create"
        tenantId="tenant-1"
        workerOptions={workers}
        spaceOptions={spaces}
        defaultSpaceId="space-1"
        onSubmit={vi.fn()}
        onStartBuilder={onStartBuilder}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Automation prompt"), {
      target: { value: "Route Linear issues to the right worker." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start chat builder" }));

    await waitFor(() => expect(onStartBuilder).toHaveBeenCalledTimes(1));
    expect(
      (screen.getByLabelText("Automation prompt") as HTMLTextAreaElement).value,
    ).toBe("Route Linear issues to the right worker.");
  });

  it("opens templates in a side sheet and applies the weekly preset", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentLoopForm
        mode="create"
        tenantId="tenant-1"
        workerOptions={workers}
        spaceOptions={spaces}
        defaultSpaceId="space-1"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Open templates"));
    fireEvent.click(
      screen.getByRole("button", { name: /Weekly Agent Check-In/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Automation" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        name: "Weekly Agent Check-In",
        spaceId: "space-1",
        triggerSpec: expect.objectContaining({
          family: "schedule",
          config: expect.objectContaining({
            scheduleExpression: "rate(7 days)",
          }),
        }),
        goalSpec: expect.objectContaining({
          objective: expect.stringContaining("weekly check-in"),
          completionCriteria: expect.arrayContaining([
            "Summarizes notable progress.",
          ]),
        }),
        workerSpec: expect.objectContaining({ type: "agent", id: "agent-1" }),
        judgeSpec: expect.objectContaining({ mode: "self_check" }),
        loopPolicy: expect.objectContaining({
          maxIterations: 1,
          maxRuntimeMs: 1_800_000,
          maxTokens: 100000,
        }),
        evidencePolicy: expect.objectContaining({
          redactionState: "summary_only",
        }),
      }),
    );
  });

  it("keeps Advanced settings in an inspector and saves explicit criteria", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentLoopForm
        mode="create"
        tenantId="tenant-1"
        workerOptions={workers}
        spaceOptions={spaces}
        defaultSpaceId="space-1"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Completion criteria")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Goal intent"), {
      target: { value: "Review failed jobs and summarize the fix path." },
    });
    fireEvent.change(screen.getByLabelText("Completion criteria"), {
      target: {
        value: "The failure is summarized.\nThe next action is clear.",
      },
    });
    fireEvent.change(screen.getByLabelText("Judge criteria"), {
      target: { value: "The summary is specific." },
    });
    fireEvent.change(screen.getByLabelText("Max iterations"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Automation" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMetadata: expect.objectContaining({
          creationMode: "advanced",
        }),
        goalSpec: expect.objectContaining({
          completionCriteria: [
            "The failure is summarized.",
            "The next action is clear.",
          ],
        }),
        judgeSpec: expect.objectContaining({
          criteria: ["The summary is specific."],
        }),
        loopPolicy: expect.objectContaining({ maxIterations: 3 }),
      }),
    );
  });
});
