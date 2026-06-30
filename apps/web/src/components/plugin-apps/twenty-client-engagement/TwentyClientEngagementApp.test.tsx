import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  accountsMock,
  overlayRowsMock,
  appOverlayRowsMock,
  mutationCalls,
  upsertOverlayMock,
  fetchTwentyEngagementDashboardMock,
  updateTwentyOpportunityStageMock,
  updateTwentyLayerStatusMock,
  saveTwentyStakeholderMock,
  usePageHeaderActionsMock,
  navigateMock,
} = vi.hoisted(() => ({
  accountsMock: [
    {
      company: {
        id: "company-1",
        name: "McPherson Companies",
        domainName: "mcpherson.example",
        crmUrl: "https://crm.thinkwork.ai/objects/companies/company-1",
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
            crmUrl: "https://crm.thinkwork.ai/objects/opportunities/opp-1",
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
      stakeholders: [
        {
          id: "person-1",
          name: "Chad Logan",
          title: "Operations / IT Lead",
          department: "Operations",
          role: "Technical Champion",
          email: "chad@example.test",
          companyId: "company-1",
          crmUrl: "https://crm.thinkwork.ai/objects/people/person-1",
        },
      ],
    },
    {
      company: {
        id: "company-2",
        name: "Prospect Only",
        domainName: "prospect.example",
        crmUrl: "https://crm.thinkwork.ai/objects/companies/company-2",
      },
      opportunities: [],
      stakeholders: [],
    },
  ],
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
  fetchTwentyEngagementDashboardMock: vi.fn(async () => ({
    accounts: accountsMock,
  })),
  updateTwentyOpportunityStageMock: vi.fn(async (opportunityId, stage) => ({
    id: opportunityId,
    name: "JDE AI Query Layer",
    stage,
    stageLabel: "SOW Delivered",
    amountMicros: 8750000000,
    closeDate: "2026-07-27",
    companyId: "company-1",
    companyName: "McPherson Companies",
    crmUrl: "https://crm.thinkwork.ai/objects/opportunities/opp-1",
  })),
  updateTwentyLayerStatusMock: vi.fn(async (layerId, layerStatus) => ({
    id: layerId,
    name: "Core Problem",
    layerType: "CORE_PROBLEM",
    layerTypeLabel: "Core Problem",
    instanceName: "JDE visibility",
    layerStatus,
    layerStatusLabel: "Ready for SOW",
    whatWeKnow: "Manual JDE data pulls are slow.",
    openQuestions: "Who owns Snowflake access?",
    businessValue: "Reduce analyst lookup time.",
    nextSteps: "Confirm read-only access.",
    opportunityId: "opp-1",
  })),
  saveTwentyStakeholderMock: vi.fn(async (input) => ({
    id: input.stakeholderId ?? "person-new",
    companyId: input.companyId,
    name: input.name,
    title: input.title ?? null,
    department: input.department ?? null,
    role: input.role ?? null,
    email: input.email ?? null,
    crmUrl: "https://crm.thinkwork.ai/objects/people/person-new",
  })),
  usePageHeaderActionsMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: usePageHeaderActionsMock,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("./data/twentyEngagementApi", () => ({
  fetchTwentyEngagementDashboard: fetchTwentyEngagementDashboardMock,
  updateTwentyOpportunityStage: updateTwentyOpportunityStageMock,
  updateTwentyLayerStatus: updateTwentyLayerStatusMock,
  saveTwentyStakeholder: saveTwentyStakeholderMock,
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
    return [{ fetching: false, error: null, data: {} }, vi.fn()];
  },
  useMutation: () => [{ fetching: false }, upsertOverlayMock],
}));

import { TwentyClientEngagementApp } from "./TwentyClientEngagementApp";

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

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

function renderLatestTitleContent() {
  const titleContent = latestHeaderActions().titleContent;
  if (!titleContent) throw new Error("Expected header title content");
  return render(<>{titleContent}</>);
}

async function openFirstAccount() {
  fireEvent.click(await screen.findByText("McPherson Companies"));
}

async function openFirstAccountOpportunities() {
  await openFirstAccount();
  fireEvent.click(screen.getByRole("tab", { name: /Opportunities/ }));
}

afterEach(() => {
  cleanup();
  overlayRowsMock.length = 0;
  appOverlayRowsMock.length = 0;
  mutationCalls.length = 0;
  upsertOverlayMock.mockClear();
  fetchTwentyEngagementDashboardMock.mockClear();
  updateTwentyOpportunityStageMock.mockClear();
  updateTwentyLayerStatusMock.mockClear();
  saveTwentyStakeholderMock.mockClear();
  usePageHeaderActionsMock.mockClear();
  navigateMock.mockClear();
});

describe("TwentyClientEngagementApp", () => {
  it("publishes the app title through the shell breadcrumb header", async () => {
    render(
      <TwentyClientEngagementApp
        appDisplayName="Client Engagement"
        pluginDisplayName="Twenty CRM"
      />,
    );

    expect(await screen.findByText("McPherson Companies")).toBeTruthy();
    expect(usePageHeaderActionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Client Engagement",
        documentTitle: "Twenty CRM · Client Engagement",
        breadcrumbs: [
          { label: "Apps", onClick: expect.any(Function) },
          { label: "Twenty CRM" },
          { label: "Client Engagement", onClick: undefined },
        ],
      }),
    );
    latestHeaderActions().breadcrumbs?.[0]?.onClick?.();
    expect(navigateMock).toHaveBeenCalledWith({ to: "/apps" });
    const headerAction = renderLatestHeaderAction();
    expect(headerAction.getByRole("button", { name: "Pipeline" })).toBeTruthy();
    expect(headerAction.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(
      headerAction.queryByRole("link", { name: "Open in CRM" }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Search accounts" }),
    ).toBeNull();
    expect(screen.queryByText("Twenty CRM projection")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "McPherson Companies" }),
    ).toBeNull();

    fireEvent.click(screen.getByText("McPherson Companies"));

    expect(
      screen.getByRole("heading", { name: "McPherson Companies" }),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Account Profile" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Opportunities (1)" })).toBeTruthy();
    expect(screen.queryByText("1 active opportunity")).toBeNull();
    expect(latestHeaderActions().breadcrumbs).toEqual([
      { label: "Apps", onClick: expect.any(Function) },
      { label: "Twenty CRM" },
      { label: "Client Engagement", onClick: expect.any(Function) },
      { label: "McPherson Companies" },
    ]);
    const titleContent = renderLatestTitleContent();
    expect(
      titleContent.getByRole("button", { name: "Account picker" }),
    ).toBeTruthy();
    const selectedHeaderAction = renderLatestHeaderAction();
    expect(
      selectedHeaderAction
        .getByRole("link", { name: "Open in CRM" })
        .getAttribute("href"),
    ).toBe("https://crm.thinkwork.ai/objects/companies/company-1");
  });

  it("opens account and opportunity CRM data without direct browser MCP fetches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<TwentyClientEngagementApp />);
    await openFirstAccountOpportunities();
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

  it("opens CRM object paths on the Twenty CRM host", async () => {
    render(<TwentyClientEngagementApp />);
    await openFirstAccount();

    expect(
      renderLatestHeaderAction()
        .getByRole("link", { name: "Open in CRM" })
        .getAttribute("href"),
    ).toBe("https://crm.thinkwork.ai/objects/companies/company-1");
  });

  it("saves stakeholder sheet edits with one explicit CRM mutation", async () => {
    render(<TwentyClientEngagementApp />);
    await openFirstAccount();

    fireEvent.click(screen.getByText("Chad Logan"));
    fireEvent.change(screen.getByPlaceholderText("email@company.com"), {
      target: { value: "chad.logan@mcphersonoil.com" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Stakeholder role" }));
    fireEvent.click(
      await screen.findByRole("option", { name: "Internal Advocate" }),
    );

    expect(saveTwentyStakeholderMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveTwentyStakeholderMock).toHaveBeenCalledWith({
        stakeholderId: "person-1",
        companyId: "company-1",
        name: "Chad Logan",
        title: "Operations / IT Lead",
        department: "Operations",
        role: "Internal Advocate",
        email: "chad.logan@mcphersonoil.com",
      }),
    );
  });

  it("renders a useful empty state for accounts without opportunities", async () => {
    render(<TwentyClientEngagementApp />);

    fireEvent.click(await screen.findByText("Prospect Only"));
    fireEvent.click(screen.getByRole("tab", { name: /Opportunities/ }));

    expect(screen.getByText("No opportunities")).toBeTruthy();
    expect(
      screen.getByText("This account has no Twenty opportunities yet."),
    ).toBeTruthy();
  });

  it("saves overlay-owned KPI baseline and restores overlay values after remount", async () => {
    render(<TwentyClientEngagementApp />);
    await openFirstAccountOpportunities();
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
    await openFirstAccountOpportunities();
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
    await openFirstAccountOpportunities();
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
      screen.getByRole("heading", {
        name: "Value Discovery & Alignment Session",
      }),
    ).toBeTruthy();
    expect(screen.getAllByText(/JDE AI Query Layer/).length).toBeGreaterThan(0);
  });

  it("persists app-level opportunity pipeline edits and restores them after remount", async () => {
    render(<TwentyClientEngagementApp />);
    await screen.findByText("McPherson Companies");
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
    await screen.findByText("McPherson Companies");
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
