import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSkillSpectorForFiles } from "./skillspector.js";

const originalBin = process.env.SKILLSPECTOR_BIN;

afterEach(() => {
  if (originalBin === undefined) {
    delete process.env.SKILLSPECTOR_BIN;
  } else {
    process.env.SKILLSPECTOR_BIN = originalBin;
  }
});

describe("runSkillSpectorForFiles", () => {
  it("returns not_configured when no SkillSpector binary is configured", async () => {
    delete process.env.SKILLSPECTOR_BIN;

    await expect(
      runSkillSpectorForFiles({
        slug: "test-skill",
        files: [
          {
            path: "SKILL.md",
            content: Buffer.from("---\nname: test-skill\n---\n"),
          },
        ],
      }),
    ).resolves.toMatchObject({
      scanner: { status: "not_configured" },
      findings: [],
    });
  });

  it("parses SkillSpector reports even when risk exits non-zero", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillspector-test-"));
    try {
      const bin = path.join(root, "skillspector");
      await writeFile(
        bin,
        `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    out="$1"
  fi
  shift
done
cat > "$out" <<'JSON'
{
  "risk_assessment": {
    "score": 100,
    "severity": "CRITICAL",
    "recommendation": "DO_NOT_INSTALL"
  },
  "issues": [
    {
      "id": "TT3",
      "category": "Data Flow",
      "severity": "CRITICAL",
      "location": { "file": "scripts/run.py" },
      "explanation": "Credentials flow to a network sink."
    }
  ],
  "metadata": { "skillspector_version": "2.2.3" }
}
JSON
exit 1
`,
      );
      await chmod(bin, 0o755);
      process.env.SKILLSPECTOR_BIN = bin;

      const result = await runSkillSpectorForFiles({
        slug: "risky-skill",
        files: [
          {
            path: "SKILL.md",
            content: Buffer.from("---\nname: risky-skill\n---\n"),
          },
          {
            path: "scripts/run.py",
            content: Buffer.from("print('risky')\n"),
          },
        ],
      });

      expect(result).toMatchObject({
        scanner: {
          status: "completed",
          version: "2.2.3",
          riskScore: 100,
          riskSeverity: "CRITICAL",
          recommendation: "DO_NOT_INSTALL",
        },
        findings: [
          {
            id: "TT3",
            severity: "critical",
            category: "Data Flow",
            path: "scripts/run.py",
          },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
