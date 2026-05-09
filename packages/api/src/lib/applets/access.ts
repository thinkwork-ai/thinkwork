import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../graphql/context.js";
import {
  parseAppletMetadataV1,
  type AppletMetadataV1,
} from "./metadata.js";

export interface AppletArtifactRow {
  id: string;
  tenant_id: string;
  agent_id?: string | null;
  thread_id?: string | null;
  type: string;
  s3_key?: string | null;
  metadata?: unknown;
}

export function assertAppletArtifactAccess(
  artifact: AppletArtifactRow,
  caller: { tenantId: string | null; userId: string | null },
): AppletMetadataV1 {
  if (!caller.tenantId || artifact.tenant_id !== caller.tenantId) {
    throw appletNotFound();
  }
  if (artifact.type !== "applet" && artifact.type !== "APPLET") {
    throw badAppletArtifact();
  }
  if (!artifact.s3_key) {
    throw badAppletArtifact("Applet artifact source is missing");
  }

  const metadata = parseAppletMetadataV1(artifact.metadata);
  if (metadata.tenantId !== artifact.tenant_id) {
    throw badAppletArtifact("Applet artifact tenant linkage is invalid");
  }
  if (
    metadata.threadId &&
    artifact.thread_id &&
    metadata.threadId !== artifact.thread_id
  ) {
    throw badAppletArtifact("Applet artifact thread linkage is invalid");
  }
  return metadata;
}

export function assertCanWriteApplet(ctx: GraphQLContext, tenantId: string) {
  if (ctx.auth.authType !== "apikey" || ctx.auth.tenantId !== tenantId) {
    throw new GraphQLError("Applet writes require service authentication", {
      extensions: { code: "FORBIDDEN" },
    });
  }
}

function appletNotFound() {
  return new GraphQLError("Applet artifact not found", {
    extensions: { code: "NOT_FOUND" },
  });
}

function badAppletArtifact(message = "Artifact is not an applet artifact") {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}
