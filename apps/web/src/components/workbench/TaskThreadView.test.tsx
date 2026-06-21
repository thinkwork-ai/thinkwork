import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskReviewGenUIFixture } from "@thinkwork/genui";
import { serializeEditor } from "./SkillTokenInput";

// The follow-up composer is a contenteditable token field, not a <textarea>:
// drive it by setting text + firing `input`, and read it back via serialize.
function setFollowUpText(el: HTMLElement, value: string) {
  el.textContent = value;
  fireEvent.input(el);
}
function followUpValue(el: HTMLElement) {
  return serializeEditor(el);
}

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

// The Info Panel "Open thread detail" link is the only @tanstack/react-router
// usage in TaskThreadView; stub Link to a plain anchor so these provider-less
// render tests can assert it without mounting a RouterProvider.
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

import {
  actionRowsForTurn,
  normalizePersistedParts,
  TaskThreadView,
} from "./TaskThreadView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.thinkworkBridge;
  tenantMock.isOperator = false;
  tenantMock.roleResolved = true;
});

function getThinkingDisclosure(index = 0): HTMLElement {
  const regions = screen.getAllByLabelText("Turn activity");
  const el = regions[index];
  expect(el.getAttribute("data-state")).not.toBeNull();
  return el;
}

function openThinkingDisclosure(index = 0): HTMLElement {
  const region = getThinkingDisclosure(index);
  // The collapsed surface has exactly one button (the Reasoning trigger);
  // its accessible name is the status header ("Working…", "Worked for Xs", …).
  const trigger = within(region).getByRole("button");
  fireEvent.click(trigger);
  expect(region.getAttribute("data-state")).toBe("open");
  return region;
}

