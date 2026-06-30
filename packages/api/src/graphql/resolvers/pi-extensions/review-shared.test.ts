import { describe, expect, it } from "vitest";
import {
  buildPiExtensionArtifactDescriptor,
  piExtensionArtifactHash,
  piExtensionArtifactUri,
} from "../../../lib/pi-extensions/artifacts.js";
import type { PiExtensionManifest } from "../../../lib/pi-extensions/manifest.js";
import {
  assertVersionCanBeApproved,
  assertVersionCanBeAssigned,
  normalizeAssignmentTarget,
  normalizeGrantedPermissions,
  shouldRejectVersion,
} from "./review-shared.js";
import type { PiExtensionVersionRow } from "./shared.js";

describe("Pi extension review gates", () => {
  it("allows approval when verification evidence matches the immutable version", () => {
    expect(() => assertVersionCanBeApproved(versionRow())).not.toThrow();
  });

  it("rejects approval when verification evidence is stale", () => {
    expect(() =>
      assertVersionCanBeApproved(
        versionRow({
          manifest_hash: "stale-manifest",
        }),
      ),
    ).toThrow("manifest hash is stale");
  });

  it("rejects approval when verification did not pass", () => {
    expect(() =>
      assertVersionCanBeApproved(
        versionRow({
          status: "failed_verification",
          verification_report: {
            schemaVersion: 1,
            status: "failed",
            checkedAt: "2026-06-30T00:00:00.000Z",
            findings: [],
          },
        }),
      ),
    ).toThrow("Only verified review candidates can be approved");
  });

  it("blocks assignment while allowing disable for non-approved versions", () => {
    const rejected = versionRow({ status: "rejected" });

    expect(() => assertVersionCanBeAssigned(rejected, true)).toThrow(
      "Only approved Pi extension versions can be assigned",
    );
    expect(() => assertVersionCanBeAssigned(rejected, false)).not.toThrow();
  });

  it("does not allow rejection to revoke approved versions", () => {
    expect(() =>
      shouldRejectVersion(versionRow({ status: "approved" })),
    ).toThrow("Approved Pi extension versions cannot be rejected");
    expect(shouldRejectVersion(versionRow({ status: "rejected" }))).toBe(false);
    expect(shouldRejectVersion(versionRow({ status: "needs_review" }))).toBe(
      true,
    );
  });

  it("normalizes granted permissions and rejects unrequested classes", () => {
    expect(
      normalizeGrantedPermissions({
        value: undefined,
        requestedPermissionClasses: ["network", "workspace_read"],
      }),
    ).toEqual({ permissionClasses: [] });

    expect(() =>
      normalizeGrantedPermissions({
        value: { permissionClasses: ["secrets"] },
        requestedPermissionClasses: ["network"],
      }),
    ).toThrow("must be requested");
  });

  it("normalizes assignment targets", () => {
    expect(
      normalizeAssignmentTarget({
        targetType: "DEFAULT_AGENT",
        agentProfileId: null,
      }),
    ).toEqual({ targetType: "default_agent", agentProfileId: null });

    expect(
      normalizeAssignmentTarget({
        targetType: "AGENT_PROFILE",
        agentProfileId: "profile-1",
      }),
    ).toEqual({ targetType: "agent_profile", agentProfileId: "profile-1" });

    expect(() =>
      normalizeAssignmentTarget({
        targetType: "AGENT_PROFILE",
        agentProfileId: null,
      }),
    ).toThrow("requires profile id");
  });
});

function versionRow(
  overrides: Partial<PiExtensionVersionRow> = {},
): PiExtensionVersionRow {
  const manifest = manifestFixture();
  const descriptor = buildPiExtensionArtifactDescriptor({
    repositoryUrl: "https://github.com/acme/pi-extension",
    owner: "acme",
    repo: "pi-extension",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    sourceRef: "main",
    manifestPath: "pi-extension.json",
    manifest,
  });

  return {
    id: "version-1",
    tenant_id: "tenant-1",
    source_id: "source-1",
    display_name: "ACME Extension",
    description: "Adds ACME tools.",
    source_ref: "main",
    commit_sha: descriptor.commitSha,
    manifest_hash: descriptor.manifestHash,
    artifact_hash: piExtensionArtifactHash(descriptor),
    artifact_uri: piExtensionArtifactUri(descriptor),
    runtime_target: descriptor.runtimeTarget,
    status: "needs_review",
    status_reason: null,
    manifest: manifest as unknown as Record<string, unknown>,
    tool_names: ["acme_lookup"],
    lifecycle_hooks: [],
    permission_classes: ["network"],
    verification_report: {
      schemaVersion: 1,
      status: "passed",
      checkedAt: "2026-06-30T00:00:00.000Z",
      findings: [],
      artifactDescriptor: descriptor,
      source: { commitSha: descriptor.commitSha },
    },
    reviewed_by_user_id: null,
    reviewed_at: null,
    approved_by_user_id: null,
    approved_at: null,
    rejected_by_user_id: null,
    rejected_at: null,
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

function manifestFixture(): PiExtensionManifest {
  return {
    schemaVersion: 1,
    name: "acme_extension",
    displayName: "ACME Extension",
    description: "Adds ACME tools.",
    runtimeTarget: "agentcore-pi",
    entrypoint: "dist/index.js",
    tools: [{ name: "acme_lookup" }],
    lifecycleHooks: [],
    permissionClasses: ["network"],
  };
}
