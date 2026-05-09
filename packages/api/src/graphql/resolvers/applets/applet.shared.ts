import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  artifactToCamel,
  artifacts,
  db,
  desc,
  eq,
  lt,
  randomUUID,
  sql,
  threads,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  assertAppletArtifactAccess,
  assertCanWriteApplet,
  type AppletArtifactRow,
} from "../../../lib/applets/access.js";
import {
  AppletMetadataValidationError,
  type AppletMetadataV1,
} from "../../../lib/applets/metadata.js";
import {
  appletMetadataKey,
  appletSourceKey,
  readAppletSourceFromS3,
  writeAppletMetadataToS3,
  writeAppletSourceToS3,
} from "../../../lib/applets/storage.js";
import {
  AppletImportError,
  AppletRuntimePatternError,
  AppletSyntaxError,
  validateAppletSource,
} from "../../../lib/applets/validation.js";

const DEFAULT_APPLET_FILE = "App.tsx";
const DEFAULT_STDLIB_VERSION = "0.1.0";
const MAX_APPLET_LIST_LIMIT = 50;

export interface SaveAppletInput {
  appId?: string | null;
  name: string;
  files: unknown;
  metadata?: unknown;
}

export interface SaveAppletPayload {
  ok: boolean;
  appId: string | null;
  version: number | null;
  validated: boolean;
  persisted: boolean;
  errors: Array<Record<string, unknown>>;
}

export interface SaveAppletStateInput {
  appId: string;
  instanceId: string;
  key: string;
  value: unknown;
}

interface AppletStateMetadata {
  schemaVersion: 1;
  kind: "computer_applet_state";
  appId: string;
  instanceId: string;
  key: string;
  value: unknown;
}

interface AppletStateArtifactRow {
  id: string;
  tenant_id: string;
  thread_id?: string | null;
  type: string;
  metadata?: unknown;
  updated_at: Date | string;
}