describe("TaskThreadView", () => {
  it("renders loading as the monospace shimmer state", () => {
    render(<TaskThreadView thread={null} isLoading />);

    const status = screen.getByRole("status", { name: "Loading..." });
    expect(status.querySelectorAll(".tw-shimmer-char").length).toBeGreaterThan(
      0,
    );
    expect(status.querySelector('[aria-hidden="true"]')?.className).toContain(
      "font-mono",
    );
  });

  it("renders transcript messages, generated artifact cards, and command composer", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "CRM pipeline risk",
          lifecycleStatus: "COMPLETED",
          costSummary: 0.42,
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Build a CRM pipeline dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "I created a dashboard app.",
              metadata: {
                summary: "Built a dashboard from CRM opportunity data.",
              },
              toolCalls: [{ name: "data_visualization" }],
              durableArtifact: {
                id: "artifact_123",
                title: "CRM pipeline risk app",
                type: "DATA_VIEW",
                summary: "Stale opportunity analysis",
                metadata: { kind: "research_dashboard" },
              },
            },
          ],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    // Thread title now lives in AppTopBar via PageHeaderContext, not inside TaskThreadView.
    expect(screen.getByText("Build a CRM pipeline dashboard")).toBeTruthy();
    expect(screen.getByText("I created a dashboard app.")).toBeTruthy();
    expect(screen.getByRole("log", { name: "Thread transcript" })).toBeTruthy();
    expect(document.querySelector('[data-message-role="user"]')).toBeTruthy();
    expect(
      document.querySelector('[data-message-role="assistant"]'),
    ).toBeTruthy();
    expect(screen.getByText("Using data_visualization")).toBeTruthy();
    expect(screen.getByText("CRM pipeline risk app")).toBeTruthy();
    expect(screen.queryByTestId("inline-applet-embed-stub")).toBeNull();
    expect(screen.getByLabelText("Follow up")).toBeTruthy();
    // No turn → no turn-level Thinking; tool calls present → no fallback Thinking;
    // per-message Thinking row was removed because it was a duplicate of the
    // authoritative turn-level row.
    expect(screen.queryByText("Thinking")).toBeNull();
    expect(screen.queryByText("Computer planned the response.")).toBeNull();
  });

  it("renders persisted data-genui parts through the shared Thread renderer", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Generated UI reload",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "ASSISTANT",
              content: "",
              parts: [createTaskReviewGenUIFixture()],
            },
          ],
        }}
      />,
    );

    expect(screen.getByTestId("genui-task-review")).toBeTruthy();
    expect(screen.getByText("Review onboarding task")).toBeTruthy();
  });

  it("passes the selected approved model through follow-up submit", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Model picker",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Start with Sonnet",
            },
          ],
        }}
        onSendFollowUp={onSendFollowUp}
        approvedModels={[
          {
            id: "model-haiku",
            modelId: "anthropic.claude-haiku",
            displayName: "Claude Haiku",
            provider: "amazon_bedrock",
            inputCostPerMillion: 0.15,
            outputCostPerMillion: 0.6,
          },
        ]}
        selectedModelId="anthropic.claude-haiku"
        onSelectedModelChange={() => {}}
      />,
    );

    const followUp = screen.getByLabelText("Follow up");
    setFollowUpText(followUp, "Continue on cheaper model");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenCalledWith(
        "Continue on cheaper model",
        [],
        [],
        true,
        [],
        "anthropic.claude-haiku",
      );
    });
  });

  it("renders an agent avatar rail for assistant messages only", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T20:00:00Z"));
    try {
      render(
        <TaskThreadView
          thread={{
            id: "thread-1",
            title: "Identity rail",
            lifecycleStatus: "COMPLETED",
            messages: [
              {
                id: "message-1",
                role: "USER",
                content: "Send me a status email",
              },
              {
                id: "message-2",
                role: "ASSISTANT",
                content: "I sent the status email.",
                createdAt: "2026-05-26T15:00:00Z",
              },
            ],
          }}
        />,
      );
    } finally {
      vi.useRealTimers();
    }

    const avatar = screen.getByTestId("message-avatar-agent");
    expect(avatar).toBeTruthy();
    expect(avatar.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "text-[#54a9ff]",
    );
    expect(screen.getByLabelText("Agent message")).toBeTruthy();
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("5 hr ago")).toBeTruthy();
    const assistantMessage = document.querySelector(
      '[data-message-role="assistant"]',
    );
    expect(assistantMessage?.className ?? "").toContain("my-1");
    expect(assistantMessage?.querySelector('[class*="py-1"]')).toBeTruthy();
    const assistantContent = screen.getByText("Agent").closest(".grid");
    expect(assistantContent?.className ?? "").toContain("gap-0.5");
    expect(assistantContent?.className ?? "").not.toContain("gap-3");
    const bylineName = screen.getByText("Agent");
    expect(bylineName.className).toContain("text-muted-foreground");
    expect(bylineName.className).not.toContain("text-foreground");
    const userMessage = document.querySelector('[data-message-role="user"]');
    expect(userMessage?.querySelector("[data-testid^='message-avatar-']")).toBe(
      null,
    );
  });

  it("renders initials for another user's message", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T20:00:00Z"));
    try {
      render(
        <TaskThreadView
          currentUser={{ id: "user-current", name: "Eric Odom" }}
          thread={{
            id: "thread-1",
            title: "Other user",
            lifecycleStatus: "COMPLETED",
            messages: [
              {
                id: "message-1",
                role: "USER",
                content: "I updated the customer record.",
                createdAt: "2026-05-26T15:00:00Z",
                sender: {
                  type: "USER",
                  id: "user-other",
                  displayName: "Ricky Kwong",
                },
              },
            ],
          }}
        />,
      );
    } finally {
      vi.useRealTimers();
    }

    const avatar = screen.getByTestId("message-avatar-user");
    expect(avatar.textContent).toBe("RK");
    expect(screen.getByLabelText("Ricky Kwong message")).toBeTruthy();
    expect(screen.getByText("Ricky Kwong")).toBeTruthy();
    expect(screen.getByText("5 hr ago")).toBeTruthy();
    const message = document.querySelector('[data-message-role="user"]');
    expect(message?.className ?? "").toContain("my-1");
    expect(message?.className ?? "").toContain("max-w-full");
    expect(message?.className ?? "").not.toContain("ml-auto");
    expect(message?.querySelector('[class*="py-1"]')).toBeTruthy();
    expect(message?.querySelector('[class*="bg-muted"]')).toBeNull();
  });

  it("does not render an avatar for the current user's persisted message", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T20:00:00Z"));
    try {
      render(
        <TaskThreadView
          currentUser={{ id: "user-current", name: "Eric Odom" }}
          thread={{
            id: "thread-1",
            title: "Current user",
            lifecycleStatus: "COMPLETED",
            messages: [
              {
                id: "message-1",
                role: "USER",
                content: "Send me a status email",
                createdAt: "2026-05-26T15:00:00Z",
                sender: {
                  type: "USER",
                  id: "user-current",
                  displayName: "Eric Odom",
                },
              },
            ],
          }}
        />,
      );
    } finally {
      vi.useRealTimers();
    }

    expect(screen.queryByTestId("message-avatar-user")).toBeNull();
    expect(screen.getByText("5 hr ago").className).toContain("pr-1");
    const message = document.querySelector('[data-message-role="user"]');
    expect(message?.className ?? "").toContain("my-1");
    expect(message?.className ?? "").toContain("max-w-[78%]");
  });

  it("uses compact absolute message timestamps after 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T20:00:00Z"));
    const createdAt = "2026-05-24T15:07:00Z";
    try {
      render(
        <TaskThreadView
          thread={{
            id: "thread-1",
            title: "Old timestamp",
            lifecycleStatus: "COMPLETED",
            messages: [
              {
                id: "message-1",
                role: "ASSISTANT",
                content: "Older status.",
                createdAt,
              },
            ],
          }}
        />,
      );
    } finally {
      vi.useRealTimers();
    }

    const date = new Date(createdAt);
    const hours = date.getHours();
    const expected = `${date.getMonth() + 1}/${date.getDate()} ${
      hours % 12 || 12
    }:${String(date.getMinutes()).padStart(2, "0")} ${
      hours < 12 ? "am" : "pm"
    }`;
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText(/hr ago/)).toBeNull();
  });

  it("renders question card tool results as an intake form instead of raw JSON", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Customer onboarding",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "message-1",
              role: "ASSISTANT",
              content: "Please provide the missing onboarding information.",
              toolResults: [
                {
                  _type: "question_card",
                  schema: {
                    id: "customer_onboarding_missing_intake",
                    title: "Missing onboarding information",
                    fields: [
                      {
                        id: "salesRep",
                        type: "text",
                        label: "Sales owner",
                      },
                      {
                        id: "taxExempt",
                        type: "boolean",
                        label: "Are they agricultural or sales-tax exempt?",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("form", { name: /missing onboarding/i }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Sales owner")).toBeTruthy();
    expect(
      screen.getByText("Are they agricultural or sales-tax exempt?"),
    ).toBeTruthy();
    expect(screen.queryByText("Loaded tool result")).toBeNull();
    expect(screen.queryByText(/question_card/)).toBeNull();
  });

  it("submits question card answers through the follow-up callback", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Customer onboarding",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "message-1",
              role: "ASSISTANT",
              content: "Please provide the missing onboarding information.",
              toolResults: [
                {
                  _type: "question_card",
                  schema: {
                    id: "customer_onboarding_missing_intake",
                    title: "Missing onboarding information",
                    fields: [
                      {
                        id: "salesRep",
                        type: "text",
                        label: "Sales owner",
                      },
                      {
                        id: "taxExempt",
                        type: "boolean",
                        label: "Are they agricultural or sales-tax exempt?",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    fireEvent.change(screen.getByLabelText("Sales owner"), {
      target: { value: "Rebecca Odom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "yes" }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenCalledWith(
        [
          "Customer onboarding intake answers:",
          "- sales owner: Rebecca Odom",
          "- tax exempt: yes",
        ].join("\n"),
        [],
        [],
      );
    });
  });

  it("opens a transcript artifact through the artifact panel callback", () => {
    const onSelectArtifact = vi.fn();

    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "CRM pipeline risk",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Build a CRM pipeline dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "I created a dashboard app.",
              durableArtifact: {
                id: "artifact_123",
                title: "CRM pipeline risk app",
                type: "DATA_VIEW",
                summary: "Stale opportunity analysis",
                metadata: { kind: "research_dashboard" },
              },
            },
          ],
        }}
        artifactPanelState={{
          artifacts: [
            {
              id: "artifact_123",
              title: "CRM pipeline risk app",
              type: "DATA_VIEW",
              summary: "Stale opportunity analysis",
              metadata: { kind: "research_dashboard" },
            },
          ],
          selectedArtifactId: "artifact_123",
          isOpen: false,
          onOpenChange: vi.fn(),
          onSelectArtifact,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /open artifact crm pipeline risk app/i,
      }),
    );

    expect(onSelectArtifact).toHaveBeenCalledWith("artifact_123");
    expect(screen.queryByTestId("inline-applet-embed-stub")).toBeNull();
  });

  it("submits the follow-up composer when Enter is pressed", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "CRM pipeline risk",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Build a CRM pipeline dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "I created a dashboard app.",
            },
          ],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    const input = screen.getByLabelText("Follow up");
    setFollowUpText(input, "Please continue");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(onSendFollowUp).toHaveBeenCalledWith(
        "Please continue",
        [],
        [],
        true,
        [],
      ),
    );
  });

  it("renders the selected artifact in the side panel when artifact panel state is open", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "CRM pipeline risk",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Build a CRM pipeline dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "I created a dashboard app.",
              durableArtifact: {
                id: "artifact_123",
                title: "CRM pipeline risk app",
                type: "DATA_VIEW",
                summary: "Stale opportunity analysis",
                metadata: { kind: "research_dashboard" },
              },
            },
          ],
        }}
        artifactPanelState={{
          artifacts: [
            {
              id: "artifact_123",
              title: "CRM pipeline risk app",
              type: "DATA_VIEW",
              summary: "Stale opportunity analysis",
              metadata: { kind: "research_dashboard" },
            },
          ],
          selectedArtifactId: "artifact_123",
          isOpen: true,
          onOpenChange: vi.fn(),
          onSelectArtifact: vi.fn(),
        }}
      />,
    );

    const panel = screen.getByTestId("artifact-side-panel");
    expect(within(panel).queryByText("CRM pipeline risk app")).toBeNull();
    expect(within(panel).getByTestId("inline-applet-embed-stub")).toBeTruthy();
    expect(
      within(panel).queryByRole("button", { name: /maximize artifact panel/i }),
    ).toBeNull();
    expect(
      within(panel).getByRole("separator", { name: /resize artifact panel/i }),
    ).toBeTruthy();
  });

  it("does not mount the artifact side panel when no selected artifact can be displayed", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Artifact loading gap",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "message-1", role: "USER", content: "Open app" }],
        }}
        artifactPanelState={{
          artifacts: [],
          selectedArtifactId: "artifact_123",
          isOpen: true,
          onOpenChange: vi.fn(),
          onSelectArtifact: vi.fn(),
        }}
      />,
    );

    expect(screen.queryByTestId("artifact-side-panel")).toBeNull();
  });

  it("reserves thread width for the info panel with details and downloadable attachments", async () => {
    const onDownloadAttachment = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          identifier: "CHAT-831",
          title: "CRM pipeline risk",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Analyze this file",
            },
          ],
        }}
        infoPanelState={{
          isOpen: true,
          onOpenChange: vi.fn(),
          threadId: "thread-1",
          threadIdentifier: "CHAT-831",
          startedAt: "2026-05-18T20:50:00.000Z",
          startedBy: "Eric Odom",
          agents: ["Executive"],
          attachments: [
            {
              id: "attachment-1",
              name: "general-ledger.xlsx",
              sizeBytes: 2_048,
              mimeType:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              createdAt: "2026-05-18T20:51:00.000Z",
            },
          ],
          checklist: {
            title: "Onboarding checklist",
            tasks: [
              {
                id: "linked-1",
                title: "Get contract signed",
                status: "COMPLETED",
                required: true,
                assigneeDisplay: "Ops",
              },
              {
                id: "linked-2",
                title: "Enter customer information into P21",
                status: "TODO",
                required: true,
              },
            ],
          },
          onDownloadAttachment,
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("thread-conversation-content").className,
    ).toContain("md:pr-[336px]");
    expect(
      screen.getByTestId("thread-conversation-content").className,
    ).toContain("pt-4");
    expect(
      screen.getByTestId("thread-conversation-content").className,
    ).not.toContain("pt-10");
    expect(
      screen.getByTestId("thread-conversation-column").className,
    ).toContain("max-w-[750px]");
    expect(
      screen.getByTestId("thread-conversation-column").className,
    ).toContain("px-3");
    expect(screen.getByTestId("follow-up-composer-dock").className).toContain(
      "md:pr-[336px]",
    );
    expect(
      screen.getByTestId("follow-up-composer-dock").className,
    ).not.toContain("absolute");
    const panel = screen.getByTestId("thread-info-panel");
    expect(panel.className).toContain("w-[300px]");
    expect(panel.className).toContain("absolute");
    expect(panel.className).toContain("right-5");
    expect(panel.className).toContain("top-2.5");
    expect(panel.className).toContain("bottom-4");
    expect(panel.className).not.toContain("max-h-[calc(");
    expect(panel.className).toContain("overflow-hidden");
    expect(panel.className).toContain("md:grid");
    expect(within(panel).getByText(/May 18, 2026/)).toBeTruthy();
    expect(within(panel).getByText("CHAT-831")).toBeTruthy();
    expect(within(panel).getByText("thread-1")).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Copy Thread number" }),
    );
    expect(writeText).toHaveBeenCalledWith("CHAT-831");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Copy Thread ID" }),
    );
    expect(writeText).toHaveBeenCalledWith("thread-1");
    expect(within(panel).getByText("Triggered by Eric Odom")).toBeTruthy();
    expect(within(panel).queryByText("Agents involved")).toBeNull();
    expect(within(panel).queryByText("Executive")).toBeNull();
    expect(within(panel).getByText("Progress")).toBeTruthy();
    expect(within(panel).getByText("50%")).toBeTruthy();
    expect(within(panel).getByText("1/2 required complete")).toBeTruthy();
    // Completed task uses the filled tabler icon in the muted text color (not emerald)
    const completedIcon = within(panel).getByTestId("checklist-icon-completed");
    expect(completedIcon.getAttribute("class") ?? "").toContain(
      "text-white/55",
    );
    expect(completedIcon.getAttribute("class") ?? "").not.toContain("emerald");
    expect(within(panel).queryByText("Ops · Completed")).toBeTruthy();
    expect(within(panel).getByText("Get contract signed")).toBeTruthy();
    expect(
      within(panel).getByText("Enter customer information into P21"),
    ).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole("button", {
        name: /update enter customer information into p21/i,
      }),
    );
    const followUpInput = screen.getByLabelText("Follow up");
    expect(followUpValue(followUpInput)).toBe(
      "Enter customer information into P21: ",
    );
    await waitFor(() => expect(document.activeElement).toBe(followUpInput));
    // Caret is placed at the end of the contenteditable field on prefill.
    const selection = window.getSelection();
    expect(
      Boolean(selection?.focusNode) &&
        followUpInput.contains(selection!.focusNode),
    ).toBe(true);
    fireEvent.click(
      within(panel).getByRole("button", { name: /general-ledger/i }),
    );
    expect(onDownloadAttachment).toHaveBeenCalledWith("attachment-1");
  });

  it("renders Goal summary, review actions, and narrative record counts", async () => {
    const onConfirmCompletion = vi.fn();
    const onRequestChanges = vi.fn();

    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Acme onboarding",
          lifecycleStatus: "IDLE",
          messages: [],
        }}
        infoPanelState={{
          isOpen: true,
          onOpenChange: vi.fn(),
          startedAt: "2026-05-18T20:50:00.000Z",
          startedBy: "Eric Odom",
          agents: [],
          attachments: [],
          onDownloadAttachment: vi.fn(),
          goal: {
            id: "goal-1",
            outcome: "Complete customer onboarding for Acme.",
            mode: "COLLABORATE",
            status: "IN_REVIEW",
            ownerLabel: "Customer onboarding team",
            reviewPolicyLabel: "Human final review required",
            reviewRequired: true,
            readyForReview: true,
            decisionsCount: 1,
            decisionsSummary: "Credit terms requested: yes.",
            handoffsCount: 1,
            handoffsSummary: "Human reviewer: confirm final review.",
            artifactsCount: 1,
            artifactsSummary: "Contract link: https://example.com",
            recordGroups: [
              {
                id: "decisions",
                label: "Decisions",
                sourceFile: "DECISIONS.md",
                count: 1,
                summary: "Credit terms requested: yes.",
                emptyLabel: "No decisions recorded",
                records: [
                  {
                    id: "decision-1",
                    type: "decisions",
                    typeLabel: "Decisions",
                    sourceFile: "DECISIONS.md",
                    text: "Credit terms requested: yes.",
                  },
                ],
              },
              {
                id: "handoffs",
                label: "Handoffs",
                sourceFile: "HANDOFFS.md",
                count: 1,
                summary: "Human reviewer: confirm final review.",
                emptyLabel: "No handoffs recorded",
                records: [
                  {
                    id: "handoff-1",
                    type: "handoffs",
                    typeLabel: "Handoffs",
                    sourceFile: "HANDOFFS.md",
                    text: "Human reviewer: confirm final review.",
                  },
                ],
              },
              {
                id: "artifacts",
                label: "Artifacts",
                sourceFile: "ARTIFACTS.md",
                count: 1,
                summary: "Contract link: https://example.com",
                emptyLabel: "No artifacts summarized",
                records: [
                  {
                    id: "artifact-1",
                    type: "artifacts",
                    typeLabel: "Artifacts",
                    sourceFile: "ARTIFACTS.md",
                    text: "Contract link: https://example.com",
                  },
                ],
              },
            ],
            onConfirmCompletion,
            onRequestChanges,
          },
          checklist: {
            title: "Progress",
            tasks: [
              {
                id: "linked-1",
                title: "Get contract signed",
                status: "COMPLETED",
                required: true,
              },
            ],
          },
        }}
      />,
    );

    const panel = screen.getByRole("complementary", {
      name: "Thread Goal info",
    });
    expect(within(panel).getByText("Goal")).toBeTruthy();
    expect(
      within(panel).getByText("Complete customer onboarding for Acme."),
    ).toBeTruthy();
    expect(within(panel).getByText("In Review")).toBeTruthy();
    expect(within(panel).getByText("Collaborate mode")).toBeTruthy();
    expect(within(panel).getByText("Human final review required")).toBeTruthy();
    expect(within(panel).queryByText("DECISIONS.md")).toBe(null);
    expect(within(panel).queryByText("HANDOFFS.md")).toBe(null);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Request Goal changes" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Request changes" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Describe what needs to change before this Goal can be closed.",
      ),
    ).toBeTruthy();
    const changeRequest = screen.getByLabelText(
      "Change request",
    ) as HTMLTextAreaElement;
    const submit = screen.getByRole("button", {
      name: "Create follow-up",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(changeRequest, {
      target: { value: "Need AP email before closure." },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(onRequestChanges).toHaveBeenCalledWith(
        "Need AP email before closure.",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Request changes" }),
      ).toBeNull(),
    );
    expect(onConfirmCompletion).not.toHaveBeenCalled();

    expect(
      within(panel).queryByRole("button", { name: "View DECISIONS.md" }),
    ).toBe(null);
  });

  it("renders persisted attachment chips in user transcript messages", () => {
    const onDownloadAttachment = vi.fn();

    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Attachment thread",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Here's the financials",
              metadata: {
                attachments: [{ attachmentId: "attachment-1" }],
              },
            },
          ],
        }}
        infoPanelState={{
          isOpen: false,
          onOpenChange: vi.fn(),
          startedAt: "2026-05-18T20:50:00.000Z",
          startedBy: "Eric Odom",
          agents: [],
          attachments: [
            {
              id: "attachment-1",
              name: "Financial Sample.xlsx",
              sizeBytes: 2048,
            },
          ],
          onDownloadAttachment,
        }}
      />,
    );

    const chip = screen.getByRole("button", {
      name: "Download Financial Sample.xlsx",
    });
    fireEvent.click(chip);
    expect(onDownloadAttachment).toHaveBeenCalledWith("attachment-1");
  });

  it("does not turn the Conversation outer into a second scroll container (regression: double scrollbar with artifact side panel)", () => {
    // Regression: TaskThreadView passed `overflow-y-auto` to <Conversation>,
    // which tailwind-merge resolved by overriding the library's default
    // `overflow-y-hidden` on the outer StickToBottom div. Combined with the
    // library's inner scroll container (which sets overflow:auto via a
    // layout effect plus scrollbarGutter "stable both-edges"), the
    // transcript ended up with TWO stacked scroll containers, rendering
    // two adjacent scrollbars at the right edge of the conversation column.
    // The artifact side panel doesn't cause the bug -- it just narrows the
    // column so the double scrollbars become obvious in the gutter between
    // the panels. The outer [role="log"] element must not declare any
    // overflow override that competes with the library's inner scroller.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Double scrollbar regression",
          lifecycleStatus: "RUNNING",
          messages: [
            { id: "m1", role: "USER", content: "Long enough to overflow" },
          ],
        }}
      />,
    );

    const log = screen.getByRole("log", { name: "Thread transcript" });
    expect(log.className).not.toMatch(/overflow-y-auto/);
    expect(log.className).not.toMatch(/overflow-y-scroll/);
    expect(log.className).not.toMatch(/\boverflow-auto\b/);
  });

  it("renders exactly one Thinking row when an assistant message has no tool calls and a turn is running", () => {
    // Regression: before C-01 the per-message fallback ThinkingRow ('Reasoning
    // complete.') fired here on top of the turn-level ThinkingRow, producing
    // two 'Thinking' rows in the case the user originally reported in
    // screenshots #28 / #29 (assistant message used no tools).
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "No-tool assistant",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Read example.com",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "The page title is **Example Domain**.",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByLabelText("Turn activity")).toHaveLength(1);
    expect(screen.queryByText("Reasoning complete.")).toBeNull();
  });

  it("renders exactly one Thinking row when both an assistant message and a running turn exist", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "One thinking only",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Investigate",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "On it.",
              toolCalls: [{ name: "crm_search" }],
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByLabelText("Turn activity")).toHaveLength(1);
    // Anchor the surviving surface to the authoritative turn-level container so
    // a future regression that moves the row back into per-message rendering
    // would fail this test rather than silently keep the count at 1.
    expect(screen.getByLabelText("Turn activity")).toBeTruthy();
    expect(screen.queryByText("Computer planned the response.")).toBeNull();
  });

  it("renders a working row when the thread has no messages", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Blank thread",
          lifecycleStatus: "IDLE",
          messages: [],
        }}
      />,
    );

    expect(screen.getByText("Working…")).toBeTruthy();
    expect(screen.queryByText("Thinking")).toBeNull();
  });

  it("renders streaming assistant chunks below persisted messages", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Streaming thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Think out loud",
            },
          ],
        }}
        streamingChunks={[
          { seq: 1, text: "Working" },
          { seq: 2, text: " on it" },
        ]}
      />,
    );

    expect(screen.getByText("Working on it")).toBeTruthy();
    expect(screen.getByLabelText("ThinkWork is typing")).toBeTruthy();
  });

  it("projects persisted runbook queue parts into the prompt queue after reload", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the research dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "Starting Research Dashboard.",
              metadata: { runbookMessageKey: "runbook-queue:run-1" },
              parts: [
                {
                  type: "data-runbook-queue",
                  id: "runbook-queue:run-1",
                  data: {
                    runbookRunId: "run-1",
                    displayName: "Research Dashboard",
                    status: "QUEUED",
                    phases: [
                      {
                        id: "discover",
                        title: "Discover",
                        tasks: [
                          {
                            id: "task-1",
                            title: "Gather source material",
                            status: "PENDING",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
      />,
    );

    const promptQueue = screen.getByLabelText("Active task queue");
    expect(
      within(promptQueue).getAllByText("Research Dashboard").length,
    ).toBeGreaterThan(0);
    expect(within(promptQueue).getByText("1 task · 1 pending")).toBeTruthy();
    expect(
      within(promptQueue).queryByText("Gather source material"),
    ).toBeNull();
    expect(screen.queryByText("Starting Research Dashboard.")).toBeNull();
  });

  it("projects generic task queue parts without hiding assistant prose", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Research thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Research the market",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "I drafted the research plan.",
              parts: [
                {
                  type: "data-task-queue",
                  id: "task-queue:research-1",
                  data: {
                    queueId: "research-1",
                    title: "Research plan",
                    status: "RUNNING",
                    source: { type: "deep_research", id: "research-1" },
                    items: [
                      {
                        id: "task-1",
                        title: "Collect source evidence",
                        status: "RUNNING",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("I drafted the research plan.")).toBeTruthy();
    const promptQueue = screen.getByLabelText("Active task queue");
    expect(within(promptQueue).getByText("Research plan")).toBeTruthy();
    expect(within(promptQueue).getByText("1 task · 1 running")).toBeTruthy();
  });

  it("renders the active runbook queue above the prompt input", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the research dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              parts: [
                {
                  type: "data-runbook-queue",
                  id: "runbook-queue:run-1",
                  data: {
                    runbookRunId: "run-1",
                    displayName: "Research Dashboard",
                    status: "RUNNING",
                    phases: [
                      {
                        id: "discover",
                        title: "Discover",
                        tasks: [
                          {
                            id: "task-1",
                            title: "Gather source material",
                            status: "COMPLETED",
                          },
                          {
                            id: "task-2",
                            title: "Summarize evidence",
                            status: "RUNNING",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
      />,
    );

    const promptQueue = screen.getByLabelText("Active task queue");
    expect(
      within(promptQueue).getAllByText("Research Dashboard").length,
    ).toBeGreaterThan(0);
    expect(
      within(promptQueue).getByText("2 tasks · 1 completed · 1 running"),
    ).toBeTruthy();
    expect(within(promptQueue).queryByText("Summarize evidence")).toBeNull();
    fireEvent.click(
      within(promptQueue).getByRole("button", { name: "Expand task queue" }),
    );
    expect(within(promptQueue).getByText("Summarize evidence")).toBeTruthy();
    expect(screen.getByLabelText("Follow up")).toBeTruthy();
  });

  it("reserves transcript scroll space for the docked composer and task queue", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 750,
        height: 260,
        top: 0,
        right: 750,
        bottom: 260,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);

    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the CRM dashboard",
            },
          ],
        }}
        runbookQueues={[
          {
            runbookRunId: "run-1",
            displayName: "CRM Dashboard",
            status: "COMPLETED",
            phases: [
              {
                id: "produce",
                title: "Produce",
                tasks: [
                  {
                    id: "task-1",
                    title: "Build dashboard",
                    status: "COMPLETED",
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    await waitFor(() => {
      const transcriptContent = screen
        .getByText("Run the CRM dashboard")
        .closest('[style*="padding-bottom"]') as HTMLElement | null;
      expect(transcriptContent?.style.paddingBottom).toBe("292px");
    });

    rectSpy.mockRestore();
  });

  it("collapses and expands the prompt-area runbook queue", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the CRM dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              parts: [
                {
                  type: "data-runbook-queue",
                  id: "runbook-queue:run-1",
                  data: {
                    runbookRunId: "run-1",
                    displayName: "CRM Dashboard",
                    status: "RUNNING",
                    phases: [
                      {
                        id: "produce",
                        title: "Produce",
                        tasks: [
                          {
                            id: "task-1",
                            title: "Build dashboard",
                            status: "RUNNING",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
      />,
    );

    const promptQueue = screen.getByLabelText("Active task queue");
    const expand = within(promptQueue).getByRole("button", {
      name: "Expand task queue",
    });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(within(promptQueue).getByText("Review tasks")).toBeTruthy();
    expect(within(promptQueue).queryByText("Build dashboard")).toBeNull();

    fireEvent.click(expand);

    const collapse = within(promptQueue).getByRole("button", {
      name: "Collapse task queue",
    });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(within(promptQueue).getByText("Hide tasks")).toBeTruthy();
    expect(within(promptQueue).getByText("Build dashboard")).toBeTruthy();
    expect(
      within(promptQueue).getAllByText("CRM Dashboard").length,
    ).toBeGreaterThan(0);

    fireEvent.pointerDown(document.body);

    expect(
      within(promptQueue)
        .getByRole("button", { name: "Expand task queue" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(within(promptQueue).queryByText("Build dashboard")).toBeNull();

    fireEvent.click(
      within(promptQueue).getByRole("button", { name: "Expand task queue" }),
    );
    expect(within(promptQueue).getByText("Build dashboard")).toBeTruthy();

    const collapseAfterOutsideClick = within(promptQueue).getByRole("button", {
      name: "Collapse task queue",
    });
    fireEvent.click(collapseAfterOutsideClick);

    expect(
      within(promptQueue)
        .getByRole("button", { name: "Expand task queue" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(within(promptQueue).queryByText("Build dashboard")).toBeNull();
  });

  it("renders the prompt queue from durable runbook run data when message parts are missing", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the research dashboard",
            },
          ],
        }}
        runbookQueues={[
          {
            runbookRunId: "run-1",
            displayName: "Research Dashboard",
            status: "RUNNING",
            phases: [
              {
                id: "discover",
                title: "Discover",
                tasks: [
                  {
                    id: "task-1",
                    title: "Gather source material",
                    status: "COMPLETED",
                  },
                  {
                    id: "task-2",
                    title: "Build dashboard",
                    status: "PENDING",
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    const promptQueue = screen.getByLabelText("Active task queue");
    expect(within(promptQueue).getByText("Research Dashboard")).toBeTruthy();
    expect(
      within(promptQueue).getByText("2 tasks · 1 completed · 1 pending"),
    ).toBeTruthy();
  });

  it("shows the active runbook queue as the only progress signal (no standalone shimmer)", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the CRM dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "User approved the CRM Dashboard runbook workflow.",
            },
            {
              id: "message-3",
              role: "ASSISTANT",
              content: "**Completed:** Discover CRM context",
            },
          ],
        }}
        runbookQueues={[
          {
            runbookRunId: "run-1",
            displayName: "CRM Dashboard",
            status: "RUNNING",
            phases: [
              {
                id: "discover",
                title: "Discover",
                tasks: [
                  {
                    id: "task-1",
                    title: "Discover CRM context",
                    status: "COMPLETED",
                  },
                  {
                    id: "task-2",
                    title: "Analyze pipeline",
                    status: "RUNNING",
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    // The standalone task-queue "Processing…" shimmer was removed (KTD2): the
    // running queue itself is the progress signal.
    expect(screen.queryByLabelText("Processing request")).toBeNull();
    const promptQueue = screen.getByLabelText("Active task queue");
    expect(
      within(promptQueue).getByText("2 tasks · 1 completed · 1 running"),
    ).toBeTruthy();
  });

  it("keeps historical completed queues out of the prompt and transcript", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the CRM dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              metadata: { runbookMessageKey: "runbook-queue:run-1" },
              parts: [
                {
                  type: "data-runbook-queue",
                  id: "runbook-queue:run-1",
                  data: {
                    runbookRunId: "run-1",
                    displayName: "CRM Dashboard",
                    status: "COMPLETED",
                    phases: [
                      {
                        id: "produce",
                        title: "Produce",
                        tasks: [
                          {
                            id: "task-1",
                            title: "Build dashboard",
                            status: "COMPLETED",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.queryByLabelText("Active task queue")).toBeNull();
    expect(screen.queryByLabelText("CRM Dashboard queue")).toBeNull();
    expect(screen.queryByText("Build dashboard")).toBeNull();
  });

  it("uses completed durable runbook state instead of a stale persisted pending queue", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the CRM dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              metadata: { runbookMessageKey: "runbook-queue:run-1" },
              parts: [
                {
                  type: "data-runbook-queue",
                  id: "runbook-queue:run-1",
                  data: {
                    runbookRunId: "run-1",
                    displayName: "CRM Dashboard",
                    status: "QUEUED",
                    phases: [
                      {
                        id: "produce",
                        title: "Produce",
                        tasks: [
                          {
                            id: "task-1",
                            title: "Build dashboard",
                            status: "PENDING",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
        runbookQueues={[
          {
            runbookRunId: "run-1",
            displayName: "CRM Dashboard",
            status: "COMPLETED",
            phases: [
              {
                id: "produce",
                title: "Produce",
                tasks: [
                  {
                    id: "task-1",
                    title: "Build dashboard",
                    status: "COMPLETED",
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    const promptQueue = screen.getByLabelText("Active task queue");
    expect(within(promptQueue).getByText("1 task · 1 completed")).toBeTruthy();
    expect(
      within(promptQueue).getAllByText(/completed/i).length,
    ).toBeGreaterThan(0);
    expect(within(promptQueue).queryByText("1 task · 1 pending")).toBeNull();
  });

  it("uses completed durable runbook state instead of a stale streamed pending queue", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the CRM dashboard",
            },
          ],
        }}
        runbookQueues={[
          {
            runbookRunId: "run-1",
            displayName: "CRM Dashboard",
            status: "COMPLETED",
            phases: [
              {
                id: "produce",
                title: "Produce",
                tasks: [
                  {
                    id: "task-1",
                    title: "Build dashboard",
                    status: "COMPLETED",
                  },
                ],
              },
            ],
          },
        ]}
        streamState={{
          status: "streaming",
          legacyText: "",
          parts: [
            {
              type: "data-runbook-queue",
              id: "runbook-queue:run-1",
              data: {
                runbookRunId: "run-1",
                displayName: "CRM Dashboard",
                status: "QUEUED",
                phases: [
                  {
                    id: "produce",
                    title: "Produce",
                    tasks: [
                      {
                        id: "task-1",
                        title: "Build dashboard",
                        status: "PENDING",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }}
      />,
    );

    const promptQueue = screen.getByLabelText("Active task queue");
    expect(within(promptQueue).getByText("1 task · 1 completed")).toBeTruthy();
    expect(within(promptQueue).queryByText("1 task · 1 pending")).toBeNull();
  });

  it("updates the prompt-area queue from fresher streaming runbook data", () => {
    const thread = {
      id: "thread-1",
      title: "Runbook thread",
      messages: [
        {
          id: "message-1",
          role: "USER",
          content: "Run the map artifact runbook",
        },
        {
          id: "message-2",
          role: "ASSISTANT",
          parts: [
            {
              type: "data-runbook-queue" as const,
              id: "runbook-queue:run-1",
              data: {
                runbookRunId: "run-1",
                displayName: "Map Artifact",
                status: "QUEUED",
                phases: [
                  {
                    id: "produce",
                    title: "Produce",
                    tasks: [
                      {
                        id: "task-1",
                        title: "Render map",
                        status: "PENDING",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { rerender } = render(
      <TaskThreadView
        thread={thread}
        streamState={{
          status: "streaming",
          legacyText: "",
          parts: [
            {
              type: "data-runbook-queue",
              id: "runbook-queue:run-1",
              data: {
                runbookRunId: "run-1",
                displayName: "Map Artifact",
                status: "RUNNING",
                phases: [
                  {
                    id: "produce",
                    title: "Produce",
                    tasks: [
                      {
                        id: "task-1",
                        title: "Render map",
                        status: "RUNNING",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }}
      />,
    );

    let promptQueue = screen.getByLabelText("Active task queue");
    expect(within(promptQueue).getAllByText(/running/i).length).toBeGreaterThan(
      0,
    );

    rerender(
      <TaskThreadView
        thread={thread}
        streamState={{
          status: "streaming",
          legacyText: "",
          parts: [
            {
              type: "data-runbook-queue",
              id: "runbook-queue:run-1",
              data: {
                runbookRunId: "run-1",
                displayName: "Map Artifact",
                status: "COMPLETED",
                phases: [
                  {
                    id: "produce",
                    title: "Produce",
                    tasks: [
                      {
                        id: "task-1",
                        title: "Render map",
                        status: "COMPLETED",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }}
      />,
    );

    promptQueue = screen.getByLabelText("Active task queue");
    expect(within(promptQueue).getByText("1 task · 1 completed")).toBeTruthy();
    expect(
      within(promptQueue).getAllByText(/completed/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders a completed turn response when the assistant message has not refetched yet", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed turn",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "What is my name?",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              finishedAt: "2026-05-08T20:00:00Z",
              resultJson: {
                response: "Your name is Eric.",
              },
            },
          ],
        }}
        streamingChunks={[
          { seq: 1, text: "Your" },
          { seq: 2, text: " name" },
        ]}
      />,
    );

    expect(screen.getByText("Your name is Eric.")).toBeTruthy();
    expect(screen.queryByLabelText("ThinkWork is typing")).toBeNull();
  });

  it("renders persisted goal-run completion evidence from a completed turn", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-goal-complete",
          title: "Goal complete",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "/goal Finish the release notes",
            },
          ],
          turns: [
            {
              id: "turn-goal-complete",
              status: "succeeded",
              invocationSource: "chat_message",
              finishedAt: "2026-06-21T20:00:00Z",
              resultJson: {
                response: "Release notes are ready.",
                goal_run: {
                  source: "pi_goal",
                  status: "complete",
                  objective: "Finish the release notes",
                  completion_summary: "Drafted and verified release notes.",
                  token_budget: 125000,
                  tokens_used: 42000,
                  verification_notes: ["Docs test passed."],
                },
              },
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    expect(screen.getByText("Goal")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(
      screen.getAllByText("Finish the release notes").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Drafted and verified release notes."),
    ).toBeTruthy();
    expect(screen.getByText("Tokens: 42.0K / 125.0K")).toBeTruthy();
    expect(screen.getByText("Docs test passed.")).toBeTruthy();
  });

  it("resumes a budget-limited goal run through goal-mode follow-up metadata", () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-goal-budget",
          title: "Goal budget",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "/goal Finish the launch plan",
            },
          ],
          turns: [
            {
              id: "turn-goal-budget",
              status: "succeeded",
              invocationSource: "chat_message",
              finishedAt: "2026-06-21T20:00:00Z",
              resultJson: {
                response: "Paused at budget.",
                goal_run: {
                  source: "pi_goal",
                  status: "budget_limited",
                  goal_id: "goal-run-1",
                  objective: "Finish the launch plan",
                  token_budget: 125000,
                  tokens_used: 125001,
                  budget_limited_reason: "Tenant goal budget reached.",
                  resume_eligible: true,
                },
              },
            },
          ],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    openThinkingDisclosure();
    screen.getByText("Budget limited");
    screen.getByText("Budget: Tenant goal budget reached.");
    screen.getByRole("button", { name: "Resume" }).click();

    expect(onSendFollowUp).toHaveBeenCalledWith(
      "Resume goal: Finish the launch plan",
      [],
      [],
      true,
      undefined,
      undefined,
      {
        enabled: true,
        action: "resume",
        objective: "Finish the launch plan",
        goalRunId: "goal-run-1",
      },
    );
  });

  it("renders a completed Computer task response when the assistant message has not refetched yet", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed task",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "What is my name?",
            },
          ],
          turns: [
            {
              id: "task-1",
              status: "COMPLETED",
              invocationSource: "chat_message",
              finishedAt: "2026-05-08T20:00:00Z",
              resultJson: {
                response: "Your name is Eric.",
                responseMessageId: "message-2",
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Your name is Eric.")).toBeTruthy();
  });

  it("renders thread turn thinking and tool details", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Tool trace thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Find account risk",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              usageJson: {
                tools_called: ["crm_search"],
                input_tokens: 1200,
                output_tokens: 300,
                diagnostics: {
                  workspace_diagnostics: {
                    workspace_sync_ms: 12,
                    hydration_copy_ms: 12,
                    sdk_session_ms: 25,
                    model_tool_run_ms: 1400,
                    reconcile_writeback_ms: 18,
                    file_count: 8,
                    hydrated_files: 3,
                    skipped_files: 5,
                    changed_files: 2,
                    persisted_files: 1,
                    rejected_files: 1,
                    cache_hit: false,
                    prefix:
                      "tenants/acme/threads/thread-1/agent-slug/rendered/",
                    reconcile_status: "partial_success",
                  },
                  agentcore_phases: [
                    {
                      phase: "runtime.workspace_bootstrap",
                      status: "completed",
                      duration_ms: 12,
                      count: 8,
                      detail: "synced=3;skipped=5;deleted=0",
                    },
                    {
                      phase: "runtime.agent_loop",
                      status: "completed",
                      duration_ms: 1400,
                    },
                  ],
                },
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByLabelText("Turn activity")).toBeTruthy();
    openThinkingDisclosure();
    expect(screen.getByText("Workspace sync")).toBeTruthy();
    expect(screen.getByText(/workspace sync: 12ms/)).toBeTruthy();
    expect(screen.getByText(/model tool run: 1.4s/)).toBeTruthy();
    expect(screen.getByText(/skipped files: 5/)).toBeTruthy();
    expect(screen.getByText(/changed files: 2/)).toBeTruthy();
    expect(screen.getByText(/prefix: tenants\/acme/)).toBeTruthy();
    expect(screen.getByText(/reconcile status: partial_success/)).toBeTruthy();
    expect(screen.getByText("AgentCore phases")).toBeTruthy();
    expect(
      screen.getByText(/workspace bootstrap: completed · 12ms · count 8/),
    ).toBeTruthy();
    expect(screen.getByText(/agent loop: completed · 1.4s/)).toBeTruthy();
    expect(screen.getByText("Finding sources")).toBeTruthy();
    expect(screen.getByText(/Manual chat/)).toBeTruthy();
    expect(screen.getByText(/1.2K in \/ 300 out/)).toBeTruthy();
  });

  it("renders durable Computer event detail rows for a thread turn", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Browser trace thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Use the browser",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              events: [
                {
                  id: "event-1",
                  eventType: "browser_automation_started",
                  level: "INFO",
                  payload: {
                    url: "https://example.com",
                    task: "Read the page title",
                    taskId: "task-1",
                  },
                  createdAt: "2026-05-09T08:01:00Z",
                },
                {
                  id: "event-2",
                  eventType: "browser_automation_completed",
                  level: "INFO",
                  payload: { responseLen: 12 },
                  createdAt: "2026-05-09T08:01:05Z",
                },
              ],
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    expect(screen.getByText("Opening browser")).toBeTruthy();
    expect(screen.getByText("Browser completed")).toBeTruthy();
    expect(screen.getByText(/https:\/\/example.com/)).toBeTruthy();
    expect(
      screen.getByText(/"instruction": "Read the page title"/),
    ).toBeTruthy();
    expect(screen.getByText(/"runId": "task-1"/)).toBeTruthy();
    expect(screen.queryByText(/"task":/)).toBeNull();
    expect(screen.queryByText(/"taskId":/)).toBeNull();
  });

  it("renders turn events in chronological order regardless of input order", () => {
    // The computerEvents resolver returns events DESC; this fixture mirrors
    // that wire shape. Rendering must invert it so the user sees the timeline
    // oldest-at-top → newest-at-bottom.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Order check",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run it",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              events: [
                {
                  id: "event-late",
                  eventType: "browser_automation_completed",
                  payload: {},
                  createdAt: "2026-05-09T11:58:07Z",
                },
                {
                  id: "event-mid",
                  eventType: "browser_automation_started",
                  payload: { url: "https://example.com" },
                  createdAt: "2026-05-09T11:58:00.530Z",
                },
                {
                  id: "event-early",
                  eventType: "thread_turn_enqueued",
                  payload: {},
                  createdAt: "2026-05-09T11:58:00.500Z",
                },
              ],
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    const rendered = [
      screen.getByText("thread turn enqueued"),
      screen.getByText("Opening browser"),
      screen.getByText("Browser completed"),
    ];
    // Each row's title is unique; compare DOM order via compareDocumentPosition
    expect(
      rendered[0].compareDocumentPosition(rendered[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      rendered[1].compareDocumentPosition(rendered[2]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stably orders events with identical createdAt by event id", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Tiebreak check",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Tiebreak",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              events: [
                // Resolver-DESC order with identical timestamps; expected
                // render order is by id ascending: event-a, event-b.
                {
                  id: "event-b",
                  eventType: "browser_automation_completed",
                  payload: {},
                  createdAt: "2026-05-09T11:58:00.530Z",
                },
                {
                  id: "event-a",
                  eventType: "browser_automation_started",
                  payload: { url: "https://example.com" },
                  createdAt: "2026-05-09T11:58:00.530Z",
                },
              ],
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    const opening = screen.getByText("Opening browser");
    const completed = screen.getByText("Browser completed");
    expect(
      opening.compareDocumentPosition(completed) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the running turn surface while waiting for the first chunk", () => {
    // KTD2: a running turn is the single in-flight signal — the "Working…"
    // shimmer header, not a separate "Processing…" element.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Waiting thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Answer me",
            },
          ],
          turns: [
            {
              id: "task-1",
              status: "RUNNING",
              invocationSource: "chat_message",
              startedAt: "2020-01-01T00:00:00Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Working…")).toBeTruthy();
    expect(screen.queryByLabelText("Processing request")).toBeNull();
    expect(screen.queryByLabelText("ThinkWork is typing")).toBeNull();
  });

  it("prefers streaming chunks over the processing shimmer", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Streaming thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Answer me",
            },
          ],
          turns: [
            {
              id: "task-1",
              status: "RUNNING",
              invocationSource: "chat_message",
            },
          ],
        }}
        streamingChunks={[{ seq: 1, text: "Streaming now" }]}
      />,
    );

    expect(screen.getByText("Streaming now")).toBeTruthy();
    expect(screen.queryByLabelText("Processing request")).toBeNull();
  });

  it("renders Markdown bold and pipe tables in assistant content", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Markdown render",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "List leads",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content:
                "Here are your **leads**:\n\n| # | Title | Stage |\n|---|---|---|\n| 1 | Royal Concrete | Working |\n| 2 | Diesel Fleet Care | Working |",
            },
          ],
        }}
      />,
    );

    // Bold text is rendered (Streamdown wraps it; the visible text is what matters).
    expect(screen.getByText("leads")).toBeTruthy();
    // Table rendered as a real <table>
    expect(document.querySelector("table")).not.toBeNull();
    // Cells render the row content
    expect(screen.getByText("Royal Concrete")).toBeTruthy();
    expect(screen.getByText("Diesel Fleet Care")).toBeTruthy();
  });

  it("renders Markdown links as anchor elements with safe URLs", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Link render",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Visit",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "Visit [example](https://example.com).",
            },
          ],
        }}
      />,
    );

    // The link text renders. Streamdown renders links through a link-safety
    // component (button-shaped at v2) rather than a bare <a>, so we assert
    // visible text rather than the element type — the latter is a private
    // implementation detail of Streamdown.
    expect(screen.getByText("example")).toBeTruthy();
  });

  it("renders streaming chunks through the Markdown parser", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Streaming markdown",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Stream me",
            },
          ],
        }}
        streamingChunks={[
          { seq: 1, text: "**Working**" },
          { seq: 2, text: " on it" },
        ]}
      />,
    );

    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByLabelText("ThinkWork is typing")).toBeTruthy();
  });

  it("renders streaming partial Markdown without crashing", () => {
    // Mid-table token sequence — the row terminator hasn't arrived yet.
    expect(() =>
      render(
        <TaskThreadView
          thread={{
            id: "thread-1",
            title: "Partial markdown",
            lifecycleStatus: "RUNNING",
            messages: [
              {
                id: "message-1",
                role: "USER",
                content: "Stream a partial table",
              },
            ],
          }}
          streamingChunks={[
            { seq: 1, text: "| col1 | col2 |\n|---|---|\n| a | " },
          ]}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByLabelText("ThinkWork is typing")).toBeTruthy();
  });

  it("renders empty content placeholder when assistant message body is blank", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Blank assistant",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Hello",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "   ",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("(No message content)")).toBeTruthy();
  });

  it("renders assistant Markdown wrapper with Codex-transcript prose density", () => {
    // Regression guard: matches the tightened token set targeted by the
    // "make Computer match the Codex CLI transcript density" iteration —
    // text-sm + leading-5 + my-1.5 paragraph/list margins, prose-sm modifier
    // shrinks the inline element rhythm. Reverting any one token sends the
    // page back toward the looser pre-merge rhythm.
    const { container } = render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Density check",
          lifecycleStatus: "COMPLETED",
          messages: [
            { id: "m1", role: "USER", content: "List options" },
            {
              id: "m2",
              role: "ASSISTANT",
              content: "## Options\n\n- Alpha\n- Beta\n- Gamma",
            },
          ],
        }}
      />,
    );
    const proseWrapper = container.querySelector("div.prose");
    expect(proseWrapper).not.toBeNull();
    const cls = proseWrapper!.className;
    for (const token of [
      "prose-sm",
      "text-sm",
      "leading-5",
      "prose-p:leading-5",
      "prose-li:leading-5",
      "prose-p:my-1.5",
      "prose-ul:my-1.5",
      "prose-ol:my-1.5",
      "prose-li:my-0",
      "prose-headings:mt-3",
      "prose-headings:mb-1.5",
    ]) {
      expect(cls).toContain(token);
    }
    // Loose tokens from earlier iterations must not survive.
    expect(cls).not.toContain("leading-8");
    expect(cls).not.toContain("text-[1.05rem]");
    expect(cls).not.toContain("prose-p:my-0");
    expect(cls).not.toContain("prose-p:my-2");
  });

  it("renders the transcript segment grid with tightened gap-3 spacing", () => {
    // U1 regression guard: gap-8 (and the interim gap-5) waste vertical
    // space between transcript segments — Thinking should sit close to the
    // assistant answer it precedes, like one continuous thought.
    const { container } = render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Gap check",
          lifecycleStatus: "RUNNING",
          messages: [
            { id: "m1", role: "USER", content: "Hi" },
            { id: "m2", role: "ASSISTANT", content: "Hello." },
          ],
        }}
      />,
    );
    const grid = container.querySelector("div.gap-3");
    expect(grid).not.toBeNull();
    expect(container.querySelector("div.gap-8")).toBeNull();
    expect(container.querySelector("div.gap-5")).toBeNull();
  });

  it("renders Thinking row collapsed when a turn completes cleanly", () => {
    // U2 collapse-on-finish: defaultOpen is false for terminal-clean states so
    // child action rows nest inside the closed disclosure by default.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed quietly",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Pull leads" }],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              finishedAt: "2026-05-09T08:01:05Z",
              events: [
                {
                  id: "e1",
                  eventType: "browser_automation_started",
                  payload: { url: "https://example.com" },
                  createdAt: "2026-05-09T08:01:00Z",
                },
              ],
            },
          ],
        }}
      />,
    );
    const disclosure = getThinkingDisclosure();
    expect(disclosure.getAttribute("data-state")).toBe("closed");
  });

  it("labels a completed turn 'Worked for Xm Ys' from its wall-clock duration", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Done",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Pull leads" }],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T08:00:00Z",
              finishedAt: "2026-05-09T08:01:30Z",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Worked for 1m 30s")).toBeTruthy();
    expect(screen.queryByText("Thinking")).toBeNull();
  });

  it("labels completed chat turns from user-visible elapsed time", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Done",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "m1",
              role: "USER",
              content: "Follow up",
              createdAt: "2026-06-02T19:30:00Z",
            },
            {
              id: "m2",
              role: "ASSISTANT",
              content: "Done",
              createdAt: "2026-06-02T19:30:30Z",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-06-02T19:30:15Z",
              finishedAt: "2026-06-02T19:30:26Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Worked for 30s")).toBeTruthy();
    expect(screen.queryByText("Worked for 11s")).toBeNull();
  });

  it("counts running chat turns from the user message time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T19:30:20Z"));
    try {
      render(
        <TaskThreadView
          thread={{
            id: "thread-1",
            title: "Running",
            lifecycleStatus: "RUNNING",
            messages: [
              {
                id: "m1",
                role: "USER",
                content: "Follow up",
                createdAt: "2026-06-02T19:30:00Z",
              },
            ],
            turns: [
              {
                id: "turn-1",
                status: "running",
                invocationSource: "chat_message",
                startedAt: "2026-06-02T19:30:15Z",
              },
            ],
          }}
        />,
      );

      expect(screen.getByText("Working…")).toBeTruthy();
      expect(screen.getByText("20s")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show a console-log toggle for a cloud turn with no console data", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Cloud turn",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Search" }],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T08:00:00Z",
              finishedAt: "2026-05-09T08:00:05Z",
              usageJson: { tools_called: ["crm_search"] },
            },
          ],
        }}
      />,
    );
    openThinkingDisclosure();
    expect(screen.getByText("Finding sources")).toBeTruthy();
    expect(screen.queryByText("view console log")).toBeNull();
  });

  it("renders the projected workspace panel for a turn with a projection snapshot", () => {
    // Plan 2026-06-12-002 U9: the per-turn workspace projection renders a
    // read-only disclosure inside the turn activity section.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Projected turn",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Do the thing" }],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-06-12T08:00:00Z",
              finishedAt: "2026-06-12T08:00:05Z",
              usageJson: {
                tools_called: ["crm_search"],
                diagnostics: {
                  workspace_diagnostics: {
                    workspace_sync_ms: 12,
                  },
                },
              },
              contextSnapshot: {
                workspace_projection: {
                  renderedPrefix: "tenants/acme/threads/thread-1/",
                  sources: [
                    { owner: "agent", prefix: "tenants/acme/agents/main/" },
                  ],
                  agentsMdKey: "tenants/acme/threads/thread-1/AGENTS.md",
                  injectedFiles: ["AGENTS.md"],
                  generatedAt: "2026-06-12T08:00:00Z",
                  fetches: [
                    {
                      target: { kind: "space", slug: "ops" },
                      outcome: "denied",
                      fileCount: 0,
                      totalBytes: 0,
                      deniedReason: "not_authorized",
                      at: "2026-06-12T08:00:02Z",
                    },
                  ],
                  reconcile: {
                    rejectedCount: 1,
                    rejections: [
                      { path: "AGENTS.md", code: "read_only_generated_file" },
                    ],
                    updatedAt: "2026-06-12T08:00:05Z",
                  },
                },
              },
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    expect(screen.getByTestId("projected-workspace-panel")).toBeTruthy();
    expect(screen.getByText("Projected workspace")).toBeTruthy();
    expect(screen.getByText("tenants/acme/agents/main/")).toBeTruthy();
    expect(screen.getByText("not_authorized")).toBeTruthy();
    expect(screen.getByText("read_only_generated_file")).toBeTruthy();
    expect(
      screen
        .getByText("Projected workspace")
        .compareDocumentPosition(screen.getByText("Workspace sync")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByText("Projected workspace")
        .compareDocumentPosition(screen.getByText("Finding sources")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no projected workspace panel for pre-feature turns", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Legacy turn",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Old work" }],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T08:00:00Z",
              finishedAt: "2026-05-09T08:00:05Z",
              contextSnapshot: { model: "claude-x" },
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    expect(screen.queryByTestId("projected-workspace-panel")).toBeNull();
  });

  it("keeps a failed turn collapsed by default while preserving manual error details", () => {
    // THNK-25: failed turns load collapsed so the detail rows do not mount
    // open and then collapse, but the explicit failure header and manual
    // disclosure still make the error discoverable.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Failed turn",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Reach the page" }],
          turns: [
            {
              id: "turn-1",
              status: "failed",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T08:01:00Z",
              finishedAt: "2026-05-09T08:01:05Z",
              error: "Browser session timed out",
            },
          ],
        }}
      />,
    );
    const disclosure = getThinkingDisclosure();
    expect(disclosure.getAttribute("data-state")).toBe("closed");
    expect(
      screen.getByRole("button", { name: "Failed after 5s" }),
    ).toBeTruthy();
    expect(screen.getByText(/^Failed after/)).toBeTruthy();
    expect(screen.queryByText("Run failed")).toBeNull();
    expect(screen.queryByText("Browser session timed out")).toBeNull();

    openThinkingDisclosure();
    expect(screen.getByText("Run failed")).toBeTruthy();
    expect(screen.getByText("Browser session timed out")).toBeTruthy();
  });

  it("keeps a failed turn closed after the prior auto-close delay", () => {
    vi.useFakeTimers();
    try {
      render(
        <TaskThreadView
          thread={{
            id: "thread-1",
            title: "Failed turn",
            lifecycleStatus: "COMPLETED",
            messages: [{ id: "m1", role: "USER", content: "Reach the page" }],
            turns: [
              {
                id: "turn-1",
                status: "failed",
                invocationSource: "chat_message",
                startedAt: "2026-05-09T08:01:00Z",
                finishedAt: "2026-05-09T08:01:05Z",
                error: "Browser session timed out",
              },
            ],
          }}
        />,
      );
      const disclosure = getThinkingDisclosure();
      expect(disclosure.getAttribute("data-state")).toBe("closed");

      vi.advanceTimersByTime(1500);

      expect(disclosure.getAttribute("data-state")).toBe("closed");
      expect(screen.queryByText("Run failed")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps incomplete failed turns collapsed and failure-labeled", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Failed turn",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Reach the page" }],
          turns: [
            {
              id: "turn-1",
              status: "failed",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );
    const disclosure = getThinkingDisclosure();
    expect(disclosure.getAttribute("data-state")).toBe("closed");
    expect(screen.getByRole("button", { name: /^Failed/ })).toBeTruthy();
    expect(screen.queryByText(/^Worked/)).toBeNull();

    openThinkingDisclosure();
    expect(screen.getByText("Run failed")).toBeTruthy();
    expect(screen.getByText("No error detail was provided.")).toBeTruthy();
  });

  it("defaults the turn surface closed for every rendered status to prevent content shift", () => {
    // The user explicitly does not want streaming action rows pushing the
    // page taller as a turn runs or after a failed turn loads. Closing the
    // surface by default keeps the viewport stable.
    for (const status of [
      "running",
      "pending",
      "queued",
      "claimed",
      "completed",
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
    ] as const) {
      const { unmount } = render(
        <TaskThreadView
          thread={{
            id: `thread-${status}`,
            title: `${status} turn`,
            lifecycleStatus: "RUNNING",
            messages: [{ id: "m1", role: "USER", content: "Start" }],
            turns: [
              {
                id: "turn-1",
                status,
                invocationSource: "chat_message",
              },
            ],
          }}
        />,
      );
      const disclosure = getThinkingDisclosure();
      expect(disclosure.getAttribute("data-state")).toBe("closed");
      unmount();
    }
  });

  it("preserves user-toggled Thinking state across passive re-renders within the same status", () => {
    // No more key-based remount on status flip — the user's manual expand
    // sticks even when the parent re-renders for unrelated reasons (chunk
    // arrival, polling, etc).
    const baseThread = {
      id: "thread-1",
      title: "Toggle persistence",
      lifecycleStatus: "RUNNING",
      messages: [{ id: "m1", role: "USER", content: "Run" }],
      turns: [
        {
          id: "turn-1",
          status: "running",
          invocationSource: "chat_message",
        },
      ],
    };

    const { rerender } = render(<TaskThreadView thread={baseThread} />);
    const disclosure = getThinkingDisclosure();
    expect(disclosure.getAttribute("data-state")).toBe("closed");

    fireEvent.click(within(disclosure).getByRole("button"));

    rerender(<TaskThreadView thread={{ ...baseThread }} />);
    const reRendered = getThinkingDisclosure();
    expect(reRendered.getAttribute("data-state")).toBe("open");
  });

  it("does not synthesize a fallback response when a new turn is in flight after a previous completed turn", () => {
    // Regression: withTurnResponseFallback used to append the latest *completed*
    // turn's response after the latest user message, even when the latest user
    // message was a brand-new question whose own turn was still running. The
    // result was the previous answer rendered as a phantom duplicate below the
    // new question's running Thinking row.
    const previousResponse =
      "Two great options at the same location — Springdale General.";
    render(
      <TaskThreadView
        thread={{
          id: "thread-flight",
          title: "Mid-flight follow-up",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "u1",
              role: "USER",
              content: "Find the farmer's market",
              createdAt: "2026-05-09T10:00:00Z",
            },
            {
              id: "a1",
              role: "ASSISTANT",
              content: previousResponse,
              createdAt: "2026-05-09T10:00:30Z",
            },
            {
              id: "u2",
              role: "USER",
              content: "What is its address?",
              createdAt: "2026-05-09T10:01:00Z",
            },
          ],
          turns: [
            // Newest first (resolver emits DESC). The new turn for u2 is still
            // running; the previous turn for u1 is completed but its response
            // is already represented by message a1.
            {
              id: "turn-2",
              status: "running",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T10:01:01Z",
            },
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T10:00:00Z",
              finishedAt: "2026-05-09T10:00:30Z",
              resultJson: { response: previousResponse },
            },
          ],
        }}
      />,
    );

    // The previous response should appear exactly once (as the persisted
    // assistant message a1), not twice (no synthesized duplicate below u2).
    expect(
      screen.getAllByText(previousResponse, { exact: false }),
    ).toHaveLength(1);
  });

  it("keeps a prior turn's synthetic response visible when a follow-up turn is in flight", () => {
    // Regression: when the prior turn's response only lives in resultJson (the
    // assistant message has NOT been persisted yet) and the user sends a
    // follow-up, the old tail-append fallback dropped that response the instant
    // a newer user message appeared — the transcript flashed the prior answer
    // out and showed only "Working…". The per-turn reconstruction must keep the
    // prior response anchored to u1 while u2's turn runs.
    const priorResponse = "The farmer's market is on Springdale Road.";
    render(
      <TaskThreadView
        thread={{
          id: "thread-followup-flash",
          title: "Follow-up flash",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "u1",
              role: "USER",
              content: "Where is the farmer's market?",
              createdAt: "2026-05-31T10:00:00Z",
            },
            // No durable assistant for u1 yet — only the turn resultJson has it.
            {
              id: "u2",
              role: "USER",
              content: "What time does it open?",
              createdAt: "2026-05-31T10:01:00Z",
            },
          ],
          turns: [
            // Newest first (resolver emits DESC). u2's turn is still running.
            {
              id: "turn-2",
              status: "running",
              invocationSource: "chat_message",
              startedAt: "2026-05-31T10:01:01Z",
            },
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-31T10:00:00Z",
              finishedAt: "2026-05-31T10:00:30Z",
              resultJson: { response: priorResponse },
            },
          ],
        }}
      />,
    );

    // Prior response stays visible (synthesized once, anchored to u1)...
    expect(screen.getAllByText(priorResponse, { exact: false })).toHaveLength(
      1,
    );
    // ...and the in-flight follow-up turn still surfaces its Working row.
    expect(screen.getByText("Working…")).toBeTruthy();
  });

  it("anchors the optimistic follow-up turn to the latest user message", () => {
    const previousResponse = "The first answer is done.";
    const { container } = render(
      <TaskThreadView
        thread={{
          id: "thread-optimistic-followup",
          title: "Optimistic follow-up",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "u1",
              role: "USER",
              content: "First question",
              createdAt: "2026-06-02T19:30:00Z",
            },
            {
              id: "a1",
              role: "ASSISTANT",
              content: previousResponse,
              createdAt: "2026-06-02T19:30:30Z",
            },
            {
              id: "u2",
              role: "USER",
              content: "Follow-up question",
              createdAt: "2026-06-02T19:31:05Z",
            },
          ],
          turns: [
            {
              id: "optimistic-computer-turn",
              status: "running",
              invocationSource: "chat_message",
              startedAt: "2026-06-02T19:31:04Z",
            },
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-06-02T19:30:00Z",
              finishedAt: "2026-06-02T19:30:30Z",
            },
          ],
        }}
      />,
    );

    const text = container.textContent ?? "";
    const previousAnswerIndex = text.indexOf(previousResponse);
    const followUpIndex = text.indexOf("Follow-up question");
    const workingIndex = text.indexOf("Working…");
    expect(previousAnswerIndex).toBeGreaterThan(-1);
    expect(followUpIndex).toBeGreaterThan(previousAnswerIndex);
    expect(workingIndex).toBeGreaterThan(followUpIndex);
  });

  it("renders live tool_invocation_started events with toolActionTitle formatting", () => {
    // U4 regression guard: the Strands runtime emits tool_invocation_started
    // events as tools begin (instead of waiting for end-of-turn). The UI
    // must format them with the same toolActionTitle helper used for
    // post-turn usage.tool_invocations so the live row's title matches what
    // the row will look like once the turn finishes.
    render(
      <TaskThreadView
        thread={{
          id: "thread-live",
          title: "Live tools",
          lifecycleStatus: "RUNNING",
          messages: [{ id: "u1", role: "USER", content: "Find sources" }],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              events: [
                {
                  id: "e1",
                  eventType: "tool_invocation_started",
                  payload: {
                    tool_name: "web_search",
                    tool_use_id: "tool-1",
                    input_preview: "best brunch east austin",
                  },
                  createdAt: "2026-05-09T11:30:00Z",
                },
                {
                  id: "e2",
                  eventType: "tool_invocation_started",
                  payload: { tool_name: "recall", tool_use_id: "tool-2" },
                  createdAt: "2026-05-09T11:30:01Z",
                },
              ],
            },
          ],
        }}
      />,
    );
    // toolActionTitle maps "web_search" → "Finding sources" and "recall" →
    // "Checking memory" — verifying the live event uses that formatter.
    openThinkingDisclosure();
    expect(screen.getByText("Finding sources")).toBeTruthy();
    expect(screen.getByText("Checking memory")).toBeTruthy();
  });

  it("renders profile-tagged live tool events as agent profile lane activity", () => {
    const message = {
      id: "u1",
      role: "USER" as const,
      content: "Find sources #Research",
      mentions: [
        {
          targetType: "AGENT_PROFILE" as const,
          targetId: "research",
          displayName: "Research",
        },
      ],
    };
    const turn = {
      id: "turn-1",
      status: "running",
      invocationSource: "chat_message",
      events: [
        {
          id: "e1",
          eventType: "agent_profile_run_started",
          payload: {
            profile_slug: "research",
            profile_name: "Research",
            model: "anthropic.claude-3-5-haiku-20241022-v1:0",
            status: "running",
          },
          createdAt: "2026-05-09T11:30:00Z",
        },
        {
          id: "e2",
          eventType: "tool_invocation_started",
          payload: {
            profile_slug: "research",
            profile_name: "Research",
            tool_name: "web_search",
            tool_use_id: "tool-1",
          },
          createdAt: "2026-05-09T11:30:01Z",
        },
      ],
    };
    const rows = actionRowsForTurn(turn, {}, message);

    expect(rows[0]?.title).toBe("Agent Profile: Research");
    expect(rows[0]?.detail).toContain("Model: claude-3-5-haiku-20241022");
    expect(rows[0]?.children?.[0]?.title).toBe("Research: Finding sources");

    render(
      <TaskThreadView
        thread={{
          id: "thread-live-profile",
          title: "Live profile tools",
          lifecycleStatus: "RUNNING",
          messages: [message],
          turns: [turn],
        }}
      />,
    );

    openThinkingDisclosure();
    const agentProfileSummary = screen
      .getByText("Agent Profile: Research")
      .closest("summary");
    expect(agentProfileSummary?.querySelectorAll("svg")).toHaveLength(2);
    expect(screen.getByText("Research: Finding sources")).toBeTruthy();
    expect(
      screen
        .getByText("Research: Finding sources")
        .closest("summary")
        ?.querySelectorAll("svg"),
    ).toHaveLength(2);
  });

  it("dedupes live tool_invocation_started events against post-turn usage.tool_invocations", () => {
    // U4 regression guard: when a turn finishes, the same tool appears in
    // both `usage.tool_invocations` (post-turn reconstruction) and the
    // streaming events list. Without dedup, the row renders twice.
    render(
      <TaskThreadView
        thread={{
          id: "thread-dedup",
          title: "Dedup",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "u1", role: "USER", content: "Find sources" }],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              usageJson: {
                tool_invocations: [
                  {
                    tool_name: "web_search",
                    input_preview: "best brunch east austin",
                    output_preview: "...",
                    status: "success",
                  },
                ],
              },
              events: [
                {
                  id: "e1",
                  eventType: "tool_invocation_started",
                  payload: {
                    tool_name: "web_search",
                    tool_use_id: "tool-1",
                  },
                  createdAt: "2026-05-09T11:30:00Z",
                },
              ],
            },
          ],
        }}
      />,
    );
    // Exactly one "Finding sources" row, not two.
    openThinkingDisclosure();
    expect(screen.getAllByText("Finding sources")).toHaveLength(1);
  });

  it("surfaces an agent profile row while a mentioned profile turn is running", () => {
    const rows = actionRowsForTurn(
      {
        id: "turn-agent-profile-running",
        status: "running",
        invocationSource: "chat_message",
      },
      {},
      {
        id: "u1",
        role: "USER",
        content: "Find current CEO of Stripe #Research",
        mentions: [
          {
            targetType: "AGENT_PROFILE",
            targetId: "research",
            displayName: "Research",
            rawText: "#Research",
          },
        ],
      },
    );

    expect(rows[0]).toMatchObject({
      title: "Agent Profile: Research",
      detail: "Delegated via #Research. Waiting for profile lane activity.",
      kind: "thinking",
    });

    render(
      <TaskThreadView
        thread={{
          id: "thread-agent-profile-running",
          title: "Running profile",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "u1",
              role: "USER",
              content: "Find current CEO of Stripe #Research",
              mentions: [
                {
                  targetType: "AGENT_PROFILE",
                  targetId: "research",
                  displayName: "Research",
                  rawText: "#Research",
                },
              ],
            },
          ],
          turns: [
            {
              id: "turn-agent-profile-running",
              status: "running",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    const agentProfileSummary = screen
      .getByText("Agent Profile: Research")
      .closest("summary");
    expect(agentProfileSummary?.querySelectorAll("svg")).toHaveLength(2);
  });

  it("renders finalized agent profile run model, token, cost, and status details", () => {
    const rows = actionRowsForTurn(
      {
        id: "turn-agent-profile-finished",
        status: "succeeded",
        invocationSource: "chat_message",
      },
      {
        tool_invocations: [
          {
            tool_name: "delegate_to_agent_profile",
            agent_profile_run: {
              profileSlug: "research",
              profileName: "Research",
              model: "anthropic.claude-3-5-haiku-20241022-v1:0",
              inputTokens: 1200,
              outputTokens: 321,
              cachedReadTokens: 400,
              costUsd: 0.0023,
              durationMs: 12_000,
              status: "completed",
            },
          },
        ],
      },
    );

    expect(rows[0]?.title).toBe("Using delegate to agent profile");
    expect(rows[1]?.title).toBe("Agent Profile: Research");
    expect(rows[1]?.detail).toContain("Profile: #research");
    expect(rows[1]?.detail).toContain("Model: claude-3-5-haiku-20241022");
    expect(rows[1]?.detail).toContain("Tokens: 1.2K in / 321 out (400 cached)");
    expect(rows[1]?.detail).toContain("Cost: $0.0023");
    expect(rows[1]?.detail).toContain("Duration: 12s");
    expect(rows[1]?.detail).toContain("Status: completed");
  });

  it("keeps sequential Research and Reviewer profile rows paired with their delegate tools", () => {
    const rows = actionRowsForTurn(
      {
        id: "turn-agent-profile-chain",
        status: "succeeded",
        invocationSource: "chat_message",
      },
      {
        tool_invocations: [
          {
            id: "delegate-research",
            tool_name: "delegate_to_agent_profile",
            args: { profileSlug: "research" },
            agent_profile_run: {
              profileRunId: "profile-run-research",
              profileSlug: "research",
            },
          },
          {
            id: "delegate-reviewer",
            tool_name: "delegate_to_agent_profile",
            args: { profileSlug: "reviewer" },
            agent_profile_run: {
              profileRunId: "profile-run-reviewer",
              profileSlug: "reviewer",
            },
          },
        ],
        agent_profile_runs: [
          {
            profileRunId: "profile-run-research",
            profileSlug: "research",
            profileName: "Research",
            model: "moonshotai.kimi-k2.5",
            inputTokens: 25000,
            outputTokens: 133,
            costUsd: 0.0154,
            durationMs: 10500,
            status: "completed",
            loopEvidence: {
              phases: [
                {
                  phase: "discovery",
                  status: "completed",
                  summary: "Gathered context.",
                },
                {
                  phase: "planning",
                  status: "completed",
                  summary: "Selected the web research path.",
                },
                {
                  phase: "execution",
                  status: "completed",
                  summary: "Ran research tools.",
                },
                {
                  index: 0,
                  phase: "verification",
                  status: "completed",
                  verdict: "pass",
                  summary: "Verified source support.",
                },
                {
                  phase: "iteration",
                  status: "skipped",
                  summary: "No revision needed.",
                },
                {
                  phase: "handoff",
                  status: "completed",
                  summary: "Returned research handoff.",
                },
              ],
            },
            toolInvocations: [
              {
                tool_name: "web_search",
                input_preview: '{"query":"Stripe CEO"}',
                output_preview: "Search results",
              },
            ],
          },
          {
            profileRunId: "profile-run-reviewer",
            profileSlug: "reviewer",
            profileName: "Reviewer",
            model: "moonshotai.kimi-k2.5",
            inputTokens: 1100,
            outputTokens: 104,
            costUsd: 0.001,
            durationMs: 934,
            status: "completed",
            loopEvidence: {
              phases: [
                {
                  phase: "discovery",
                  status: "completed",
                },
                {
                  phase: "planning",
                  status: "completed",
                },
                {
                  phase: "execution",
                  status: "completed",
                },
                {
                  index: 0,
                  phase: "verification",
                  status: "completed",
                  verdict: "pass",
                  summary: "Reviewer passed the answer.",
                },
                {
                  phase: "iteration",
                  status: "skipped",
                },
                {
                  phase: "handoff",
                  status: "completed",
                },
              ],
            },
          },
        ],
      },
    );

    expect(rows.map((row) => row.title).slice(0, 4)).toEqual([
      "Using delegate to agent profile",
      "Agent Profile: Research",
      "Using delegate to agent profile",
      "Agent Profile: Reviewer",
    ]);
    expect(rows[1]?.children?.[0]?.title).toBe("Research: Finding sources");
    expect(rows[1]?.detail).toContain("Loop:");
    expect(rows[1]?.detail).toContain(
      "- Discovery: completed — Gathered context.",
    );
    expect(rows[1]?.detail).toContain(
      "- Verification: completed · verdict pass — Verified source support.",
    );
    expect(rows[1]?.detail).toContain(
      "- Iteration: skipped — No revision needed.",
    );
    expect(rows[3]?.detail).toContain(
      "- Verification: completed · verdict pass — Reviewer passed the answer.",
    );
  });

  it("renders one Thinking disclosure per turn, anchored to its user message in chronological order", () => {
    // U3 regression guard: prior behavior attached only the latest turn's
    // activity to the latest user message, leaving earlier turns invisible.
    // Admin shows a Thinking row per user/computer pair; Computer must match.
    render(
      <TaskThreadView
        thread={{
          id: "thread-multi",
          title: "Multi-turn",
          lifecycleStatus: "COMPLETED",
          messages: [
            { id: "u1", role: "USER", content: "First question" },
            {
              id: "a1",
              role: "ASSISTANT",
              content: "First answer",
            },
            { id: "u2", role: "USER", content: "Second question" },
            {
              id: "a2",
              role: "ASSISTANT",
              content: "Second answer",
            },
          ],
          // Resolver emits turns DESC; the component must sort ASC before
          // pairing with user messages.
          turns: [
            {
              id: "turn-2",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T10:05:00Z",
              finishedAt: "2026-05-09T10:05:30Z",
            },
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T10:00:00Z",
              finishedAt: "2026-05-09T10:00:30Z",
            },
          ],
        }}
      />,
    );

    // Exactly one turn surface per turn, both with the labelled-region affordance.
    const thinkingDetailsList = screen.getAllByLabelText("Turn activity");
    expect(thinkingDetailsList).toHaveLength(2);

    // Chronological order: the first user's Thinking row must appear before
    // the second user's Thinking row in the DOM.
    const [first, second] = thinkingDetailsList;
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("anchors a turn to its triggering message, not an intervening human's message", () => {
    // U3: in a multi-player thread another human's message is a USER message
    // that triggers no turn. Positional pairing pinned the agent's turn to that
    // intervening message; causal pairing (by startedAt vs createdAt) keeps it
    // on the message that actually triggered it.
    render(
      <TaskThreadView
        thread={{
          id: "thread-mp",
          title: "Group thread",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "u-me-1",
              role: "USER",
              content: "Agent, summarize this",
              createdAt: "2026-05-29T10:00:00Z",
              sender: { type: "user", id: "user-me" },
            },
            {
              id: "a-1",
              role: "ASSISTANT",
              content: "Summary…",
              createdAt: "2026-05-29T10:00:20Z",
            },
            {
              id: "u-scott",
              role: "USER",
              content: "thanks!",
              createdAt: "2026-05-29T10:01:00Z",
              sender: { type: "user", id: "user-scott" },
            },
          ],
          // One turn, triggered by the first message (started before Scott's
          // reply). The resolver emits DESC; component sorts ASC.
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-29T10:00:05Z",
              finishedAt: "2026-05-29T10:00:20Z",
            },
          ],
        }}
        currentUser={{ id: "user-me", name: "Me" }}
      />,
    );

    // Exactly one turn disclosure, and it renders before Scott's "thanks!"
    // message — not pinned beneath it.
    const disclosures = screen.getAllByLabelText("Turn activity");
    expect(disclosures).toHaveLength(1);
    const scottMessage = screen.getByText("thanks!");
    expect(
      disclosures[0].compareDocumentPosition(scottMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("collapses multiple turns for one user message to a single disclosure", () => {
    // U3 edge: a tool-loop can emit several turns for one user prompt. Causal
    // pairing maps them all to that message; the transcript renders one
    // disclosure (latest turn wins) rather than crashing or stacking.
    render(
      <TaskThreadView
        thread={{
          id: "thread-loop",
          title: "Tool loop",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "u1",
              role: "USER",
              content: "Do the thing",
              createdAt: "2026-05-29T10:00:00Z",
            },
          ],
          turns: [
            {
              id: "turn-a",
              status: "succeeded",
              startedAt: "2026-05-29T10:00:05Z",
              finishedAt: "2026-05-29T10:00:10Z",
            },
            {
              id: "turn-b",
              status: "succeeded",
              startedAt: "2026-05-29T10:00:11Z",
              finishedAt: "2026-05-29T10:00:20Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByLabelText("Turn activity")).toHaveLength(1);
  });

  it("anchors a turn with no preceding user message without crashing", () => {
    // U3 edge: a turn whose startedAt precedes every user message (e.g. a
    // scheduled-job trigger) anchors to the earliest message rather than
    // dropping or throwing. A dedicated unattributed surface is deferred.
    render(
      <TaskThreadView
        thread={{
          id: "thread-sched",
          title: "Scheduled",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "u1",
              role: "USER",
              content: "Later message",
              createdAt: "2026-05-29T10:00:00Z",
            },
          ],
          turns: [
            {
              id: "turn-early",
              status: "succeeded",
              startedAt: "2026-05-29T09:59:00Z",
              finishedAt: "2026-05-29T09:59:30Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByLabelText("Turn activity")).toHaveLength(1);
  });

  it("keeps the turn-activity aria-label intact on the Reasoning disclosure", () => {
    // The labelled region affordance survives the header relabel — screen
    // readers find the surface by name even though the visible header is now
    // the Codex-style "Working…" / "Worked for Xs".
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Aria check",
          lifecycleStatus: "RUNNING",
          messages: [{ id: "m1", role: "USER", content: "Run" }],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );
    const labelled = screen.getByLabelText("Turn activity");
    expect(labelled.getAttribute("data-state")).toBe("closed");
  });

  it("sends follow-up messages from the composer", async () => {
    // Plan-012 U13: PromptInput form submit is async (Promise.all
    // chain through file conversion before dispatch). useComposerState
    // tracks the text so we type via the textarea and click submit;
    // waitFor handles the microtask boundary.
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Follow-up thread",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Start",
            },
          ],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    setFollowUpText(screen.getByLabelText("Follow up"), "Add detail");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      // U1 of finance pilot — FollowUpComposer forwards a files array
      // (empty when no attachments) alongside the text. The route
      // uploads files before sendMessage and embeds attachmentId refs
      // in metadata.attachments.
      expect(onSendFollowUp).toHaveBeenCalledWith(
        "Add detail",
        [],
        [],
        true,
        [],
      );
    });
  });

  it("submits follow-up goal mode from the icon toggle", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Goal follow-up thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    expect(
      screen
        .getByRole("button", { name: "Send to agent" })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    const goalToggle = screen.getByRole("button", { name: "Goal mode" });
    fireEvent.click(goalToggle);
    expect(goalToggle.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Send to agent" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    setFollowUpText(screen.getByLabelText("Follow up"), "Finish the migration");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenCalledWith(
        "Finish the migration",
        [],
        [],
        true,
        [],
        undefined,
        {
          enabled: true,
          action: "start",
          objective: "Finish the migration",
        },
      );
    });
  });

  it("submits /goal follow-up shorthand as stripped goal content", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Slash goal thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    setFollowUpText(
      screen.getByLabelText("Follow up"),
      "/goal reconcile the customer list",
    );
    expect(
      screen
        .getByRole("button", { name: "Goal mode" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenCalledWith(
        "reconcile the customer list",
        [],
        [],
        true,
        [],
        undefined,
        {
          enabled: true,
          action: "start",
          objective: "reconcile the customer list",
        },
      );
    });
  });

  it("resets follow-up Goal mode after a successful send", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Goal reset thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    const goalToggle = screen.getByRole("button", { name: "Goal mode" });
    fireEvent.click(goalToggle);
    setFollowUpText(screen.getByLabelText("Follow up"), "Do the thing");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(goalToggle.getAttribute("aria-pressed")).toBe("false");
    });

    setFollowUpText(screen.getByLabelText("Follow up"), "Normal follow up");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenLastCalledWith(
        "Normal follow up",
        [],
        [],
        true,
        [],
      );
    });
  });

  it("keeps the agent toggle off after a successful human-only send", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Human-only thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    const agentToggle = screen.getByRole("button", { name: "Send to agent" });
    expect(agentToggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(agentToggle);
    expect(agentToggle.getAttribute("aria-pressed")).toBe("false");
    setFollowUpText(screen.getByLabelText("Follow up"), "For humans only");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenCalledWith(
        "For humans only",
        [],
        [],
        false,
        [],
      );
    });
    expect(agentToggle.getAttribute("aria-pressed")).toBe("false");

    setFollowUpText(screen.getByLabelText("Follow up"), "Still just humans");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenLastCalledWith(
        "Still just humans",
        [],
        [],
        false,
        [],
      );
    });
  });

  it("resets the agent toggle on when switching threads", () => {
    const { rerender } = render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "First thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    const agentToggle = screen.getByRole("button", { name: "Send to agent" });
    fireEvent.click(agentToggle);
    expect(agentToggle.getAttribute("aria-pressed")).toBe("false");

    rerender(
      <TaskThreadView
        thread={{
          id: "thread-2",
          title: "Second thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-2", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Send to agent" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps the agent toggle footprint stable and avoids an enabled background", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Stable toggle thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    const agentToggle = screen.getByRole("button", { name: "Send to agent" });
    const agentIcon = agentToggle.querySelector("svg");
    expect(agentToggle.className).toContain("size-8");
    expect(agentToggle.className).toContain("text-[#54a9ff]");
    expect(agentIcon?.getAttribute("class")).toContain("size-5");
    expect(agentIcon?.getAttribute("class")).not.toContain("text-[#54a9ff]");
    expect(agentToggle.className).not.toContain("bg-white/15");

    fireEvent.click(agentToggle);

    expect(agentToggle.className).toContain("size-8");
    expect(agentToggle.className).toContain("text-white/60");
    expect(agentToggle.className).not.toContain("bg-white/15");
  });

  it("does not render a runtime (cloud) toggle in the follow-up composer", () => {
    vi.stubGlobal("__DESKTOP_BUILD__", true);
    Object.defineProperty(window, "thinkworkBridge", {
      configurable: true,
      value: {},
    });
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Runtime preference thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: /local pi/i,
      }),
    ).toBeNull();
  });

  it("does not subscribe to desktop-local diagnostics for turn activity", () => {
    vi.stubGlobal("__DESKTOP_BUILD__", true);
    Object.defineProperty(window, "thinkworkBridge", {
      configurable: true,
      value: {},
    });

    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Legacy runtime thread",
          lifecycleStatus: "RUNNING",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "desktop-local",
              startedAt: "2026-05-28T20:52:00.000Z",
            },
          ],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    expect(screen.queryByText(/local pi/i)).toBeNull();
    expect(screen.queryByText(/just-bash/i)).toBeNull();
    expect(screen.queryByRole("log", { name: /console output/i })).toBeNull();

    openThinkingDisclosure();
    expect(screen.queryByText(/local pi/i)).toBeNull();
  });

  it("renders voice input next to the send button", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Voice composer thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    const voiceInput = screen.getByRole("button", { name: "Voice input" });
    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(voiceInput).toBeTruthy();
    expect(sendButton.parentElement?.contains(voiceInput)).toBe(true);
  });

  it("right-aligns the follow-up model choice beside voice input", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Follow-up model controls",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={vi.fn()}
        approvedModels={[
          {
            id: "model-haiku",
            modelId: "anthropic.claude-haiku",
            displayName: "Claude Haiku",
            provider: "amazon_bedrock",
            inputCostPerMillion: 0.15,
            outputCostPerMillion: 0.6,
          },
        ]}
        selectedModelId="anthropic.claude-haiku"
        onSelectedModelChange={() => {}}
      />,
    );

    const actionControls = screen.getByTestId("follow-up-action-controls");
    const trigger = screen.getByLabelText("Select model");
    const voiceInput = screen.getByRole("button", { name: "Voice input" });
    expect(actionControls.className).toContain("ml-auto");
    expect(actionControls.className).toContain("justify-end");
    expect(actionControls.contains(trigger)).toBe(true);
    expect(actionControls.contains(voiceInput)).toBe(true);
    expect(trigger.compareDocumentPosition(voiceInput)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("preserves a disabled agent toggle after send failure for retry", async () => {
    const onSendFollowUp = vi
      .fn()
      .mockRejectedValueOnce(new Error("Message failed"))
      .mockResolvedValueOnce(undefined);
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Retry thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    const agentToggle = screen.getByRole("button", { name: "Send to agent" });
    fireEvent.click(agentToggle);
    setFollowUpText(screen.getByLabelText("Follow up"), "Try once");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText("Message failed")).toBeTruthy();
    expect(agentToggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenLastCalledWith(
        "Try once",
        [],
        [],
        false,
        [],
      );
    });
  });

  it("shows a contains-filtered mention picker and submits the selected mention", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Mention thread",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Start",
            },
          ],
        }}
        mentionTargets={[
          {
            id: "user:u1",
            targetType: "USER",
            targetId: "u1",
            displayName: "Scott Odom",
            role: "eric@thinkwork.ai",
          },
          {
            id: "agent:a1",
            targetType: "AGENT",
            targetId: "a1",
            displayName: "Marco",
            role: "agent",
          },
        ]}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    const input = screen.getByLabelText("Follow up");
    setFollowUpText(input, "@cot");

    expect(screen.getByText("Scott Odom")).toBeTruthy();
    expect(screen.queryByText("Marco")).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /Scott Odom/ }));
    expect(followUpValue(input)).toBe("@Scott Odom ");

    // Mentioning another user makes the thread multi-player, so the agent
    // toggle auto-derives OFF (single -> on, multi -> off).
    expect(
      screen
        .getByRole("button", { name: "Send to agent" })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenCalledWith(
        "@Scott Odom",
        [],
        [
          {
            targetType: "USER",
            targetId: "u1",
            displayName: "Scott Odom",
            rawText: "@Scott Odom",
          },
        ],
        false,
        [],
      );
    });
  });

  it("defaults the agent toggle OFF when another human has already posted", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-mp",
          title: "Group thread",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "m1",
              role: "USER",
              content: "Hi",
              sender: { type: "user", id: "user-current" },
            },
            {
              id: "m2",
              role: "USER",
              content: "Hey back",
              sender: { type: "user", id: "user-scott" },
            },
          ],
        }}
        currentUser={{ id: "user-current", name: "Eric Odom" }}
        onSendFollowUp={vi.fn()}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Send to agent" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("commits the highlighted mention on Tab and closes the menu on Escape", () => {
    const renderMentionComposer = () =>
      render(
        <TaskThreadView
          thread={{
            id: "thread-1",
            title: "Mention thread",
            lifecycleStatus: "IDLE",
            messages: [{ id: "message-1", role: "USER", content: "Start" }],
          }}
          mentionTargets={[
            {
              id: "user:u1",
              targetType: "USER",
              targetId: "u1",
              displayName: "Scott Odom",
              role: "eric@thinkwork.ai",
            },
          ]}
          onSendFollowUp={vi.fn()}
        />,
      );

    const { unmount } = renderMentionComposer();
    let input = screen.getByLabelText("Follow up");

    // Tab commits the highlighted mention (same as Enter).
    setFollowUpText(input, "@cot");
    expect(screen.getByRole("option", { name: /Scott Odom/ })).toBeTruthy();
    const tabEvent = fireEvent.keyDown(input, { key: "Tab" });
    expect(tabEvent).toBe(false); // preventDefault was called
    expect(followUpValue(input)).toBe("@Scott Odom ");

    unmount();

    // Escape closes the menu without committing.
    renderMentionComposer();
    input = screen.getByLabelText("Follow up");
    setFollowUpText(input, "@cot");
    expect(screen.getByRole("option", { name: /Scott Odom/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("option", { name: /Scott Odom/ })).toBeNull();
    expect(followUpValue(input)).toBe("@cot");
  });

  it("selects the pinned agent mention and forces agent handling back on", async () => {
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Agent shortcut thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        mentionTargets={[
          {
            id: "agent:a1",
            targetType: "AGENT",
            targetId: "a1",
            displayName: "Coordinator",
            aliases: ["agent", "think"],
            isDefaultAgent: true,
            role: "agent",
          },
        ]}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    const agentToggle = screen.getByRole("button", { name: "Send to agent" });
    fireEvent.click(agentToggle);
    expect(agentToggle.getAttribute("aria-pressed")).toBe("false");

    const input = screen.getByLabelText("Follow up");
    setFollowUpText(input, "@");
    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toContain("agent");
    fireEvent.click(options[0]!);

    expect(followUpValue(input)).toBe("@agent ");
    expect(agentToggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenCalledWith(
        "@agent",
        [],
        [
          {
            targetType: "AGENT",
            targetId: "a1",
            displayName: "agent",
            rawText: "@agent",
          },
        ],
        true,
        [],
      );
    });
  });

  it("forces the agent toggle on while @think or @agent aliases are typed", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Alias thread",
          lifecycleStatus: "IDLE",
          messages: [{ id: "message-1", role: "USER", content: "Start" }],
        }}
        onSendFollowUp={vi.fn()}
      />,
    );

    const agentToggle = screen.getByRole("button", { name: "Send to agent" });
    fireEvent.click(agentToggle);
    expect(agentToggle.getAttribute("aria-pressed")).toBe("false");

    const input = screen.getByLabelText("Follow up");
    setFollowUpText(input, "@think please");

    expect(agentToggle.getAttribute("aria-pressed")).toBe("true");
    expect(agentToggle).toHaveProperty("disabled", true);

    setFollowUpText(input, "please");
    expect(agentToggle.getAttribute("aria-pressed")).toBe("true");
    expect(agentToggle).toHaveProperty("disabled", false);
  });

  it("supports keyboard selection in the mention picker", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Mention thread",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Start",
            },
          ],
        }}
        mentionTargets={[
          {
            id: "user:u1",
            targetType: "USER",
            targetId: "u1",
            displayName: "Scott Odom",
            role: "member",
          },
          {
            id: "agent:a1",
            targetType: "AGENT",
            targetId: "a1",
            displayName: "Marco",
            role: "agent",
          },
        ]}
        onSendFollowUp={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Follow up");
    setFollowUpText(input, "@o");

    let options = screen.getAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    options = screen.getAllByRole("option");
    expect(options[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(followUpValue(input)).toBe("@Marco ");
  });

  describe("collapsible user message body", () => {
    // jsdom returns 0 for scrollHeight by default. Mock the prototype
    // getter so the layout effect inside CollapsibleUserMessageBody can
    // decide whether a message overflows the 10-line clamp (280px).
    function mockScrollHeight(value: number) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          return value;
        },
      });
    }

    afterEach(() => {
      delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
    });

    function renderUserMessage(content: string) {
      return render(
        <TaskThreadView
          thread={{
            id: "thread-collapse",
            messages: [
              {
                id: "user-1",
                role: "USER",
                content,
              },
            ],
          }}
        />,
      );
    }

    it("renders short user messages without a Show more affordance", () => {
      mockScrollHeight(120);
      renderUserMessage("Tiny prompt");

      const wrapper = screen.getByTestId("collapsible-user-body");
      const bubble = wrapper.closest('[class*="bg-muted"]');
      const message = wrapper.closest('[data-message-role="user"]');
      expect(message?.className ?? "").toContain("my-1");
      expect(bubble?.className ?? "").toContain("!px-3");
      expect(bubble?.className ?? "").toContain("!py-2");
      expect(bubble?.className ?? "").toContain("text-[15px]");
      expect(bubble?.className ?? "").toContain("leading-5");
      expect(bubble?.className ?? "").not.toContain("px-5");
      expect(bubble?.className ?? "").not.toContain("text-base");
      expect(wrapper.getAttribute("data-collapsed")).toBe("false");
      expect(wrapper.style.maxHeight).toBe("");
      expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
    });

    it("clips long user messages and surfaces a Show more affordance", () => {
      mockScrollHeight(800);
      renderUserMessage("Long prompt that exceeds the clamp threshold");

      const wrapper = screen.getByTestId("collapsible-user-body");
      expect(wrapper.getAttribute("data-collapsed")).toBe("true");
      expect(wrapper.style.maxHeight).toBe("200px");
      expect(wrapper.className).toContain("overflow-hidden");
      expect(screen.getByRole("button", { name: /show more/i })).toBeTruthy();
    });

    it("expands to full content when Show more is clicked", () => {
      mockScrollHeight(800);
      renderUserMessage("Long prompt that overflows");

      const button = screen.getByRole("button", { name: /show more/i });
      fireEvent.click(button);

      const wrapper = screen.getByTestId("collapsible-user-body");
      expect(wrapper.getAttribute("data-collapsed")).toBe("false");
      expect(wrapper.style.maxHeight).toBe("");
      // The clamp affordance flips to "Show less" once expanded so the
      // user can re-collapse without scrolling past the full prompt.
      expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
      expect(screen.getByRole("button", { name: /show less/i })).toBeTruthy();
    });

    it("re-collapses back to clipped state when Show less is clicked", () => {
      mockScrollHeight(800);
      renderUserMessage("Long prompt that overflows");

      fireEvent.click(screen.getByRole("button", { name: /show more/i }));
      fireEvent.click(screen.getByRole("button", { name: /show less/i }));

      const wrapper = screen.getByTestId("collapsible-user-body");
      expect(wrapper.getAttribute("data-collapsed")).toBe("true");
      expect(wrapper.style.maxHeight).toBe("200px");
      expect(screen.getByRole("button", { name: /show more/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /show less/i })).toBeNull();
    });

    it("re-evaluates overflow when the body content grows past the threshold", () => {
      mockScrollHeight(120);
      const { rerender } = renderUserMessage("Tiny prompt");

      expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();

      mockScrollHeight(900);
      rerender(
        <TaskThreadView
          thread={{
            id: "thread-collapse",
            messages: [
              {
                id: "user-1",
                role: "USER",
                content: "Now-long prompt that exceeds the clamp",
              },
            ],
          }}
        />,
      );

      const wrapper = screen.getByTestId("collapsible-user-body");
      expect(wrapper.getAttribute("data-collapsed")).toBe("true");
      expect(wrapper.style.maxHeight).toBe("200px");
      expect(screen.getByRole("button", { name: /show more/i })).toBeTruthy();
    });

    it("leaves long assistant messages unchanged", () => {
      // Even with a giant scrollHeight, the assistant render path does
      // not route through CollapsibleUserMessageBody, so no clamp wrapper
      // is added to the assistant message. (The user message, also
      // mocked at 900px, legitimately surfaces its own "Show more" — the
      // invariant being checked here is wrapper count and assistant
      // content presence.)
      const longAssistantBody =
        "A very long assistant response that would overflow if " +
        "the clamp logic applied to it, but must not.";
      mockScrollHeight(900);
      render(
        <TaskThreadView
          thread={{
            id: "thread-collapse-assistant",
            messages: [
              {
                id: "user-1",
                role: "USER",
                content: "short",
              },
              {
                id: "assistant-1",
                role: "ASSISTANT",
                content: longAssistantBody,
              },
            ],
          }}
        />,
      );

      // Exactly one CollapsibleUserMessageBody wrapper exists — the
      // user message. The assistant message never receives one.
      expect(screen.getAllByTestId("collapsible-user-body")).toHaveLength(1);

      // The assistant message renders inside the assistant DOM region
      // with its content visible (no clamp).
      const assistantNode = document.querySelector(
        '[data-message-role="assistant"]',
      );
      expect(assistantNode).toBeTruthy();
      expect(assistantNode?.textContent ?? "").toContain(longAssistantBody);
      expect(
        assistantNode?.querySelector('[data-testid="collapsible-user-body"]'),
      ).toBeNull();
    });

    it("preserves the empty-body fallback for messages with no content", () => {
      mockScrollHeight(0);
      renderUserMessage("");

      expect(screen.getByText("(No message content)")).toBeTruthy();
      expect(screen.queryByTestId("collapsible-user-body")).toBeNull();
      expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
    });
  });

  describe("info panel thread detail link", () => {
    function renderPanel() {
      render(
        <TaskThreadView
          thread={{
            id: "thread-1",
            identifier: "CHAT-831",
            title: "CRM pipeline risk",
            lifecycleStatus: "COMPLETED",
            messages: [{ id: "m1", role: "USER", content: "hi" }],
          }}
          infoPanelState={{
            isOpen: true,
            onOpenChange: vi.fn(),
            threadId: "thread-1",
            threadIdentifier: "CHAT-831",
            startedAt: "2026-05-18T20:50:00.000Z",
            startedBy: "Eric Odom",
            agents: [],
            attachments: [],
            onDownloadAttachment: vi.fn(),
          }}
          onSendFollowUp={vi.fn()}
        />,
      );
      return screen.getByTestId("thread-info-panel");
    }

    it("links operators to the main-shell thread detail route", () => {
      tenantMock.isOperator = true;
      const panel = renderPanel();
      const link = within(panel).getByRole("link", {
        name: /open thread detail/i,
      });
      // Stays in the main section (_shell route), not /settings/...
      expect(link.getAttribute("href")).toBe("/activity/thread-1");
    });

    it("hides the thread detail link from non-operators", () => {
      tenantMock.isOperator = false;
      const panel = renderPanel();
      expect(
        within(panel).queryByRole("link", { name: /open thread detail/i }),
      ).toBeNull();
    });
  });
});

