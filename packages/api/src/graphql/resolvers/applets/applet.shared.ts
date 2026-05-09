import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { artifactToCamel, artifacts, db, eq } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  assertAppletArtifactAccess,
  type AppletArtifactRow,
} from "../../../lib/applets/access.js";
import {
  AppletMetadataValidationError,
  type AppletMetadataV1,
} from "../../../lib/applets/metadata.js";
import { readAppletSourceFromS3 } from "../../../lib/applets/storage.js";

export async function loadApplet(args: {
  id: string;
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
    .where(eq(artifacts.id, args.id));
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
    applet: {
      artifact: artifactToCamel(input.artifact),
      appId: input.metadata.appId,
      name: input.metadata.name,
      version: input.metadata.version,
      source: input.source,
      sourceKey: input.artifact.s3_key,
      metadata: input.metadata,
    },
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
