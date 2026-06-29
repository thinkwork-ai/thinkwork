import { GraphQLError } from "graphql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpCallToolResult } from "../../../lib/mcp-client-call.js";
import type { PluginDispatchAuthResolver } from "../../../lib/plugins/activation.js";
import {
  __setTwentyEngagementDepsForTests,
  twentyEngagementDashboard,
  updateTwentyEngagementOpportunityLayerStatus,
  updateTwentyEngagementOpportunityStage,
} from "./twenty-client-engagement.js";

const CTX = { auth: { tenantId: null } } as never;

const store = {
  findInstall: vi.fn(),
  findCrmComponent: vi.fn(),
  findCrmServer: vi.fn(),
};
const authResolver: PluginDispatchAuthResolver = {
  hasActiveActivation: vi.fn(),
  resolveToken: vi.fn(),
  resolveHeaders: vi.fn(),
};
const callTool = vi.fn();
let restoreDeps: (() => void) | null = null;

describe("twenty client engagement app resolvers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    store.findInstall.mockResolvedValue({ id: "install-1" });
    store.findCrmComponent.mockResolvedValue({ id: "component-1" });
    store.findCrmServer.mockResolvedValue({
      id: "server-1",
      name: "Twenty CRM",
      slug: "twenty--crm",
      url: "https://crm.example.test/mcp",
      transport: "streamable-http",
      auth_type: "oauth",
      auth_config: {},
      status: "approved",
      enabled: true,
    });
    vi.mocked(authResolver.resolveToken).mockResolvedValue("user-token");
    restoreDeps = __setTwentyEngagementDepsForTests({
      resolveTenantCaller: async () => ({
        tenantId: "tenant-1",
        callerUserId: "user-1",
      }),
      store,
      createAuthResolver: () => authResolver,
      callTool,
    });
  });

  afterEach(() => {
    restoreDeps?.();
    restoreDeps = null;
  });

  it("loads normalized account, opportunity, and layer records through the server-side Twenty plugin target", async () => {
    callTool
      .mockResolvedValueOnce(
        mcpJson({
          result: {
            records: [
              {
                id: "company-1",
                name: "Acme Corp",
                domainName: "acme.test",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        mcpJson({
          result: {
            records: [
              {
                id: "opp-1",
                name: "Board-ready demo",
                stage: "VALUE_ALIGNMENT",
                amount: { amountMicros: 250000000 },
                closeDate: "2026-07-31",
                companyId: "company-1",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        mcpJson({
          result: {
            records: [
              {
                id: "layer-1",
                name: "Data layer",
                layerType: "CORE_PROBLEM",
                instanceName: "JDE visibility",
                layerStatus: "READY_FOR_SOW",
                whatWeKnow: "Manual reporting is slow.",
                openQuestions: "Who signs off?",
                businessValue: "Reduce analyst hours.",
                nextSteps: "Draft SOW.",
                opportunityId: "opp-1",
              },
            ],
          },
        }),
      );

    const result = await twentyEngagementDashboard(null, {} as never, CTX);

    expect(callTool).toHaveBeenCalledWith(
      {
        url: "https://crm.example.test/mcp",
        name: "twenty--crm",
        token: "user-token",
      },
      "execute_tool",
      {
        toolName: "find_many_companies",
        arguments: { limit: 50, select: ["id", "name", "domainName"] },
      },
    );
    expect(result.accounts).toEqual([
      {
        company: {
          id: "company-1",
          name: "Acme Corp",
          domainName: "acme.test",
          crmUrl: "/objects/companies/company-1",
        },
        opportunities: [
          {
            opportunity: expect.objectContaining({
              id: "opp-1",
              stage: "VALUE_ALIGNMENT",
              stageLabel: "Value Alignment",
              amountMicros: 250000000,
              companyName: "Acme Corp",
            }),
            layers: [
              expect.objectContaining({
                id: "layer-1",
                layerTypeLabel: "Core Problem",
                layerStatusLabel: "Ready for SOW",
              }),
            ],
          },
        ],
      },
    ]);
  });

  it("unwraps Twenty MCP data containers instead of treating wrapper objects as records", async () => {
    callTool
      .mockResolvedValueOnce(
        mcpJson({
          result: {
            data: {
              companies: [
                {
                  id: "company-1",
                  name: "Acme Corp",
                  domainName: "acme.test",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        mcpJson({
          data: {
            findManyOpportunities: [
              {
                id: "opp-1",
                name: "Board-ready demo",
                stage: "VALUE_ALIGNMENT",
                companyId: "company-1",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        mcpJson({
          result: {
            find_many_opportunity_layers: [
              {
                id: "layer-1",
                layerType: "CORE_PROBLEM",
                layerStatus: "IN_DISCOVERY",
                opportunityId: "opp-1",
              },
            ],
          },
        }),
      );

    const result = await twentyEngagementDashboard(null, {} as never, CTX);

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]?.company).toMatchObject({
      id: "company-1",
      name: "Acme Corp",
    });
    expect(result.accounts[0]?.opportunities[0]?.opportunity).toMatchObject({
      id: "opp-1",
      companyName: "Acme Corp",
    });
    expect(result.accounts[0]?.opportunities[0]?.layers[0]).toMatchObject({
      id: "layer-1",
      layerStatusLabel: "In Discovery",
    });
  });

  it("ignores non-record wrapper payloads instead of failing the dashboard", async () => {
    callTool
      .mockResolvedValueOnce(mcpJson({ data: { status: "ok" } }))
      .mockResolvedValueOnce(mcpJson({ result: { records: [] } }))
      .mockResolvedValueOnce(mcpJson({ result: { records: [] } }));

    const result = await twentyEngagementDashboard(null, {} as never, CTX);

    expect(result).toMatchObject({
      accounts: [],
      companies: [],
      opportunities: [],
      opportunityLayers: [],
    });
  });

  it("requires the Twenty plugin install", async () => {
    store.findInstall.mockResolvedValue(null);

    await expect(
      twentyEngagementDashboard(null, {} as never, CTX),
    ).rejects.toMatchObject({
      extensions: { code: "PLUGIN_INSTALL_REQUIRED", pluginKey: "twenty" },
    });
  });

  it("requires the provisioned CRM MCP component", async () => {
    store.findCrmComponent.mockResolvedValue(null);

    await expect(
      twentyEngagementDashboard(null, {} as never, CTX),
    ).rejects.toMatchObject({
      extensions: { code: "PLUGIN_COMPONENT_REQUIRED", pluginKey: "twenty" },
    });
  });

  it("requires the current user's Twenty activation", async () => {
    vi.mocked(authResolver.resolveToken).mockResolvedValue(null);

    await expect(
      twentyEngagementDashboard(null, {} as never, CTX),
    ).rejects.toMatchObject({
      extensions: {
        code: "PLUGIN_ACTIVATION_REQUIRED",
        pluginKey: "twenty",
        pluginInstallId: "install-1",
      },
    });
  });

  it("maps downstream MCP failures to a safe dashboard load error", async () => {
    callTool.mockResolvedValue(
      mcpJson({ message: "forbidden secret detail" }, true),
    );

    await expect(
      twentyEngagementDashboard(null, {} as never, CTX),
    ).rejects.toMatchObject({
      message: "Could not load Twenty engagement data",
      extensions: {
        code: "TWENTY_ENGAGEMENT_DATA_LOAD_FAILED",
        causeCode: "TWENTY_CRM_TOOL_FAILED",
      },
    });
  });

  it("updates opportunity stage through the Twenty update tool", async () => {
    callTool.mockResolvedValue(
      mcpJson({
        result: {
          record: {
            id: "opp-1",
            name: "Board-ready demo",
            stage: "DISCOVERY_SCOPE",
            companyId: "company-1",
          },
        },
      }),
    );

    const result = await updateTwentyEngagementOpportunityStage(
      null,
      { input: { opportunityId: "opp-1", stage: "DISCOVERY_SCOPE" } },
      CTX,
    );

    expect(callTool).toHaveBeenCalledWith(expect.any(Object), "execute_tool", {
      toolName: "updateOpportunity",
      arguments: { id: "opp-1", stage: "DISCOVERY_SCOPE" },
    });
    expect(result).toMatchObject({
      id: "opp-1",
      stage: "DISCOVERY_SCOPE",
      stageLabel: "Discovery & Scope",
    });
  });

  it("updates layer status and refreshes the layer record when the update response is sparse", async () => {
    callTool
      .mockResolvedValueOnce(mcpJson({ result: { record: { id: "layer-1" } } }))
      .mockResolvedValueOnce(
        mcpJson({
          result: {
            records: [
              {
                id: "layer-1",
                layerType: "OPTIMIZATION",
                layerStatus: "APPROVED",
                opportunityId: "opp-1",
              },
            ],
          },
        }),
      );

    const result = await updateTwentyEngagementOpportunityLayerStatus(
      null,
      { input: { layerId: "layer-1", layerStatus: "APPROVED" } },
      CTX,
    );

    expect(callTool).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      "execute_tool",
      {
        toolName: "update_one_opportunity_layer",
        arguments: { id: "layer-1", layerStatus: "APPROVED" },
      },
    );
    expect(callTool).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      "execute_tool",
      {
        toolName: "find_many_opportunity_layers",
        arguments: {
          limit: 100,
          select: [
            "id",
            "name",
            "layerType",
            "instanceName",
            "layerStatus",
            "whatWeKnow",
            "openQuestions",
            "businessValue",
            "nextSteps",
            "opportunityId",
          ],
        },
      },
    );
    expect(result).toMatchObject({
      id: "layer-1",
      layerTypeLabel: "Optimization Opportunity",
      layerStatusLabel: "Approved",
      opportunityId: "opp-1",
    });
  });
});

function mcpJson(payload: unknown, isError = false): McpCallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
    raw: {},
  };
}
