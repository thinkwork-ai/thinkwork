import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  dashboardResultMock,
  overlayRowsMock,
  appOverlayRowsMock,
  mutationCalls,
  upsertOverlayMock,
  updateStageMock,
  updateLayerStatusMock,
  usePageHeaderActionsMock,
} = vi.hoisted(() => ({
  dashboardResultMock: {
    fetching: false,
    error: null as { message: string } | null,
    data: {
      twentyEngagementDashboard: {
        accounts: [
          {
            company: {
              id: "company-1",
              name: "McPherson Companies",
              domainName: "mcpherson.example",
              crmUrl: "https://crm.example/company-1",
            },
            opportunities: [
              {
                opportunity: {
                  id: "opp-1",
                  name: "JDE AI Query Layer",
                  stage: "SOW_DELIVERED",
                  stageLabel: "SOW Delivered",
                  amountMicros: 8750000000,
                  closeDate: "2026-07-27",
                  companyId: "company-1",
                  companyName: "McPherson Companies",
                  crmUrl: "https://crm.example/opp-1",
                },
                layers: [
                  {
                    id: "layer-1",
                    name: "Core Problem",
                    layerType: "CORE_PROBLEM",
                    layerTypeLabel: "Core Problem",
                    instanceName: "JDE visibility",
                    layerStatus: "READY_FOR_SOW",
                    layerStatusLabel: "Ready for SOW",
                    whatWeKnow: "Manual JDE data pulls are slow.",
                    openQuestions: "Who owns Snowflake access?",
                    businessValue: "Reduce analyst lookup time.",
                    nextSteps: "Confirm read-only access.",
                    opportunityId: "opp-1",
                  },
                ],
              },
            ],
          },
          {
            company: {
              id: "company-2",
              name: "Prospect Only",
              domainName: "prospect.example",
              crmUrl: "https://crm.example/company-2",
            },
            opportunities: [],
          },
        ],
        companies: [],
        opportunities: [],
        opportunityLayers: [],
      },
    },
  },
  overlayRowsMock: [] as Array<{
    sectionKey: string;
    payload: Record<string, unknown>;
  }>,
  appOverlayRowsMock: [] as Array<{
    sectionKey: string;
    payload: Record<string, unknown>;
  }>,
  mutationCalls: [] as Array<{ name: string; variables: unknown }>,
  upsertOverlayMock: vi.fn(async (variables: unknown) => {
    mutationCalls.push({ name: "upsertOverlay", variables });
    return {
      data: {
        upsertPluginAppOverlay: {
          id: "overlay-1",
          sectionKey: "executive-view",
          payload: {},
        },
      },
    };
  }),
  updateStageMock: vi.fn(async (variables: unknown) => {
    mutationCalls.push({ name: "updateStage", variables });
    return { data: { updateTwentyEngagementOpportunityStage: {} } };
  }),
  updateLayerStatusMock: vi.fn(async (variables: unknown) => {
    mutationCalls.push({ name: "updateLayerStatus", variables });
    return { data: { updateTwentyEngagementOpportunityLayerStatus: {} } };
  }),
  usePageHeaderActionsMock: vi.fn(),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: usePageHeaderActionsMock,
}));

vi.mock("urql", () => ({
  useQuery: ({ variables }: { variables?: Record<string, unknown> }) => {
    const input = variables?.input as
      { providerRecordType?: string; providerRecordId?: string } | undefined;
    if (
      input?.providerRecordType === "opportunity" ||
      input?.providerRecordType === "app"
    ) {
      const rows =
        input.providerRecordType === "app"
          ? appOverlayRowsMock
          : overlayRowsMock;
      return [
        {
          fetching: false,
          error: null,
          data: {
            pluginAppOverlays: rows.map((row, index) => ({
              __typename: "PluginAppOverlay",
              id: `overlay-${index}`,
              pluginInstallId: "install-1",
              pluginKey: "twenty",
              appSurfaceKey: "client-engagement",
              appKey: "twenty-client-engagement",
              provider: "twenty",
              providerRecordType: input.providerRecordType,
              providerRecordId: input.providerRecordId,
              sectionKey: row.sectionKey,
              payload: row.payload,
              createdByUserId: "user-1",
              updatedByUserId: "user-1",
              createdAt: "2026-06-29T00:00:00Z",
              updatedAt: "2026-06-29T00:00:00Z",
            })),
          },
        },
        vi.fn(),
      ];
    }
    return [dashboardResultMock, vi.fn()];
  },
  useMutation: (document: unknown) => {
    const source = JSON.stringify(document);
    if (source.includes("UpdateTwentyEngagementOpportunityStage")) {
      return [{ fetching: false }, updateStageMock];
    }
    if (source.includes("UpdateTwentyEngagementOpportunityLayerStatus")) {
      return [{ fetching: false }, updateLayerStatusMock];
    }
    return [{ fetching: false }, upsertOverlayMock];
  },
}));

import { TwentyClientEngagementApp } from "./TwentyClientEngagementApp";

function latestHeaderActions() {
  const actions = usePageHeaderActionsMock.mock.calls.at(-1)?.[0];
  if (!actions) throw new Error("Expected page header actions to be published");
  return actions;
}

function renderLatestHeaderAction() {
  const action = latestHeaderActions().action;
  if (!action) throw new Error("Expected page header action to be published");
  return render(<>{action}</>);
}

afterEach(() => {
  cleanup();
  overlayRowsMock.length = 0;
  appOverlayRowsMock.length = 0;
  mutationCalls.length = 0;
  upsertOverlayMock.mockClear();
  updateStageMock.mockClear();
  updateLayerStatusMock.mockClear();
  usePageHeaderActionsMock.mockClear();
  dashboardResultMock.fetching = false;
  dashboardResultMock.error = null;
});

