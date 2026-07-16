/**
 * Quality gate (THINK-302 U8): every production capability writer that still
 * emits a `.assignment.json` sidecar does so ONLY on the flag-OFF (legacy)
 * branch — i.e. the file is gated by the registry-trust flag. The flag is OFF
 * for every tenant today, so the legacy path is byte-identical; when a tenant
 * flips ON, the writer records a `capability_approvals` binding + marker
 * frontmatter and skips the sidecar.
 *
 * Why not a plain "no `.assignment.json` anywhere" grep: sidecars are written
 * through key-builder constants (`capabilitySidecarKey`, the
 * `*_ASSIGNMENT_STATE_FILE` constants), never a literal path, and the legacy
 * branch must KEEP writing them. So the meaningful invariant is: any source
 * that constructs a `PutObjectCommand` against a sidecar key MUST also carry
 * the registry-trust gate token — a new ungated sidecar writer fails here.
 * Mirrors the agent_profiles retirement gate's walk-and-regex structure.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..", "..");

function isTestPath(path: string): boolean {
  return (
    path.includes("__tests__") ||
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.includes(`${join("test", "integration")}`)
  );
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (full.endsWith(".ts") && !isTestPath(full)) {
      yield full;
    }
  }
}

function productionSources(): string[] {
  return [...walk(join(PACKAGE_ROOT, "src"))];
}

// A source that builds a PutObjectCommand against a capability sidecar key.
const SIDECAR_WRITE_SIGNAL = /new PutObjectCommand/;
const SIDECAR_KEY_SIGNAL =
  /capabilitySidecarKey|assignmentStateKey\(|mcpAssignmentStateKey|CAPABILITY_SIDECAR_FILE|SKILL_ASSIGNMENT_STATE_FILE|MCP_ASSIGNMENT_STATE_FILE|agentChildGrantSidecarKey/;

// The registry-trust gate token: the file threads the flag / binding context.
const GATE_SIGNAL =
  /RegistryBindingContext|capabilityRegistryTrust|registry-trust-flag|writeRegistryBinding|writeSkillRegistryBinding|writeMcpRegistryBinding|input\.registry|deps\.registry/;

describe("no-sidecar-writer gate (THINK-302 U8)", () => {
  it("every production sidecar writer is gated by the registry-trust flag", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const source = readFileSync(file, "utf8");
      const writesSidecar =
        SIDECAR_WRITE_SIGNAL.test(source) && SIDECAR_KEY_SIGNAL.test(source);
      if (writesSidecar && !GATE_SIGNAL.test(source)) {
        offenders.push(relative(PACKAGE_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the three known writers keep BOTH the legacy sidecar path and the ON gate", () => {
    const writers: Array<{ path: string; legacy: RegExp }> = [
      {
        path: "src/lib/capabilities/folder-write.ts",
        legacy: /capabilitySidecarKey/,
      },
      {
        path: "src/lib/skills/assignment-state.ts",
        legacy: /assignmentStateKey\(/,
      },
      {
        path: "src/lib/mcp/assignment-state.ts",
        legacy: /mcpAssignmentStateKey/,
      },
    ];
    for (const writer of writers) {
      const source = readFileSync(join(PACKAGE_ROOT, writer.path), "utf8");
      expect(writer.legacy.test(source), `${writer.path} legacy path`).toBe(
        true,
      );
      expect(GATE_SIGNAL.test(source), `${writer.path} registry gate`).toBe(
        true,
      );
    }
  });

  it("the dual-read reader contract is untouched (readers still exported)", () => {
    const skill = readFileSync(
      join(PACKAGE_ROOT, "src/lib/skills/assignment-state.ts"),
      "utf8",
    );
    const mcp = readFileSync(
      join(PACKAGE_ROOT, "src/lib/mcp/assignment-state.ts"),
      "utf8",
    );
    expect(skill).toContain("export async function readSkillAssignmentState");
    expect(mcp).toContain("export async function readMcpAssignmentState");
  });
});