export async function loadApplet(args: {
  appId: string;
  ctx: GraphQLContext;
  caller?: { tenantId: string | null; userId: string | null };
}): Promise<{
  artifact: AppletArtifactRow & Record<string, unknown>;
  metadata: AppletMetadataV1;
  source: string;
}> {
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.appId));
  if (!row) {
    throw new GraphQLError("Applet artifact not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  const caller = args.caller ?? (await resolveCaller(args.ctx));
  const metadata = assertAppletArtifactAccess(row, caller);
  const source = await readSource(row);
  return { artifact: row, metadata, source };
}

export function toAppletPayload(input: {
  artifact: AppletArtifactRow & Record<string, unknown>;
  metadata: AppletMetadataV1;
  source: string;
}) {
  return {
    applet: toAppletPreview(input.artifact, input.metadata),
    files: { [DEFAULT_APPLET_FILE]: input.source },
    source: input.source,
    metadata: input.metadata,
  };
}

export async function listApplets(args: {
  ctx: GraphQLContext;
  cursor?: string | null;
  limit?: number | null;
}) {
  const caller = await resolveCaller(args.ctx);
  if (!caller.tenantId) {
    throw new GraphQLError("Applet list requires a tenant caller", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const limit = normalizeListLimit(args.limit);
  const conditions = [
    eq(artifacts.tenant_id, caller.tenantId),
    eq(artifacts.type, "applet"),
  ];
  if (args.cursor) {
    const cursorDate = new Date(args.cursor);
    if (Number.isNaN(cursorDate.getTime())) {
      throw new GraphQLError("Applet cursor is invalid", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    conditions.push(lt(artifacts.created_at, cursorDate));
  }

  const rows = await db
    .select()
    .from(artifacts)
    .where(and(...conditions))
    .orderBy(desc(artifacts.created_at))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextRow = rows[limit];

  return {
    nodes: page.map((row) => {
      const metadata = assertAppletArtifactAccess(row, caller);
      return toAppletPreview(row, metadata);
    }),
    nextCursor: nextRow ? serializeCursor(nextRow.created_at) : null,
  };
}

export async function loadAdminApplet(args: {
  appId: string;
  ctx: GraphQLContext;
}): Promise<{
  artifact: AppletArtifactRow & Record<string, unknown>;
  metadata: AppletMetadataV1;
  source: string;
}> {
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.appId));
  if (!row) {
    throw new GraphQLError("Applet artifact not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  await requireTenantAdmin(args.ctx, row.tenant_id);
  const metadata = assertAppletArtifactAccess(row, {
    tenantId: row.tenant_id,
    userId: null,
  });
  const source = await readSource(row);
  return { artifact: row, metadata, source };
}

export async function listAdminApplets(args: {
  ctx: GraphQLContext;
  tenantId: string;
  userId?: string | null;
  cursor?: string | null;
  limit?: number | null;
}) {
  await requireTenantAdmin(args.ctx, args.tenantId);

  const limit = normalizeListLimit(args.limit);
  const conditions = [
    eq(artifacts.tenant_id, args.tenantId),
    eq(artifacts.type, "applet"),
  ];
  if (args.cursor) {
    const cursorDate = new Date(args.cursor);
    if (Number.isNaN(cursorDate.getTime())) {
      throw new GraphQLError("Applet cursor is invalid", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    conditions.push(lt(artifacts.created_at, cursorDate));
  }

  const rows = args.userId
    ? (
        await db
          .select({ artifact: artifacts })
          .from(artifacts)
          .innerJoin(threads, eq(artifacts.thread_id, threads.id))
          .where(and(...conditions, eq(threads.user_id, args.userId)))
          .orderBy(desc(artifacts.created_at))
          .limit(limit + 1)
      ).map((row) => row.artifact)
    : await db
        .select()
        .from(artifacts)
        .where(and(...conditions))
        .orderBy(desc(artifacts.created_at))
        .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextRow = rows[limit];

  return {
    nodes: page.map((row) => {
      const metadata = assertAppletArtifactAccess(row, {
        tenantId: args.tenantId,
        userId: args.userId ?? null,
      });
      return toAppletPreview(row, metadata);
    }),
    nextCursor: nextRow ? serializeCursor(nextRow.created_at) : null,
  };
}

export async function saveAppletInner(args: {
  ctx: GraphQLContext;
  input: SaveAppletInput;
  regenerate: boolean;
}): Promise<SaveAppletPayload> {
  const tenantId = args.ctx.auth.tenantId;
  if (!tenantId) {
    return failurePayload({
      appId: normalizeAppId(args.input.appId) ?? null,
      version: null,
      validated: false,
      persisted: false,
      error: {
        code: "FORBIDDEN",
        message: "Applet writes require a tenant-scoped service caller",
      },
    });
  }
  assertCanWriteApplet(args.ctx, tenantId);

  const filesResult = parseAppletFiles(args.input.files);
  if (!filesResult.ok) {
    return failurePayload({
      appId: normalizeAppId(args.input.appId) ?? null,
      version: null,
      validated: false,
      persisted: false,
      error: filesResult.error,
    });
  }

  const requestedAppId = normalizeAppId(args.input.appId);
  const appId = args.regenerate
    ? requestedAppId
    : (requestedAppId ?? randomUUID());
  if (!appId || !isUuid(appId)) {
    return failurePayload({
      appId: appId ?? null,
      version: null,
      validated: false,
      persisted: false,
      error: {
        code: "BAD_USER_INPUT",
        message: "Applet appId must be a UUID",
      },
    });
  }

  let previous: {
    artifact: AppletArtifactRow & Record<string, unknown>;
    metadata: AppletMetadataV1;
  } | null = null;
  if (args.regenerate) {
    previous = await loadExistingForWrite({ appId, ctx: args.ctx, tenantId });
    if (!previous) {
      return failurePayload({
        appId,
        version: null,
        validated: false,
        persisted: false,
        error: {
          code: "NOT_FOUND",
          message: "Applet artifact not found",
        },
      });
    }
  }

  try {
    validateAppletSource(filesResult.source);
  } catch (err) {
    return failurePayload({
      appId,
      version: previous?.metadata.version ?? 1,
      validated: false,
      persisted: false,
      error: appletError(err),
    });
  }

  const metadata = buildAppletMetadata({
    appId,
    name: args.input.name,
    tenantId,
    version: previous ? previous.metadata.version + 1 : 1,
    inputMetadata: args.input.metadata,
    fallback: previous?.metadata,
  });
  const sourceKey = appletSourceKey({ tenantId, appId });
  const metadataKey = appletMetadataKey({ tenantId, appId });

  try {
    await writeAppletSourceToS3({
      tenantId,
      key: sourceKey,
      source: filesResult.source,
    });
    await writeAppletMetadataToS3({
      tenantId,
      key: metadataKey,
      metadata,
    });
  } catch (err) {
    return failurePayload({
      appId,
      version: metadata.version,
      validated: true,
      persisted: false,
      error: appletError(err, "SERVICE_UNAVAILABLE"),
    });
  }

  try {
    if (previous) {
      await db
        .update(artifacts)
        .set({
          agent_id: args.ctx.auth.agentId ?? null,
          thread_id: metadata.threadId ?? null,
          title: metadata.name,
          type: "applet",
          status: "final",
          content: null,
          s3_key: sourceKey,
          summary: null,
          metadata,
          updated_at: new Date(),
        })
        .where(eq(artifacts.id, appId))
        .returning();
    } else {
      await db
        .insert(artifacts)
        .values({
          id: appId,
          tenant_id: tenantId,
          agent_id: args.ctx.auth.agentId ?? null,
          thread_id: metadata.threadId ?? null,
          title: metadata.name,
          type: "applet",
          status: "final",
          content: null,
          s3_key: sourceKey,
          summary: null,
          metadata,
        })
        .returning();
    }
  } catch (err) {
    return failurePayload({
      appId,
      version: metadata.version,
      validated: true,
      persisted: false,
      error: appletError(err, "SERVICE_UNAVAILABLE"),
    });
  }

  return {
    ok: true,
    appId,
    version: metadata.version,
    validated: true,
    persisted: true,
    errors: [],
  };
}

async function readSource(artifact: AppletArtifactRow): Promise<string> {
  try {
    return await readAppletSourceFromS3({
      tenantId: artifact.tenant_id,
      key: artifact.s3_key ?? "",
    });
  } catch (err) {
    throw new GraphQLError("Applet source is unavailable", {
      extensions: {
        code:
          err instanceof SyntaxError ||
          err instanceof AppletMetadataValidationError
            ? "BAD_USER_INPUT"
            : "SERVICE_UNAVAILABLE",
      },
    });
  }
}

export async function loadAppletState(args: {
  ctx: GraphQLContext;
  appId: string;
  instanceId: string;
  key: string;
}) {
  const caller = await resolveCaller(args.ctx);
  const applet = await loadAppletArtifactForState({
    appId: args.appId,
    caller,
  });
  const row = await findAppletStateArtifact({
    tenantId: applet.tenant_id,
    appId: args.appId,
    instanceId: args.instanceId,
    key: args.key,
  });

  return row ? toAppletState(row) : null;
}

export async function saveAppletStateInner(args: {
  ctx: GraphQLContext;
  input: SaveAppletStateInput;
}) {
  const caller = await resolveCaller(args.ctx);
  const applet = await loadAppletArtifactForState({
    appId: args.input.appId,
    caller,
  });
  const existing = await findAppletStateArtifact({
    tenantId: applet.tenant_id,
    appId: args.input.appId,
    instanceId: args.input.instanceId,
    key: args.input.key,
  });
  const metadata: AppletStateMetadata = {
    schemaVersion: 1,
    kind: "computer_applet_state",
    appId: args.input.appId,
    instanceId: args.input.instanceId,
    key: args.input.key,
    value: args.input.value,
  };
  const now = new Date();

  if (existing) {
    const [updated] = await db
      .update(artifacts)
      .set({
        title: appletStateTitle(args.input.key),
        metadata,
        updated_at: now,
      })
      .where(eq(artifacts.id, existing.id))
      .returning();
    return toAppletState(updated ?? { ...existing, metadata, updated_at: now });
  }

  const [inserted] = await db
    .insert(artifacts)
    .values({
      tenant_id: applet.tenant_id,
      agent_id: applet.agent_id ?? null,
      thread_id: applet.thread_id ?? null,
      title: appletStateTitle(args.input.key),
      type: "applet_state",
      status: "final",
      content: null,
      s3_key: null,
      summary: null,
      source_message_id: null,
      metadata,
      updated_at: now,
    })
    .returning();

  return toAppletState(inserted);
}

async function loadAppletArtifactForState(args: {
  appId: string;
  caller: { tenantId: string | null; userId: string | null };
}) {
  assertStateIdentity(args.appId, "appId");
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.appId));
  if (!row) {
    throw new GraphQLError("Applet artifact not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  assertAppletArtifactAccess(row, args.caller);
  return row;
}

async function findAppletStateArtifact(args: {
  tenantId: string;
  appId: string;
  instanceId: string;
  key: string;
}): Promise<AppletStateArtifactRow | null> {
  assertStateIdentity(args.instanceId, "instanceId");
  assertStateIdentity(args.key, "key");

  const identity = {
    appId: args.appId,
    instanceId: args.instanceId,
    key: args.key,
  };
  const rows = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenant_id, args.tenantId),
        eq(artifacts.type, "applet_state"),
        sql`${artifacts.metadata} @> ${JSON.stringify(identity)}::jsonb`,
      ),
    )
    .limit(1);

  return (
    rows.find((row) => {
      const metadata = parseAppletStateMetadata(row.metadata);
      return (
        metadata?.appId === args.appId &&
        metadata.instanceId === args.instanceId &&
        metadata.key === args.key
      );
    }) ?? null
  );
}

function toAppletState(row: AppletStateArtifactRow) {
  const metadata = parseAppletStateMetadata(row.metadata);
  if (!metadata) {
    throw new GraphQLError("Applet state artifact metadata is invalid", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return {
    appId: metadata.appId,
    instanceId: metadata.instanceId,
    key: metadata.key,
    value: metadata.value,
    updatedAt: serializeDate(row.updated_at),
  };
}

function parseAppletStateMetadata(input: unknown): AppletStateMetadata | null {
  const metadata = parseJsonObject(input);
  if (!metadata) return null;
  if (metadata.kind !== "computer_applet_state") return null;
  if (metadata.schemaVersion !== 1) return null;
  if (typeof metadata.appId !== "string") return null;
  if (typeof metadata.instanceId !== "string") return null;
  if (typeof metadata.key !== "string") return null;
  return metadata as unknown as AppletStateMetadata;
}

function appletStateTitle(key: string) {
  return `Applet state: ${key}`;
}

function assertStateIdentity(value: string, field: string) {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new GraphQLError(`Applet state ${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function serializeDate(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

async function loadExistingForWrite(args: {
  appId: string;
  ctx: GraphQLContext;
  tenantId: string;
}) {
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.appId));
  if (!row) return null;
  const metadata = assertAppletArtifactAccess(row, {
    tenantId: args.tenantId,
    userId: args.ctx.auth.principalId,
  });
  return { artifact: row, metadata };
}

function toAppletPreview(
  artifact: AppletArtifactRow & Record<string, unknown>,
  metadata: AppletMetadataV1,
) {
  return {
    artifact: artifactToCamel(artifact),
    appId: metadata.appId,
    name: metadata.name,
    version: metadata.version,
    tenantId: metadata.tenantId,
    threadId: metadata.threadId ?? null,
    prompt: metadata.prompt ?? null,
    agentVersion: metadata.agentVersion ?? null,
    modelId: metadata.modelId ?? null,
    generatedAt: metadata.generatedAt,
    stdlibVersionAtGeneration: metadata.stdlibVersionAtGeneration,
  };
}

function parseAppletFiles(
  input: unknown,
):
  | { ok: true; source: string }
  | { ok: false; error: Record<string, unknown> } {
  const files = parseJsonObject(input);
  if (!files || Array.isArray(files)) {
    return {
      ok: false,
      error: {
        code: "BAD_USER_INPUT",
        message: "Applet files must be an object keyed by filename",
      },
    };
  }

  const source = files[DEFAULT_APPLET_FILE] ?? firstTsxFile(files);
  if (typeof source !== "string" || !source.trim()) {
    return {
      ok: false,
      error: {
        code: "BAD_USER_INPUT",
        message: `Applet files must include a non-empty ${DEFAULT_APPLET_FILE}`,
      },
    };
  }
  return { ok: true, source };
}

function firstTsxFile(files: Record<string, unknown>) {
  const entry = Object.entries(files).find(([name]) => name.endsWith(".tsx"));
  return entry?.[1];
}

function buildAppletMetadata(args: {
  appId: string;
  name: string;
  tenantId: string;
  version: number;
  inputMetadata: unknown;
  fallback?: AppletMetadataV1;
}): AppletMetadataV1 {
  const input = parseJsonObject(args.inputMetadata) ?? {};
  const stringField = (key: string, fallback?: string) =>
    typeof input[key] === "string" && input[key].trim()
      ? String(input[key])
      : fallback;

  const metadata: AppletMetadataV1 = {
    schemaVersion: 1,
    kind: "computer_applet",
    appId: args.appId,
    name: args.name,
    version: args.version,
    tenantId: args.tenantId,
    threadId: stringField("threadId", args.fallback?.threadId),
    prompt: stringField("prompt", args.fallback?.prompt),
    agentVersion: stringField("agentVersion", args.fallback?.agentVersion),
    modelId: stringField("modelId", args.fallback?.modelId),
    generatedAt: new Date().toISOString(),
    stdlibVersionAtGeneration: stringField(
      "stdlibVersionAtGeneration",
      args.fallback?.stdlibVersionAtGeneration ?? DEFAULT_STDLIB_VERSION,
    )!,
  };

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  ) as AppletMetadataV1;
}

function parseJsonObject(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function failurePayload(args: {
  appId: string | null;
  version: number | null;
  validated: boolean;
  persisted: boolean;
  error: Record<string, unknown>;
}): SaveAppletPayload {
  return {
    ok: false,
    appId: args.appId,
    version: args.version,
    validated: args.validated,
    persisted: args.persisted,
    errors: [args.error],
  };
}

function appletError(err: unknown, fallbackCode = "BAD_USER_INPUT") {
  if (err instanceof AppletRuntimePatternError) {
    return {
      code: "RUNTIME_PATTERN",
      message: err.message,
      pattern: err.pattern,
      line: err.line,
    };
  }
  if (err instanceof AppletImportError) {
    return {
      code: "IMPORT_NOT_ALLOWED",
      message: err.message,
    };
  }
  if (err instanceof AppletSyntaxError) {
    return {
      code: "SYNTAX_ERROR",
      message: err.message,
    };
  }
  if (err instanceof GraphQLError) {
    return {
      code: err.extensions.code ?? fallbackCode,
      message: err.message,
    };
  }
  return {
    code: fallbackCode,
    message: err instanceof Error ? err.message : String(err),
  };
}

function normalizeAppId(appId: string | null | undefined) {
  const trimmed = appId?.trim();
  return trimmed || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeListLimit(limit: number | null | undefined) {
  if (!limit || limit < 1) return MAX_APPLET_LIST_LIMIT;
  return Math.min(Math.floor(limit), MAX_APPLET_LIST_LIMIT);
}

function serializeCursor(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return null;
}