describe("normalizePersistedParts", () => {
  it("folds flat data-part fields into the data envelope (user-question intake shape)", () => {
    // Regression: the user-question intake persists {type, questionId,
    // questions} flat on the part — no `data` envelope. The normalizer used
    // to keep only {type, id, data}, stripping the questions entirely and
    // rendering an empty card.
    const parts = normalizePersistedParts([
      {
        type: "data-user-question",
        questionId: "q-1",
        questions: [
          {
            header: "Timing",
            question: "When should the report run?",
            options: [
              { label: "Monday (Recommended)", description: "Plan ahead." },
              { label: "Friday", description: "Close the week." },
            ],
          },
        ],
      },
    ]);

    expect(parts).toHaveLength(1);
    const part = parts[0] as { type: string; data?: Record<string, unknown> };
    expect(part.type).toBe("data-user-question");
    expect(part.data?.questionId).toBe("q-1");
    expect(Array.isArray(part.data?.questions)).toBe(true);
  });

  it("prefers an explicit data envelope when present", () => {
    const parts = normalizePersistedParts([
      {
        type: "data-user-question",
        data: { questionId: "q-2", questions: [] },
        questionId: "stale-flat-id",
      },
    ]);
    const part = parts[0] as { data?: Record<string, unknown> };
    expect(part.data?.questionId).toBe("q-2");
  });
});

