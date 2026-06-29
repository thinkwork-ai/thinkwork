import { GraphQLError } from "graphql";
import { and, eq, inArray } from "drizzle-orm";
import {
  pluginComponents,
  pluginInstalls,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";

import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requirePluginTenantMember } from "../plugins/shared.js";
import {
  mcpCallTool,
  textFromMcpContent,
  type McpCallToolResult,
  type McpServerTarget,
} from "../../../lib/mcp-client-call.js";
import {
  createPluginDispatchAuthResolver,
  type PluginDispatchAuthResolver,
} from "../../../lib/plugins/activation.js";

const PLUGIN_KEY = "twenty";
const CRM_COMPONENT_KEY = "crm";
const CRM_SERVER_SLUG = "twenty--crm";
const LOG_PREFIX = "[twenty-engagement]";

const COMPANY_SELECT = ["id", "name", "domainName"];
const OPPORTUNITY_SELECT = [
  "id",
  "name",
  "stage",
  "amount",
  "closeDate",
  "companyId",
];
const LAYER_SELECT = [
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
];

const STAGE_LABELS: Record<string, string> = {
  IDENTIFIED: "Identified",
  VALUE_ALIGNMENT: "Value Alignment",
  DISCOVERY_SCOPE: "Discovery & Scope",
  SOW_DELIVERED: "SOW Delivered",
  ACTIVE_ENGAGEMENT: "Active Engagement",
  CLOSED_LOST: "Closed Lost",
  DEFERRED: "Deferred",
};

const STAGE_SORT: Record<string, number> = {
  ACTIVE_ENGAGEMENT: 0,
  SOW_DELIVERED: 1,
  DISCOVERY_SCOPE: 2,
  VALUE_ALIGNMENT: 3,
  IDENTIFIED: 4,
  DEFERRED: 5,
  CLOSED_LOST: 6,
};

const LAYER_TYPE_LABELS: Record<string, string> = {
  CORE_PROBLEM: "Core Problem",
  OPTIMIZATION: "Optimization Opportunity",
  STRATEGIC_CONTROL: "Strategic Control",
};

const LAYER_TYPE_SORT: Record<string, number> = {
  CORE_PROBLEM: 0,
  OPTIMIZATION: 1,
  STRATEGIC_CONTROL: 2,
};

const LAYER_STATUS_LABELS: Record<string, string> = {
  IDENTIFIED: "Identified",
  IN_DISCOVERY: "In Discovery",
  QUALIFYING: "Qualifying",
  READY_FOR_SOW: "Ready for SOW",
  APPROVED: "Approved",
  DEFERRED: "Deferred",
};

interface TenantCaller {
  tenantId: string;
  callerUserId: string | null;
}

interface InstallRow {
  id: string;
}

interface ComponentRow {
  id: string;
}

interface ServerRow {
  id: string;
  name: string;
  slug: string | null;
  url: string;
  transport: string | null;
  auth_type: string | null;
  auth_config: unknown;
  status: string;
  enabled: boolean;
}

interface TwentyEngagementStore {
  findInstall(tenantId: string): Promise<InstallRow | null>;
  findCrmComponent(pluginInstallId: string): Promise<ComponentRow | null>;
  findCrmServer(
    tenantId: string,
    pluginInstallId: string,
  ): Promise<ServerRow | null>;
}

