import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentLoopForm } from "./AgentLoopForm";
import type { AgentLoopWorkerOption } from "./agent-loop-types";

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
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

const workers: AgentLoopWorkerOption[] = [
  { id: "agent-1", type: "agent", label: "Default Agent" },
];

afterEach(() => cleanup());

describe("AgentLoopForm", () => {
  it("requires goal intent and completion criteria before saving", () => {
    render(
      <AgentLoopForm
        mode="create"
        tenantId="tenant-1"
        workerOptions={workers}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("AgentLoop name"), {
      target: { value: "Manual review loop" },
    });

    expect(
      (
        screen.getByRole("button", {
          name: "Create AgentLoop",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("Goal intent is required.")).toBeTruthy();
  });

  it("turns the weekly preset into schedule, goal, judge, policy, and evidence specs", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentLoopForm
        mode="create"
        tenantId="tenant-1"
        workerOptions={workers}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Weekly Agent Check-In/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create AgentLoop" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        name: "Weekly Agent Check-In",
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
});
