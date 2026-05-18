import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { tenants, users, userProfiles } from "@thinkwork/database-pg/schema";
import { loadDefaults } from "@thinkwork/workspace-defaults";
import { db as defaultDb } from "../graphql/utils.js";
import {
  type HumanPlaceholderValues,
  type PlaceholderValues,
  substituteHumans,
  substituteStructured,
  type StructuredPlaceholderValues,
  type SanitizationViolation,
} from "./placeholder-substitution.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

export type DbOrTx = { select: typeof defaultDb.select };

export interface UserContextMdProfile {
  tenantName: string | null;
  userName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  timezone: string | null;
  pronouns: string | null;
  callBy: string | null;
  notes: string | null;
  family: string | null;
  context: string | null;
  operatingModel: unknown;
}

export interface WriteUserContextMdOptions {
  overwrite?: boolean;
  onViolation?: (v: SanitizationViolation) => void;
}

export class UserContextMdWriterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "UserContextMdWriterError";
  }
}

const OPERATING_MODEL_LAYER_PLACEHOLDERS = {
  rhythms: "OPERATING_MODEL_RHYTHMS",
  decisions: "OPERATING_MODEL_DECISIONS",
  dependencies: "OPERATING_MODEL_DEPENDENCIES",
  knowledge: "OPERATING_MODEL_KNOWLEDGE",
} as const;

const EMPTY_OPERATING_MODEL =
  "_Activation hasn't been completed yet; use generic context until the human shares more._";

function bucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}

function userContextKey(tenantId: string, userId: string): string {
  return `tenants/${tenantId}/users/${userId}/USER.md`;
}

export function renderUserContextMd(
  profile: UserContextMdProfile,
  opts: { onViolation?: (v: SanitizationViolation) => void } = {},
): string {
  const template = loadDefaults()["USER.md"];
  const values: PlaceholderValues = {
    AGENT_NAME: "User context",
    TENANT_NAME: profile.tenantName,
  };
  const humanValues: HumanPlaceholderValues = {
    HUMAN_NAME: profile.userName,
    HUMAN_EMAIL: profile.email,
    HUMAN_TITLE: profile.title,
    HUMAN_TIMEZONE: profile.timezone,
    HUMAN_PRONOUNS: profile.pronouns,
    HUMAN_CALL_BY: profile.callBy,
    HUMAN_PHONE: profile.phone,
    HUMAN_NOTES: profile.notes,
    HUMAN_FAMILY: profile.family,
    HUMAN_CONTEXT: profile.context,
  };
  const structuredValues = renderOperatingModelPlaceholders(
    profile.operatingModel,
  );

  const afterStructured = substituteStructured(
    values,
    structuredValues,
    template,
    {
      onViolation: opts.onViolation,
    },
  );
  return substituteHumans(humanValues, afterStructured, {
    onViolation: opts.onViolation,
  });
}

export async function writeUserContextMdForUser(
  tx: DbOrTx,
  tenantId: string,
  userId: string,
  opts: WriteUserContextMdOptions = {},
): Promise<{ key: string; written: boolean }> {
  const bkt = bucket();
  if (!bkt) {
    throw new UserContextMdWriterError(
      "BUCKET_UNCONFIGURED",
      "WORKSPACE_BUCKET not configured",
    );
  }

  const profile = await resolveUserContextProfile(tx, tenantId, userId);
  if (!profile) {
    throw new UserContextMdWriterError(
      "USER_CONTEXT_UNRESOLVABLE",
      "Could not resolve tenant or user for USER.md write",
    );
  }

  const key = userContextKey(tenantId, userId);
  const rendered = renderUserContextMd(profile, {
    onViolation: opts.onViolation,
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: bkt,
      Key: key,
      Body: rendered,
      ContentType: "text/markdown",
    }),
  );

  return { key, written: true };
}

async function resolveUserContextProfile(
  tx: DbOrTx,
  tenantId: string,
  userId: string,
): Promise<UserContextMdProfile | null> {
  const [tenant] = await tx
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant) return null;

  const [user] = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  const [profile] = await tx
    .select({
      title: userProfiles.title,
      timezone: userProfiles.timezone,
      pronouns: userProfiles.pronouns,
      call_by: userProfiles.call_by,
      notes: userProfiles.notes,
      family: userProfiles.family,
      context: userProfiles.context,
      operating_model: userProfiles.operating_model,
    })
    .from(userProfiles)
    .where(eq(userProfiles.user_id, userId));

  return {
    tenantName: tenant.name,
    userName: user.name,
    email: user.email,
    phone: user.phone,
    title: profile?.title ?? null,
    timezone: profile?.timezone ?? null,
    pronouns: profile?.pronouns ?? null,
    callBy: profile?.call_by ?? null,
    notes: profile?.notes ?? null,
    family: profile?.family ?? null,
    context: profile?.context ?? null,
    operatingModel: profile?.operating_model ?? null,
  };
}

function renderOperatingModelPlaceholders(
  operatingModel: unknown,
): StructuredPlaceholderValues {
  const model =
    typeof operatingModel === "object" && operatingModel !== null
      ? (operatingModel as Record<string, unknown>)
      : {};
  const layers =
    typeof model.layers === "object" && model.layers !== null
      ? (model.layers as Record<string, unknown>)
      : {};
  const rendered: StructuredPlaceholderValues = {};
  for (const [layer, placeholder] of Object.entries(
    OPERATING_MODEL_LAYER_PLACEHOLDERS,
  )) {
    rendered[placeholder as keyof StructuredPlaceholderValues] =
      renderOperatingModelLayer(layers[layer]);
  }
  return rendered;
}

function renderOperatingModelLayer(layerState: unknown): string {
  const entries = Array.isArray((layerState as { entries?: unknown })?.entries)
    ? (layerState as { entries: Array<Record<string, unknown>> }).entries
    : [];
  const visible = entries.filter((entry) => {
    const state = String(
      entry.epistemicState ?? entry.epistemic_state ?? "confirmed",
    );
    return state === "confirmed" || state === "synthesized";
  });
  if (visible.length === 0) return EMPTY_OPERATING_MODEL;
  return visible
    .map((entry) => {
      const title = String(entry.title ?? "Operating-model note");
      const cadence = entry.cadence ? ` (${String(entry.cadence)})` : "";
      const summary = String(entry.summary ?? entry.content ?? "");
      const state = String(entry.epistemicState ?? entry.epistemic_state ?? "");
      const pattern = state === "synthesized" ? " *(pattern)*" : "";
      return `- **${title}**${cadence}: ${summary}${pattern}`;
    })
    .join("\n");
}