interface TwentyEngagementDeps {
  resolveTenantCaller(ctx: GraphQLContext): Promise<TenantCaller>;
  store: TwentyEngagementStore;
  createAuthResolver(): PluginDispatchAuthResolver;
  callTool(
    target: McpServerTarget,
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpCallToolResult>;
}

const defaultStore: TwentyEngagementStore = {
  async findInstall(tenantId) {
    const [install] = await db
      .select({ id: pluginInstalls.id })
      .from(pluginInstalls)
      .where(
        and(
          eq(pluginInstalls.tenant_id, tenantId),
          eq(pluginInstalls.plugin_key, PLUGIN_KEY),
          inArray(pluginInstalls.state, ["installed", "partially_installed"]),
        ),
      )
      .limit(1);
    return install ?? null;
  },

  async findCrmComponent(pluginInstallId) {
    const [component] = await db
      .select({ id: pluginComponents.id })
      .from(pluginComponents)
      .where(
        and(
          eq(pluginComponents.plugin_install_id, pluginInstallId),
          eq(pluginComponents.component_key, CRM_COMPONENT_KEY),
          eq(pluginComponents.component_type, "mcp-server"),
          eq(pluginComponents.state, "provisioned"),
        ),
      )
      .limit(1);
    return component ?? null;
  },

  async findCrmServer(tenantId, pluginInstallId) {
    const [server] = await db
      .select({
        id: tenantMcpServers.id,
        name: tenantMcpServers.name,
        slug: tenantMcpServers.slug,
        url: tenantMcpServers.url,
        transport: tenantMcpServers.transport,
        auth_type: tenantMcpServers.auth_type,
        auth_config: tenantMcpServers.auth_config,
        status: tenantMcpServers.status,
        enabled: tenantMcpServers.enabled,
      })
      .from(tenantMcpServers)
      .where(
        and(
          eq(tenantMcpServers.tenant_id, tenantId),
          eq(tenantMcpServers.plugin_install_id, pluginInstallId),
          eq(tenantMcpServers.slug, CRM_SERVER_SLUG),
        ),
      )
      .limit(1);
    return server ?? null;
  },
};

const defaultDeps: TwentyEngagementDeps = {
  async resolveTenantCaller(ctx) {
    return requirePluginTenantMember(ctx);
  },
  store: defaultStore,
  createAuthResolver: () => createPluginDispatchAuthResolver(),
  callTool: (target, name, args) => mcpCallTool(target, name, args),
};

let deps: TwentyEngagementDeps = defaultDeps;

export function __setTwentyEngagementDepsForTests(
  overrides: Partial<TwentyEngagementDeps>,
) {
  deps = { ...defaultDeps, ...overrides };
  return () => {
    deps = defaultDeps;
  };
}

export async function twentyEngagementDashboard(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
): Promise<TwentyEngagementDashboardPayload> {
  const target = await resolveTargetForContext(ctx);
  try {
    const [companies, opportunities, opportunityLayers] = await Promise.all([
      callTwentyTool(target, "find_many_companies", {
        limit: 50,
        select: COMPANY_SELECT,
      }),
      callTwentyTool(target, "find_many_opportunities", {
        limit: 50,
        select: OPPORTUNITY_SELECT,
      }),
      callTwentyTool(target, "find_many_opportunity_layers", {
        limit: 100,
        select: LAYER_SELECT,
      }),
    ]);
    return buildDashboardPayload({
      companies: recordsFromToolPayload(companies, [
        "companies",
        "findManyCompanies",
        "find_many_companies",
      ]).map(toCompany),
      opportunities: recordsFromToolPayload(opportunities, [
        "opportunities",
        "findManyOpportunities",
        "find_many_opportunities",
      ]).map(toOpportunity),
      opportunityLayers: recordsFromToolPayload(opportunityLayers, [
        "opportunityLayers",
        "opportunity_layers",
        "findManyOpportunityLayers",
        "find_many_opportunity_layers",
      ]).map(toLayer),
    });
  } catch (error) {
    throw safeToolError(error, {
      message: "Could not load Twenty engagement data",
      code: "TWENTY_ENGAGEMENT_DATA_LOAD_FAILED",
    });
  }
}

export async function updateTwentyEngagementOpportunityStage(
  _parent: unknown,
  args: {
    input: {
      opportunityId: string;
      stage: string;
    };
  },
  ctx: GraphQLContext,
): Promise<TwentyEngagementOpportunityPayload> {
  const target = await resolveTargetForContext(ctx);
  try {
    const payload = await callTwentyTool(target, "updateOpportunity", {
      id: args.input.opportunityId,
      stage: args.input.stage,
    });
    const record = firstRecordFromToolPayload(payload) ?? {
      id: args.input.opportunityId,
      stage: args.input.stage,
    };
    return toOpportunity(record);
  } catch (error) {
    throw safeToolError(error, {
      message: "Could not update Twenty opportunity stage",
      code: "TWENTY_ENGAGEMENT_UPDATE_FAILED",
    });
  }
}

export async function updateTwentyEngagementOpportunityLayerStatus(
  _parent: unknown,
  args: {
    input: {
      layerId: string;
      layerStatus: string;
    };
  },
  ctx: GraphQLContext,
): Promise<TwentyEngagementOpportunityLayerPayload> {
  const target = await resolveTargetForContext(ctx);
  try {
    const updatePayload = await callTwentyTool(
      target,
      "update_one_opportunity_layer",
      {
        id: args.input.layerId,
        layerStatus: args.input.layerStatus,
      },
    );
    let record = firstRecordFromToolPayload(updatePayload);
    if (!record?.opportunityId) {
      const layersPayload = await callTwentyTool(
        target,
        "find_many_opportunity_layers",
        {
          limit: 100,
          select: LAYER_SELECT,
        },
      );
      record =
        recordsFromToolPayload(layersPayload, [
          "opportunityLayers",
          "opportunity_layers",
          "findManyOpportunityLayers",
          "find_many_opportunity_layers",
        ]).find(
          (layer) => layer.id === args.input.layerId,
        ) ?? record;
    }
    if (!record) {
      throw new GraphQLError("Twenty opportunity layer record was not found", {
        extensions: { code: "TWENTY_CRM_RECORD_INVALID" },
      });
    }
    return toLayer(record);
  } catch (error) {
    throw safeToolError(error, {
      message: "Could not update Twenty opportunity layer status",
      code: "TWENTY_ENGAGEMENT_UPDATE_FAILED",
    });
  }
}

async function resolveTargetForContext(
  ctx: GraphQLContext,
): Promise<McpServerTarget> {
  const { tenantId, callerUserId } = await deps.resolveTenantCaller(ctx);
  if (!callerUserId) {
    throw new GraphQLError("User context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return resolveTwentyEngagementMcpTarget({ tenantId, callerUserId });
}

async function resolveTwentyEngagementMcpTarget(input: {
  tenantId: string;
  callerUserId: string;
}): Promise<McpServerTarget> {
  const install = await deps.store.findInstall(input.tenantId);
  if (!install) {
    throw new GraphQLError("Twenty plugin is not installed", {
      extensions: { code: "PLUGIN_INSTALL_REQUIRED", pluginKey: PLUGIN_KEY },
    });
  }

  const component = await deps.store.findCrmComponent(install.id);
  if (!component) {
    throw new GraphQLError("Twenty CRM MCP component is not provisioned", {
      extensions: { code: "PLUGIN_COMPONENT_REQUIRED", pluginKey: PLUGIN_KEY },
    });
  }

  const server = await deps.store.findCrmServer(input.tenantId, install.id);
  if (!server || !server.enabled || server.status !== "approved") {
    throw new GraphQLError("Twenty CRM MCP server is not available", {
      extensions: {
        code: "PLUGIN_MCP_SERVER_REQUIRED",
        pluginKey: PLUGIN_KEY,
      },
    });
  }

  const target: McpServerTarget = {
    url: server.url,
    name: server.slug ?? server.name,
  };
  const authType = server.auth_type ?? "none";
  if (authType === "none") return target;
  if (authType === "oauth" || authType === "per_user_oauth") {
    const token = await deps.createAuthResolver().resolveToken({
      requesterUserId: input.callerUserId,
      pluginInstallId: install.id,
      resource: server.url,
      slug: server.slug ?? server.name,
      logPrefix: LOG_PREFIX,
    });
    if (!token) {
      throw new GraphQLError("Twenty plugin activation is required", {
        extensions: {
          code: "PLUGIN_ACTIVATION_REQUIRED",
          pluginKey: PLUGIN_KEY,
          pluginInstallId: install.id,
        },
      });
    }
    return { ...target, token };
  }
  if (authType === "user_headers") {
    const headerNames = userHeaderNamesFromAuthConfig(server.auth_config);
    const authResolver = deps.createAuthResolver();
    const headers =
      headerNames.length > 0
        ? await authResolver.resolveHeaders({
            requesterUserId: input.callerUserId,
            pluginInstallId: install.id,
            resource: server.url,
            slug: server.slug ?? server.name,
            headerNames,
            logPrefix: LOG_PREFIX,
          })
        : {};
    const token = userHeaderAuthUsesBearer(server.auth_config)
      ? await authResolver.resolveToken({
          requesterUserId: input.callerUserId,
          pluginInstallId: install.id,
          resource: server.url,
          slug: server.slug ?? server.name,
          logPrefix: LOG_PREFIX,
        })
      : null;
    if ((headerNames.length > 0 && !headers) || (token === null && !headers)) {
      throw new GraphQLError("Twenty plugin activation is required", {
        extensions: {
          code: "PLUGIN_ACTIVATION_REQUIRED",
          pluginKey: PLUGIN_KEY,
          pluginInstallId: install.id,
        },
      });
    }
    return {
      ...target,
      ...(token ? { token } : {}),
      ...(headers ? { headers } : {}),
    };
  }

  throw new GraphQLError("Twenty CRM MCP auth type is not supported", {
    extensions: { code: "PLUGIN_COMPONENT_REQUIRED", pluginKey: PLUGIN_KEY },
  });
}

async function callTwentyTool(
  target: McpServerTarget,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await deps.callTool(target, "execute_tool", {
    toolName,
    arguments: args,
  });
  if (result.isError) {
    throw new GraphQLError("Twenty CRM tool call failed", {
      extensions: { code: "TWENTY_CRM_TOOL_FAILED", toolName },
    });
  }
  const text = textFromMcpContent(result.content);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GraphQLError("Twenty CRM tool returned invalid JSON", {
      extensions: { code: "TWENTY_CRM_TOOL_FAILED", toolName },
    });
  }
}

function buildDashboardPayload(input: {
  companies: TwentyEngagementCompanyPayload[];
  opportunities: TwentyEngagementOpportunityPayload[];
  opportunityLayers: TwentyEngagementOpportunityLayerPayload[];
}): TwentyEngagementDashboardPayload {
  const companiesById = new Map(
    input.companies.map((company) => [company.id, company]),
  );
  const layersByOpportunityId = new Map<
    string,
    TwentyEngagementOpportunityLayerPayload[]
  >();
  for (const layer of input.opportunityLayers) {
    const layers = layersByOpportunityId.get(layer.opportunityId) ?? [];
    layers.push(layer);
    layersByOpportunityId.set(layer.opportunityId, layers);
  }
  for (const layers of layersByOpportunityId.values()) {
    layers.sort(compareLayers);
  }

  const opportunities = input.opportunities
    .map((opportunity) => ({
      ...opportunity,
      companyName:
        opportunity.companyName ??
        (opportunity.companyId
          ? companiesById.get(opportunity.companyId)?.name
          : null) ??
        null,
    }))
    .sort(compareOpportunities);

  const opportunitiesByCompanyId = new Map<
    string,
    TwentyEngagementOpportunityWithLayersPayload[]
  >();
  for (const opportunity of opportunities) {
    if (!opportunity.companyId) continue;
    const grouped = opportunitiesByCompanyId.get(opportunity.companyId) ?? [];
    grouped.push({
      opportunity,
      layers: layersByOpportunityId.get(opportunity.id) ?? [],
    });
    opportunitiesByCompanyId.set(opportunity.companyId, grouped);
  }

  const accounts = [...opportunitiesByCompanyId.entries()]
    .map(([companyId, grouped]) => ({
      company: companiesById.get(companyId) ?? {
        id: companyId,
        name: "Unknown",
        domainName: null,
        crmUrl: companyUrl(companyId),
      },
      opportunities: grouped,
    }))
    .filter((account) => account.company.name.length > 0)
    .sort((a, b) => a.company.name.localeCompare(b.company.name));

  return {
    accounts,
    companies: input.companies.sort((a, b) => a.name.localeCompare(b.name)),
    opportunities,
    opportunityLayers: input.opportunityLayers.sort(compareLayers),
  };
}

function recordsFromToolPayload(
  payload: unknown,
  collectionKeys: string[] = [],
): Record<string, unknown>[] {
  const root = recordOrNull(payload);
  const resultValue = root?.result ?? payload;
  if (Array.isArray(resultValue)) {
    return resultValue.filter(isRecord);
  }
  const result = recordOrNull(resultValue);
  if (!result) return [];

  const records = recordsFromKnownContainers(result, collectionKeys);
  if (records.length > 0) return records;

  // Some MCP tools return a single record object. Avoid treating arbitrary
  // status/error wrapper objects as records; that caused wrapper payloads to
  // fail later as "missing id" records.
  return typeof result.id === "string" ? [result] : [];
}

function firstRecordFromToolPayload(
  payload: unknown,
): Record<string, unknown> | null {
  return recordsFromToolPayload(payload)[0] ?? null;
}

function recordsFromKnownContainers(
  value: Record<string, unknown>,
  collectionKeys: string[],
): Record<string, unknown>[] {
  if (Array.isArray(value.records)) return value.records.filter(isRecord);
  if (Array.isArray(value.items)) return value.items.filter(isRecord);
  if (Array.isArray(value.nodes)) return value.nodes.filter(isRecord);

  const record = recordOrNull(value.record);
  if (record) return [record];

  for (const key of collectionKeys) {
    const direct = value[key];
    if (Array.isArray(direct)) return direct.filter(isRecord);
    const directRecord = recordOrNull(direct);
    if (directRecord) {
      const nested = recordsFromKnownContainers(directRecord, collectionKeys);
      if (nested.length > 0) return nested;
    }
  }

  const data = recordOrNull(value.data);
  if (data) {
    const nested = recordsFromKnownContainers(data, collectionKeys);
    if (nested.length > 0) return nested;
  }

  const result = recordOrNull(value.result);
  if (result) {
    const nested = recordsFromKnownContainers(result, collectionKeys);
    if (nested.length > 0) return nested;
  }

  return [];
}

function toCompany(
  record: Record<string, unknown>,
): TwentyEngagementCompanyPayload {
  const id = requiredString(record.id, "company");
  return {
    id,
    name: optionalString(record.name) ?? "Unnamed company",
    domainName: optionalString(record.domainName),
    crmUrl: companyUrl(id),
  };
}

function toOpportunity(
  record: Record<string, unknown>,
): TwentyEngagementOpportunityPayload {
  const id = requiredString(record.id, "opportunity");
  const stage = optionalString(record.stage) ?? "IDENTIFIED";
  const companyId = optionalString(record.companyId);
  return {
    id,
    name: optionalString(record.name) ?? "Unnamed opportunity",
    stage,
    stageLabel: labelFor(stage, STAGE_LABELS),
    amountMicros: amountMicros(record.amount),
    closeDate: optionalString(record.closeDate),
    companyId,
    companyName: optionalString(record.companyName),
    crmUrl: opportunityUrl(id),
  };
}

function toLayer(
  record: Record<string, unknown>,
): TwentyEngagementOpportunityLayerPayload {
  const id = requiredString(record.id, "opportunity layer");
  const layerType = optionalString(record.layerType) ?? "CORE_PROBLEM";
  const layerStatus = optionalString(record.layerStatus) ?? "IDENTIFIED";
  return {
    id,
    name: optionalString(record.name),
    layerType,
    layerTypeLabel: labelFor(layerType, LAYER_TYPE_LABELS),
    instanceName: optionalString(record.instanceName),
    layerStatus,
    layerStatusLabel: labelFor(layerStatus, LAYER_STATUS_LABELS),
    whatWeKnow: optionalString(record.whatWeKnow),
    openQuestions: optionalString(record.openQuestions),
    businessValue: optionalString(record.businessValue),
    nextSteps: optionalString(record.nextSteps),
    opportunityId: requiredString(record.opportunityId, "opportunity layer"),
  };
}

function compareOpportunities(
  a: TwentyEngagementOpportunityPayload,
  b: TwentyEngagementOpportunityPayload,
) {
  const stageA = STAGE_SORT[a.stage] ?? STAGE_SORT.IDENTIFIED;
  const stageB = STAGE_SORT[b.stage] ?? STAGE_SORT.IDENTIFIED;
  if (stageA !== stageB) return stageA - stageB;
  return a.name.localeCompare(b.name);
}

function compareLayers(
  a: TwentyEngagementOpportunityLayerPayload,
  b: TwentyEngagementOpportunityLayerPayload,
) {
  const typeA = LAYER_TYPE_SORT[a.layerType] ?? 9;
  const typeB = LAYER_TYPE_SORT[b.layerType] ?? 9;
  if (typeA !== typeB) return typeA - typeB;
  return (a.instanceName ?? a.name ?? "").localeCompare(
    b.instanceName ?? b.name ?? "",
  );
}

function labelFor(value: string, labels: Record<string, string>) {
  return (
    labels[value] ??
    value
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function amountMicros(value: unknown): number | null {
  if (typeof value === "number") return value;
  const amount = recordOrNull(value);
  const amountValue = amount?.amountMicros;
  return typeof amountValue === "number" ? amountValue : null;
}

function requiredString(value: unknown, label: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new GraphQLError(`Twenty ${label} record is missing an id`, {
      extensions: { code: "TWENTY_CRM_RECORD_INVALID" },
    });
  }
  return normalized;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function companyUrl(id: string): string {
  return `/objects/companies/${encodeURIComponent(id)}`;
}

function opportunityUrl(id: string): string {
  return `/objects/opportunities/${encodeURIComponent(id)}`;
}

function userHeaderAuthUsesBearer(authConfig: unknown): boolean {
  return typeof recordOrNull(authConfig)?.bearerCredentialKey === "string";
}

function userHeaderNamesFromAuthConfig(authConfig: unknown): string[] {
  const headers = recordOrNull(authConfig)?.headers;
  if (!Array.isArray(headers)) return [];
  return [
    ...new Set(
      headers
        .map((header) => recordOrNull(header)?.name)
        .filter((name): name is string => typeof name === "string" && !!name),
    ),
  ];
}

function safeToolError(
  error: unknown,
  fallback: { message: string; code: string },
): GraphQLError {
  if (error instanceof GraphQLError) {
    const code = error.extensions?.code;
    if (typeof code === "string" && code.startsWith("PLUGIN_")) {
      return error;
    }
    return new GraphQLError(fallback.message, {
      extensions: {
        code: fallback.code,
        causeCode: typeof code === "string" ? code : undefined,
      },
    });
  }
  return new GraphQLError(fallback.message, {
    extensions: { code: fallback.code },
  });
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(recordOrNull(value));
}

interface TwentyEngagementCompanyPayload {
  id: string;
  name: string;
  domainName: string | null;
  crmUrl: string;
}

interface TwentyEngagementOpportunityPayload {
  id: string;
  name: string;
  stage: string;
  stageLabel: string;
  amountMicros: number | null;
  closeDate: string | null;
  companyId: string | null;
  companyName: string | null;
  crmUrl: string;
}

interface TwentyEngagementOpportunityLayerPayload {
  id: string;
  name: string | null;
  layerType: string;
  layerTypeLabel: string;
  instanceName: string | null;
  layerStatus: string;
  layerStatusLabel: string;
  whatWeKnow: string | null;
  openQuestions: string | null;
  businessValue: string | null;
  nextSteps: string | null;
  opportunityId: string;
}

interface TwentyEngagementOpportunityWithLayersPayload {
  opportunity: TwentyEngagementOpportunityPayload;
  layers: TwentyEngagementOpportunityLayerPayload[];
}

interface TwentyEngagementAccountPayload {
  company: TwentyEngagementCompanyPayload;
  opportunities: TwentyEngagementOpportunityWithLayersPayload[];
}

interface TwentyEngagementDashboardPayload {
  accounts: TwentyEngagementAccountPayload[];
  companies: TwentyEngagementCompanyPayload[];
  opportunities: TwentyEngagementOpportunityPayload[];
  opportunityLayers: TwentyEngagementOpportunityLayerPayload[];
}
