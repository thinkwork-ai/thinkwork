import { describe, expect, it } from "vitest";

import {
  AGENT_CONNECTORS_FOLDER,
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
 * Inert proof (plan U14): every builder must reproduce the exact pattern
 * its consumer carried before centralization. These snapshots are the
 * byte-identical-behavior contract — the U15 flip changes them
 * deliberately, with dual-read alternation landing in the same PR.
 */
describe("workspace-constants reproduce today's literal patterns", () => {
  it("skill markers (compose-tuple)", () => {
    expect(skillMarkerRe().source).toBe(/^skills\/([^/]+)\/SKILL\.md$/.source);
    expect(skillAssignmentRe().source).toBe(
      /^skills\/([^/]+)\/\.assignment\.json$/.source,
    );
  });

  it("capability folder markers (compose-tuple)", () => {
    expect(connectionMarkerRe().source).toBe(
      /^connections\/([^/]+)\/CONNECTION\.md$/.source,
    );
    expect(connectionAssignmentRe().source).toBe(
      /^connections\/([^/]+)\/\.assignment\.json$/.source,
    );
    expect(toolMarkerRe().source).toBe(/^tools\/([^/]+)\/TOOL\.md$/.source);
    expect(toolAssignmentRe().source).toBe(
      /^tools\/([^/]+)\/\.assignment\.json$/.source,
    );
    expect(capabilityFolderFileRe().source).toBe(
      /^(connections|tools)\/([^/]+)\/(.+)$/.source,
    );
  });

  it("mcp assignment marker (assignment-state)", () => {
    expect(mcpAssignmentRe().source).toBe(
      /^mcp\/([^/]+)\/\.assignment\.json$/.source,
    );
  });

  it("root folder names match today's key builders", () => {
    expect(capabilityFolderName("connection")).toBe("connections");
    expect(capabilityFolderName("tool")).toBe("tools");
    expect(ROOT_CONNECTIONS_FOLDER).toBe("connections");
    expect(TOOLS_FOLDER).toBe("tools");
  });
});

describe("scope-aware naming (plan KTD-6)", () => {
  it("agent-scope connection grants spell connectors/ greenfield", () => {
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
