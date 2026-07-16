import { describe, expect, it } from "vitest";

import {
  AGENT_CONNECTORS_FOLDER,
  agentAssignmentRe,
  agentMarkerRe,
  LEGACY_ROOT_CONNECTIONS_FOLDER,
  ROOT_CONNECTIONS_FOLDER,
  TOOLS_FOLDER,
  capabilityClassFromFolderName,
  capabilityFolderFileRe,
  capabilityFolderName,
  connectionAssignmentRe,
  connectionMarkerRe,
  mcpAssignmentRe,
  skillAssignmentRe,
  skillMarkerRe,
  toolAssignmentRe,
  toolMarkerRe,
} from "./workspace-constants.js";

/**
 * U15 FLIP (plan R18/R19): these snapshots deliberately changed from the
 * U14 "inert proof" — the root connection folder is now `connectors/`.
 * Writers/key builders emit ONLY the new spelling; the `dualRead` regex
 * variants accept both spellings during the rename window (until the
 * per-tenant `migrate-connectors` mover has run everywhere).
 */
describe("workspace-constants post-flip literal patterns (U15)", () => {
  it("skill markers (compose-tuple)", () => {
    expect(skillMarkerRe().source).toBe(/^skills\/([^/]+)\/SKILL\.md$/.source);
    expect(skillAssignmentRe().source).toBe(
      /^skills\/([^/]+)\/\.assignment\.json$/.source,
    );
  });

  it("capability folder markers emit the flipped connectors/ spelling", () => {
    expect(connectionMarkerRe().source).toBe(
      /^connectors\/([^/]+)\/CONNECTION\.md$/.source,
    );
    expect(connectionAssignmentRe().source).toBe(
      /^connectors\/([^/]+)\/\.assignment\.json$/.source,
    );
    expect(toolMarkerRe().source).toBe(/^tools\/([^/]+)\/TOOL\.md$/.source);
    expect(toolAssignmentRe().source).toBe(
      /^tools\/([^/]+)\/\.assignment\.json$/.source,
    );
    // The connectors flip is a compile-visible change — covered by the
    // CAPABILITY_COMPILE_REVISION 4→5 bump (rev 3→4 covered agents/).
    expect(capabilityFolderFileRe().source).toBe(
      /^(connectors|tools|agents)\/([^/]+)\/(.+)$/.source,
    );
  });

  it("agent folder markers (subagent-folders U4)", () => {
    expect(capabilityFolderName("agent")).toBe("agents");
    expect(agentMarkerRe().source).toBe(
      /^agents\/([^/]+)\/INSTRUCTIONS\.md$/.source,
    );
    expect(agentAssignmentRe().source).toBe(
      /^agents\/([^/]+)\/\.assignment\.json$/.source,
    );
    expect(capabilityClassFromFolderName("agents")).toBe("agent");
  });

  it("mcp assignment marker (assignment-state)", () => {
    expect(mcpAssignmentRe().source).toBe(
      /^mcp\/([^/]+)\/\.assignment\.json$/.source,
    );
  });

  it("root folder names match the flipped key builders", () => {
    expect(capabilityFolderName("connection")).toBe("connectors");
    expect(capabilityFolderName("tool")).toBe("tools");
    expect(ROOT_CONNECTIONS_FOLDER).toBe("connectors");
    expect(LEGACY_ROOT_CONNECTIONS_FOLDER).toBe("connections");
    expect(TOOLS_FOLDER).toBe("tools");
  });
});

describe("dual-read window (U15 — R19)", () => {
  it("marker regexes accept BOTH spellings with dualRead", () => {
    const marker = connectionMarkerRe("root", { dualRead: true });
    expect(marker.source).toBe(
      /^connect(?:ion|or)s\/([^/]+)\/CONNECTION\.md$/.source,
    );
    expect("connectors/pg-dev/CONNECTION.md".match(marker)?.[1]).toBe("pg-dev");
    expect("connections/pg-dev/CONNECTION.md".match(marker)?.[1]).toBe(
      "pg-dev",
    );
    expect("connectionx/pg-dev/CONNECTION.md".match(marker)).toBeNull();

    const assignment = connectionAssignmentRe("root", { dualRead: true });
    expect("connections/pg-dev/.assignment.json".match(assignment)?.[1]).toBe(
      "pg-dev",
    );
    expect("connectors/pg-dev/.assignment.json".match(assignment)?.[1]).toBe(
      "pg-dev",
    );
  });

  it("folder-file scan accepts both spellings and keeps group numbering", () => {
    const re = capabilityFolderFileRe("root", { dualRead: true });
    const legacy = "connections/pg-dev/SCHEMA.md".match(re);
    expect(legacy?.[1]).toBe("connections");
    expect(legacy?.[2]).toBe("pg-dev");
    expect(legacy?.[3]).toBe("SCHEMA.md");
    const current = "connectors/pg-dev/SCHEMA.md".match(re);
    expect(current?.[1]).toBe("connectors");
    expect(current?.[2]).toBe("pg-dev");
    expect(current?.[3]).toBe("SCHEMA.md");
  });

  it("without dualRead, only the new spelling matches", () => {
    expect(
      "connections/pg-dev/CONNECTION.md".match(connectionMarkerRe()),
    ).toBeNull();
    expect(
      "connectors/pg-dev/CONNECTION.md".match(connectionMarkerRe())?.[1],
    ).toBe("pg-dev");
  });
});

describe("scope-aware naming (plan KTD-6)", () => {
  it("agent-scope connection grants spell connectors/ (now scope-invariant)", () => {
    expect(capabilityFolderName("connection", "agent")).toBe("connectors");
    expect(AGENT_CONNECTORS_FOLDER).toBe("connectors");
    expect(connectionMarkerRe("agent").source).toBe(
      /^connectors\/([^/]+)\/CONNECTION\.md$/.source,
    );
  });

  it("tool folders are scope-invariant", () => {
    expect(capabilityFolderName("tool", "agent")).toBe("tools");
  });

  it("class mapping accepts both connection spellings", () => {
    expect(capabilityClassFromFolderName("connections")).toBe("connection");
    expect(capabilityClassFromFolderName("connectors")).toBe("connection");
    expect(capabilityClassFromFolderName("tools")).toBe("tool");
    expect(capabilityClassFromFolderName("skills")).toBe(null);
  });
});