describe("TwentyClientEngagementApp", () => {
  it("publishes the app title through the shell breadcrumb header", async () => {
    render(
      <TwentyClientEngagementApp
        appDisplayName="Client Engagement"
        pluginDisplayName="Twenty CRM"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "McPherson Companies" }),
    ).toBeTruthy();
    expect(usePageHeaderActionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Client Engagement",
        documentTitle: "Twenty CRM · Client Engagement",
        breadcrumbs: [
          { label: "Twenty CRM", href: "/settings/plugins/twenty" },
          { label: "Client Engagement" },
        ],
      }),
    );
    expect(
      renderLatestHeaderAction().getByRole("button", { name: "Pipeline" }),
    ).toBeTruthy();
    expect(screen.queryByText("Twenty CRM projection")).toBeNull();
  });

  it("opens account and opportunity CRM data without direct browser MCP fetches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<TwentyClientEngagementApp />);
    fireEvent.click(await screen.findByText("JDE AI Query Layer"));

    expect(
      screen.getByRole("heading", { name: "JDE AI Query Layer" }),
    ).toBeTruthy();
    expect(screen.getByText("What's next:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByText("JDE visibility")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("renders a useful empty state for accounts without opportunities", async () => {
    render(<TwentyClientEngagementApp />);

    fireEvent.click(await screen.findByText("Prospect Only"));

    expect(screen.getByRole("heading", { name: "Prospect Only" })).toBeTruthy();
    expect(screen.getByText("No opportunities")).toBeTruthy();
    expect(
      screen.getByText("This account has no Twenty opportunities yet."),
    ).toBeTruthy();
  });

  it("saves overlay-owned KPI baseline and restores overlay values after remount", async () => {
    render(<TwentyClientEngagementApp />);
    fireEvent.click(await screen.findByText("JDE AI Query Layer"));

    fireEvent.click(screen.getByRole("button", { name: "KPI Framework" }));
    fireEvent.change(await screen.findByLabelText("KPI baseline"), {
      target: { value: "8 hours/week manual lookup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(upsertOverlayMock).toHaveBeenCalledWith({
        input: {
          appKey: "twenty-client-engagement",
          provider: "twenty",
          providerRecordType: "opportunity",
          providerRecordId: "opp-1",
          sectionKey: "kpi-framework",
          payload: { kpiBaseline: "8 hours/week manual lookup" },
        },
      }),
    );

    cleanup();
    overlayRowsMock.push(
      {
        sectionKey: "kpi-framework",
        payload: { kpiBaseline: "8 hours/week manual lookup" },
      },
      {
        sectionKey: "executive-view",
        payload: { executiveNarrative: "Board-ready JDE visibility story" },
      },
    );

    render(<TwentyClientEngagementApp />);
    fireEvent.click(await screen.findByText("JDE AI Query Layer"));
    fireEvent.click(screen.getByRole("button", { name: "KPI Framework" }));
    expect(
      (screen.getByLabelText("KPI baseline") as HTMLInputElement).value,
    ).toBe("8 hours/week manual lookup");

    fireEvent.click(screen.getByRole("button", { name: "Strategic Goals" }));
    expect(
      (screen.getByLabelText("Executive narrative") as HTMLTextAreaElement)
        .value,
    ).toBe("Board-ready JDE visibility story");
  });

  it("opens converted tool views from an opportunity stage action", async () => {
    render(<TwentyClientEngagementApp />);
    fireEvent.click(await screen.findByText("JDE AI Query Layer"));

    fireEvent.click(
      screen.getByRole("button", { name: "Open Value Alignment" }),
    );

    expect(
      screen.getByRole("heading", {
        name: "ThinkWork AI - Value Discovery & Alignment",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("Value Discovery & Alignment Session"),
    ).toBeTruthy();
    expect(screen.getAllByText(/JDE AI Query Layer/).length).toBeGreaterThan(0);
  });

  it("persists app-level opportunity pipeline edits and restores them after remount", async () => {
    render(<TwentyClientEngagementApp />);
    fireEvent.click(
      renderLatestHeaderAction().getByRole("button", { name: "Pipeline" }),
    );

    fireEvent.change(await screen.findByLabelText("Pipeline client name"), {
      target: { value: "Acme Expansion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save use cases" }));

    await waitFor(() => {
      expect(upsertOverlayMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          appKey: "twenty-client-engagement",
          provider: "twenty",
          providerRecordType: "app",
          providerRecordId: "twenty-client-engagement",
          sectionKey: "use-case-pipeline",
          payload: expect.objectContaining({
            accounts: expect.arrayContaining([
              expect.objectContaining({ client: "Acme Expansion" }),
            ]),
          }),
        }),
      });
    });

    cleanup();
    appOverlayRowsMock.push({
      sectionKey: "use-case-pipeline",
      payload: {
        accounts: [
          {
            id: "account-restored",
            client: "Restored Account",
            champion: "Riley",
            dateSurfaced: "2026-06-29",
            sourceSession: "Pipeline review",
            urgency: "Expansion window",
            layers: [],
          },
        ],
      },
    });

    render(<TwentyClientEngagementApp />);
    fireEvent.click(
      renderLatestHeaderAction().getByRole("button", { name: "Pipeline" }),
    );

    expect(
      (
        (await screen.findByLabelText(
          "Pipeline client name",
        )) as HTMLInputElement
      ).value,
    ).toBe("Restored Account");
  });
});
