import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { authenticate } from "../lib/cognito-auth.js";
import {
  error,
  forbidden,
  handleCors,
  json,
  notFound,
  unauthorized,
} from "../lib/response.js";
import {
  HttpError,
  TwentyRestClient,
  recordOrNull,
  resolveTwentyContext,
  stringValue,
} from "../lib/twenty/rest-client.js";

const { users } = schema;

const LOG_PREFIX = "[twenty-client-engagement]";
const API_BASE_PATH = "/api/plugin-apps/twenty/client-engagement";

type EngagementCompany = {
  id: string;
  name: string;
  domainName: string | null;
  crmUrl: string | null;
};

type EngagementOpportunity = {
  id: string;
  name: string;
  stage: string;
  stageLabel: string;
  amountMicros: number | null;
  closeDate: string | null;
  companyId: string | null;
  companyName: string | null;
  crmUrl: string | null;
};

type EngagementLayer = {
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
};

type EngagementStakeholder = {
  id: string;
  companyId: string;
  name: string;
  title: string | null;
  department: string | null;
  role: string | null;
  email: string | null;
  crmUrl: string | null;
};

type EngagementOpportunityWithLayers = {
  opportunity: EngagementOpportunity;
  layers: EngagementLayer[];
};

type EngagementAccount = {
  company: EngagementCompany;
  opportunities: EngagementOpportunityWithLayers[];
  stakeholders: EngagementStakeholder[];
};

type TwentyContext = {
  baseUrl: string;
  client: TwentyRestClient;
};

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

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Authentication required");
  }

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.email, auth.email.toLowerCase()))
    .limit(1);
  if (!userRow?.tenant_id) return forbidden("No tenant resolved for caller");

  const resolved = await resolveTwentyContext(db, {
    tenantId: userRow.tenant_id,
    userId: userRow.id,
    logPrefix: LOG_PREFIX,
  });
  if (!resolved) {
    return notFound("Twenty CRM plugin is not installed for this tenant");
  }
  const context: TwentyContext = {
    baseUrl: resolved.baseUrl,
    client: new TwentyRestClient(resolved.baseUrl, resolved.token),
  };

  const method = event.requestContext.http.method.toUpperCase();
  const subpath = normalizedSubpath(event);

  try {
    if (method === "GET" && subpath === "") {
      return json(await loadDashboard(context));
    }

    if (method === "PATCH" && subpath.startsWith("/opportunities/")) {
      const id = decodeURIComponent(subpath.slice("/opportunities/".length));
      const body = parseJsonBody(event.body);
      const stage = stringValue(body.stage);
      if (!stage) return error("stage is required", 400);
      const record = await context.client.patch(`opportunities/${id}`, {
        stage,
      });
      return json(
        toOpportunity(recordOrNull(record) ?? { id, stage }, context.baseUrl),
      );
    }

    if (method === "PATCH" && subpath.startsWith("/layers/")) {
      const id = decodeURIComponent(subpath.slice("/layers/".length));
      const body = parseJsonBody(event.body);
      const layerStatus = stringValue(body.layerStatus);
      if (!layerStatus) return error("layerStatus is required", 400);
      const record = await context.client.patch(`opportunityLayers/${id}`, {
        layerStatus,
      });
      return json(
        toLayer(recordOrNull(record) ?? { id, layerStatus }, context.baseUrl),
      );
    }

    if (method === "POST" && subpath === "/stakeholders") {
      const body = parseJsonBody(event.body);
      const payload = stakeholderPayload(body);
      const record = await context.client.post("people", payload);
      const responseRecord = recordOrNull(record) ?? {};
      return json(
        toStakeholder(
          {
            ...payload,
            ...responseRecord,
            companyId:
              relationId(responseRecord, "companyId", "company") ??
              payload.companyId,
          },
          context.baseUrl,
        ),
        201,
      );
    }

    if (method === "PATCH" && subpath.startsWith("/stakeholders/")) {
      const id = decodeURIComponent(subpath.slice("/stakeholders/".length));
      const body = parseJsonBody(event.body);
      const payload = stakeholderPayload({ ...body, id }, { partial: true });
      const record = await context.client.patch(`people/${id}`, payload);
      const responseRecord = recordOrNull(record) ?? {};
      return json(
        toStakeholder(
          {
            ...payload,
            ...responseRecord,
            id,
            companyId:
              relationId(responseRecord, "companyId", "company") ??
              stringValue(body.companyId) ??
              "",
          },
          context.baseUrl,
        ),
      );
    }

    return notFound("Unknown Client Engagement route");
  } catch (err) {
    if (err instanceof HttpError) return error(err.message, err.status);
    if (err instanceof SyntaxError) return error("Invalid JSON body", 400);
    console.error(`${LOG_PREFIX} request failed`, err);
    return error("Could not load Twenty engagement data", 502);
  }
}

