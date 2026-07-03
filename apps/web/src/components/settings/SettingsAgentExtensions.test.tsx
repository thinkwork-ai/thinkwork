import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiExtensionVersionStatus } from "@/gql/graphql";
import { formatPiExtensionStatus } from "./SettingsAgentExtensions";

const source = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsAgentExtensions.tsx"),
  "utf8",
);
const capabilitiesSource = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsCapabilities.tsx"),
  "utf8",
);

describe("SettingsAgentExtensions", () => {
  it("formats every Pi extension status for operators", () => {
    expect(formatPiExtensionStatus(PiExtensionVersionStatus.Imported)).toBe(
      "Imported",
    );
    expect(formatPiExtensionStatus(PiExtensionVersionStatus.NeedsReview)).toBe(
      "Needs review",
    );
    expect(formatPiExtensionStatus(PiExtensionVersionStatus.Approved)).toBe(
      "Approved",
    );
    expect(formatPiExtensionStatus(PiExtensionVersionStatus.Rejected)).toBe(
      "Rejected",
    );
    expect(
      formatPiExtensionStatus(PiExtensionVersionStatus.FailedVerification),
    ).toBe("Failed verification");
  });

  it("renders the operator table and review sheet contract", () => {
    expect(source).toContain("<DataTable");
    expect(source).toContain('header: "Extension"');
    expect(source).toContain('header: "Source/ref"');
    expect(source).toContain('header: "Status"');
    expect(source).toContain('header: "Tools"');
    expect(source).toContain('header: "Permissions"');
    expect(source).toContain('header: "Assigned to"');
    expect(source).toContain('header: "Last verified"');
    expect(source).toContain("<PiExtensionReviewSheet");
    expect(source).toContain("Source URL");
    expect(source).toContain("Input ref");
    expect(source).toContain("Resolved commit");
    expect(source).toContain("Artifact hash");
    expect(source).toContain("Runtime target");
    expect(source).toContain("Requested permissions");
    expect(source).toContain("Granted permissions");
  });

  it("keeps GitHub import scoped to repository URL and ref", () => {
    expect(source).toContain("GitHub repository URL");
    expect(source).toContain('id="pi-extension-ref"');
    expect(source).toContain("repositoryUrl: trimmedUrl");
    expect(source).toContain("ref: trimmedRef");
    expect(source).not.toContain("manifestPath:");
  });

  it("is a registry surface only — no assignment writes (plan U8, R3/R11)", () => {
    // Registry demotion: extension ASSIGNMENT moved to the Composer, which owns
    // the unified grant/detach write path. This surface imports + reviews only.
    expect(source).not.toContain("SettingsGrantCapabilityMutation");
    expect(source).not.toContain("SettingsDetachCapabilityMutation");
    expect(source).not.toContain("grantCapability");
    expect(source).not.toContain("detachCapability");
    expect(source).not.toContain("CapabilityGrantClass");
    // But it still shows a read-only view of where a version is assigned.
    expect(source).toContain("Assigned in the Composer");
    expect(source).toContain("ReadOnlyAssignments");
  });

  // Agent page merge (THINK-132 U3): the registry relocated into a Composer
  // side sheet; the component contract and its own query shape are untouched.
  it("mounts inside the Composer Extensions sheet", () => {
    expect(capabilitiesSource).toContain('data-testid="open-extensions-sheet"');
    expect(capabilitiesSource).toContain('data-testid="agent-extensions-sheet"');
    expect(capabilitiesSource).toContain("<SettingsAgentExtensions");
  });
});