describe("flag-for-evaluation affordance (Trust Core U7)", () => {
  afterEach(() => {
    cleanup();
  });

  const flagThread = (turnStatus: string) => ({
    id: "thread-1",
    title: "Flaggable",
    messages: [
      { id: "message-1", role: "USER", content: "Do the thing" },
      { id: "message-2", role: "ASSISTANT", content: "Did the thing badly." },
    ],
    turns: [
      {
        id: "turn-1",
        status: turnStatus,
        invocationSource: "chat_message",
        startedAt: "2026-06-01T00:00:00Z",
        finishedAt: "2026-06-01T00:01:00Z",
      },
    ],
  });

  it("renders a flag button on completed turns when onFlagTurn is wired and forwards the turn", () => {
    const onFlagTurn = vi.fn();
    render(
      <TaskThreadView
        thread={flagThread("succeeded")}
        onFlagTurn={onFlagTurn}
      />,
    );
    const button = screen.getByTestId("flag-turn-turn-1");
    fireEvent.click(button);
    expect(onFlagTurn).toHaveBeenCalledTimes(1);
    expect(onFlagTurn.mock.calls[0][0]).toMatchObject({ id: "turn-1" });
  });

  it("renders no flag button without the (operator-gated) callback", () => {
    render(<TaskThreadView thread={flagThread("succeeded")} />);
    expect(screen.queryByTestId("flag-turn-turn-1")).toBeNull();
  });

  it("renders no flag button on in-flight turns", () => {
    render(
      <TaskThreadView thread={flagThread("running")} onFlagTurn={vi.fn()} />,
    );
    expect(screen.queryByTestId("flag-turn-turn-1")).toBeNull();
  });
});