async function loadDashboard(context: TwentyContext): Promise<{
  accounts: EngagementAccount[];
}> {
  const [companiesRaw, opportunitiesRaw, layersRaw, stakeholdersRaw] =
    await Promise.all([
      context.client.list("companies", ["companies"], { depth: 1 }),
      context.client.list("opportunities", ["opportunities"]),
      context.client
        .list("opportunityLayers", ["opportunityLayers", "opportunity_layers"])
        .catch((err) => {
          if (err instanceof HttpError && err.status === 404) return [];
          throw err;
        }),
      context.client.list("people", ["people", "persons"]),
    ]);

  return {
    accounts: buildAccounts(
      {
        companies: mapValidRecords(companiesRaw, (record) =>
          toCompany(record, context.baseUrl),
        ),
        opportunities: mapValidRecords(opportunitiesRaw, (record) =>
          toOpportunity(record, context.baseUrl),
        ),
        opportunityLayers: mapValidRecords(layersRaw, (record) =>
          toLayer(record, context.baseUrl),
        ),
        stakeholders: mapValidRecords(stakeholdersRaw, (record) =>
          toStakeholder(record, context.baseUrl),
        ),
      },
      context.baseUrl,
    ),
  };
}

function buildAccounts(
  input: {
    companies: EngagementCompany[];
    opportunities: EngagementOpportunity[];
    opportunityLayers: EngagementLayer[];
    stakeholders: EngagementStakeholder[];
  },
  baseUrl: string,
): EngagementAccount[] {
  const companiesById = new Map(
    input.companies.map((company) => [company.id, company]),
  );
  const layersByOpportunityId = new Map<string, EngagementLayer[]>();
  for (const layer of input.opportunityLayers) {
    if (!layer.opportunityId) continue;
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
    EngagementOpportunityWithLayers[]
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

  const stakeholdersByCompanyId = new Map<string, EngagementStakeholder[]>();
  for (const stakeholder of input.stakeholders) {
    if (!stakeholder.companyId) continue;
    const grouped = stakeholdersByCompanyId.get(stakeholder.companyId) ?? [];
    grouped.push(stakeholder);
    stakeholdersByCompanyId.set(stakeholder.companyId, grouped);
  }
  for (const stakeholders of stakeholdersByCompanyId.values()) {
    stakeholders.sort((a, b) => a.name.localeCompare(b.name));
  }

  const accountCompanyIds = new Set([
    ...input.companies.map((company) => company.id),
    ...opportunitiesByCompanyId.keys(),
    ...stakeholdersByCompanyId.keys(),
  ]);

  return [...accountCompanyIds]
    .map((companyId) => ({
      company: companiesById.get(companyId) ?? {
        id: companyId,
        name: "Unknown",
        domainName: null,
        crmUrl: crmRecordUrl(baseUrl, "companies", companyId),
      },
      opportunities: opportunitiesByCompanyId.get(companyId) ?? [],
      stakeholders: stakeholdersByCompanyId.get(companyId) ?? [],
    }))
    .filter((account) => account.company.name.length > 0)
    .sort((a, b) => a.company.name.localeCompare(b.company.name));
}

function toCompany(
  record: Record<string, unknown>,
  baseUrl: string,
): EngagementCompany {
  const id = requiredRecordId(record, "company");
  const rawName = nameString(record.name);
  const domainName = companyDomainName(record, rawName);
  return {
    id,
    name: companyDisplayName(record, rawName, domainName),
    domainName,
    crmUrl: crmRecordUrl(baseUrl, "companies", id),
  };
}

function toOpportunity(
  record: Record<string, unknown>,
  baseUrl: string,
): EngagementOpportunity {
  const id = requiredRecordId(record, "opportunity");
  const stage = stringValue(record.stage) ?? "IDENTIFIED";
  const companyId = relationId(record, "companyId", "company");
  return {
    id,
    name: nameString(record.name) ?? "Unnamed opportunity",
    stage,
    stageLabel: labelFor(stage, STAGE_LABELS),
    amountMicros: amountMicros(record.amount),
    closeDate: stringValue(record.closeDate),
    companyId,
    companyName: stringValue(record.companyName) ?? nameString(record.company),
    crmUrl: crmRecordUrl(baseUrl, "opportunities", id),
  };
}

function toLayer(
  record: Record<string, unknown>,
  baseUrl: string,
): EngagementLayer {
  const id = requiredRecordId(record, "opportunity layer");
  const layerType = stringValue(record.layerType) ?? "CORE_PROBLEM";
  const layerStatus = stringValue(record.layerStatus) ?? "IDENTIFIED";
  return {
    id,
    name: nameString(record.name),
    layerType,
    layerTypeLabel: labelFor(layerType, LAYER_TYPE_LABELS),
    instanceName: stringValue(record.instanceName),
    layerStatus,
    layerStatusLabel: labelFor(layerStatus, LAYER_STATUS_LABELS),
    whatWeKnow: stringValue(record.whatWeKnow),
    openQuestions: stringValue(record.openQuestions),
    businessValue: stringValue(record.businessValue),
    nextSteps: stringValue(record.nextSteps),
    opportunityId: relationId(record, "opportunityId", "opportunity") ?? "",
  };
}

function toStakeholder(
  record: Record<string, unknown>,
  baseUrl: string,
): EngagementStakeholder {
  const id = requiredRecordId(record, "stakeholder");
  const firstName = stringValue(record.firstName);
  const lastName = stringValue(record.lastName);
  const composedName = [firstName, lastName].filter(Boolean).join(" ");
  return {
    id,
    companyId: relationId(record, "companyId", "company") ?? "",
    name: nameString(record.name) ?? (composedName || "Unnamed stakeholder"),
    title: stringValue(record.title) ?? stringValue(record.jobTitle),
    department: stringValue(record.department),
    role: stringValue(record.role),
    email:
      emailString(record.email) ??
      emailString(record.primaryEmail) ??
      emailString(record.emails),
    crmUrl: crmRecordUrl(baseUrl, "people", id),
  };
}

function stakeholderPayload(
  body: Record<string, unknown>,
  options: { partial?: boolean } = {},
): Record<string, unknown> {
  const name = stringValue(body.name);
  const companyId = stringValue(body.companyId);
  if (!options.partial && !name) throw new HttpError("name is required", 400);
  if (!options.partial && !companyId) {
    throw new HttpError("companyId is required", 400);
  }
  return pruneUndefined({
    name: name ?? undefined,
    companyId: companyId ?? undefined,
    title: stringValue(body.title) ?? undefined,
    jobTitle: stringValue(body.title) ?? undefined,
    department: stringValue(body.department) ?? undefined,
    role: stringValue(body.role) ?? undefined,
    email: stringValue(body.email) ?? undefined,
  });
}

function mapValidRecords<T>(
  records: Record<string, unknown>[],
  mapRecord: (record: Record<string, unknown>) => T,
): T[] {
  const mapped: T[] = [];
  for (const record of records) {
    try {
      mapped.push(mapRecord(record));
    } catch {
      continue;
    }
  }
  return mapped;
}

function compareOpportunities(
  a: EngagementOpportunity,
  b: EngagementOpportunity,
) {
  const stageA = STAGE_SORT[a.stage] ?? STAGE_SORT.IDENTIFIED;
  const stageB = STAGE_SORT[b.stage] ?? STAGE_SORT.IDENTIFIED;
  if (stageA !== stageB) return stageA - stageB;
  const closeA = a.closeDate
    ? Date.parse(a.closeDate)
    : Number.POSITIVE_INFINITY;
  const closeB = b.closeDate
    ? Date.parse(b.closeDate)
    : Number.POSITIVE_INFINITY;
  if (closeA !== closeB) return closeA - closeB;
  return a.name.localeCompare(b.name);
}

function compareLayers(a: EngagementLayer, b: EngagementLayer) {
  const typeA = LAYER_TYPE_SORT[a.layerType] ?? LAYER_TYPE_SORT.CORE_PROBLEM;
  const typeB = LAYER_TYPE_SORT[b.layerType] ?? LAYER_TYPE_SORT.CORE_PROBLEM;
  if (typeA !== typeB) return typeA - typeB;
  return (a.name ?? "").localeCompare(b.name ?? "");
}

function normalizedSubpath(event: APIGatewayProxyEventV2): string {
  const rawPath = event.rawPath ?? event.requestContext.http.path ?? "";
  const baseIndex = rawPath.indexOf(API_BASE_PATH);
  if (baseIndex < 0) return "";
  return rawPath.slice(baseIndex + API_BASE_PATH.length).replace(/\/+$/, "");
}

function crmRecordUrl(baseUrl: string, pluralObjectName: string, id: string) {
  return `${baseUrl}/objects/${pluralObjectName}/${encodeURIComponent(id)}`;
}

function amountMicros(value: unknown): number | null {
  if (typeof value === "number") return value;
  const amount = recordOrNull(value);
  return (
    numberValue(amount?.amountMicros) ??
    numberValue(amount?.amountInMicros) ??
    numberValue(amount?.amount)
  );
}

function companyDisplayName(
  record: Record<string, unknown>,
  rawName: string | null,
  domainName: string | null,
): string {
  return (
    stringValue(record.accountName) ??
    stringValue(record.companyName) ??
    stringValue(record.displayName) ??
    linkLabelString(record.name) ??
    (!looksLikeDomain(rawName) ? rawName : null) ??
    titleFromDomain(domainName) ??
    "Unnamed company"
  );
}

function companyDomainName(
  record: Record<string, unknown>,
  rawName: string | null,
): string | null {
  return cleanDomain(
    stringValue(record.domainName) ??
      stringValue(record.domain) ??
      stringValue(record.website) ??
      linkUrlString(record.name) ??
      (looksLikeDomain(rawName) ? rawName : null),
  );
}

function linkLabelString(value: unknown): string | null {
  const record = recordOrNull(value);
  return (
    stringValue(record?.primaryLinkLabel) ??
    stringValue(record?.label) ??
    stringValue(record?.text) ??
    stringValue(record?.displayName)
  );
}

function linkUrlString(value: unknown): string | null {
  const record = recordOrNull(value);
  return (
    stringValue(record?.primaryLinkUrl) ??
    stringValue(record?.url) ??
    stringValue(record?.href) ??
    stringValue(record?.value)
  );
}

function looksLikeDomain(value: string | null): value is string {
  const clean = cleanDomain(value);
  if (!clean) return false;
  return !/\s/.test(clean) && clean.includes(".");
}

function cleanDomain(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const emailDomain = trimmed.includes("@") ? trimmed.split("@").pop() : null;
  const candidate = emailDomain || trimmed;
  try {
    const parsed = new URL(
      candidate.startsWith("http://") || candidate.startsWith("https://")
        ? candidate
        : `https://${candidate}`,
    );
    return parsed.hostname.replace(/^www\./, "") || null;
  } catch {
    return candidate.replace(/^www\./, "").replace(/\/+$/, "") || null;
  }
}

function titleFromDomain(value: string | null): string | null {
  const domain = cleanDomain(value);
  if (!domain) return null;
  const label = domain.split(".")[0];
  if (!label) return null;
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function labelFor(value: string, labels: Record<string, string>): string {
  return labels[value] ?? titleCase(value);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function requiredRecordId(
  record: Record<string, unknown>,
  label: string,
): string {
  const id =
    entityId(record.id) ??
    entityId(record.recordId) ??
    entityId(record.objectId);
  if (!id) throw new Error(`Twenty ${label} record is missing an id`);
  return id;
}

function relationId(
  record: Record<string, unknown>,
  idKey: string,
  relationKey: string,
): string | null {
  return (
    entityId(record[idKey]) ??
    entityId(record[relationKey]) ??
    entityId(record[`${relationKey}Id`])
  );
}

function entityId(value: unknown): string | null {
  const direct = stringValue(value);
  if (direct) return direct;
  const record = recordOrNull(value);
  return (
    stringValue(record?.id) ??
    stringValue(record?.recordId) ??
    stringValue(record?.objectId) ??
    stringValue(record?.value)
  );
}

function nameString(value: unknown): string | null {
  const direct = stringValue(value);
  if (direct) return direct;
  const record = recordOrNull(value);
  if (!record) return null;
  const composed = [stringValue(record.firstName), stringValue(record.lastName)]
    .filter(Boolean)
    .join(" ");
  return (
    stringValue(record.fullName) ??
    stringValue(record.primaryLinkLabel) ??
    stringValue(record.name) ??
    stringValue(record.firstLastName) ??
    (composed || null)
  );
}

function emailString(value: unknown): string | null {
  const direct = stringValue(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const email = emailString(item);
      if (email) return email;
    }
    return null;
  }
  const record = recordOrNull(value);
  return (
    stringValue(record?.primaryEmail) ??
    stringValue(record?.email) ??
    stringValue(record?.address) ??
    stringValue(record?.value)
  );
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJsonBody(body: string | undefined): Record<string, unknown> {
  const parsed = JSON.parse(body || "{}");
  const record = recordOrNull(parsed);
  if (!record) throw new SyntaxError("Expected object JSON body");
  return record;
}

function pruneUndefined(
  value: Record<string, unknown | undefined>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}
