export interface SpaceSummary {
  id: string;
  slug?: string | null;
  name: string;
  description?: string | null;
  kind?: string | null;
  templateKey?: string | null;
  status?: string | null;
  updatedAt?: string | null;
}

export interface SpaceThreadSummary {
  id: string;
  number?: number | null;
  identifier?: string | null;
  title?: string | null;
  status?: string | null;
  channel?: string | null;
  spaceId?: string | null;
  metadata?: unknown;
  lastActivityAt?: string | null;
  lastTurnCompletedAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LinkedTaskSummary {
  id: string;
  title: string;
  required?: boolean | null;
  roleKey?: string | null;
  assigneeDisplay?: string | null;
  externalTaskId?: string | null;
  externalTaskUrl?: string | null;
  status?: string | null;
  blocked?: boolean | null;
  syncStatus?: string | null;
  lastSyncedAt?: string | null;
  updatedAt?: string | null;
}

export interface OnboardingSourceContext {
  opportunityId?: string | null;
  opportunityUrl?: string | null;
  customerName?: string | null;
  companyName?: string | null;
  salesRep?: string | null;
  dealValue?: string | null;
  productPlan?: string | null;
  closeDate?: string | null;
  missingFields?: string[];
}

export function parseSpaceRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function sourceContextFromThreadMetadata(
  metadata: unknown,
): OnboardingSourceContext {
  const root = parseSpaceRecord(metadata);
  const onboarding = parseSpaceRecord(root.customerOnboarding);
  const facts = parseSpaceRecord(onboarding.facts);
  const salesRep = parseSpaceRecord(facts.salesRep);
  return {
    opportunityId: stringValue(onboarding.opportunityId ?? facts.opportunityId),
    opportunityUrl: stringValue(facts.opportunityUrl),
    customerName: stringValue(onboarding.customerName ?? facts.customerName),
    companyName: stringValue(onboarding.companyName ?? facts.companyName),
    salesRep:
      stringValue(salesRep.name) ??
      stringValue(salesRep.email) ??
      stringValue(facts.salesRep),
    dealValue: stringValue(facts.dealValue),
    productPlan: stringValue(facts.productPlan),
    closeDate: stringValue(facts.closeDate),
    missingFields: stringArray(onboarding.missingFields ?? facts.missingFields),
  };
}

export function formatSpaceDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatSpaceLabel(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
