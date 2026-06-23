import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSkillSpectorForFiles } from "./skillspector.js";

const originalBin = process.env.SKILLSPECTOR_BIN;
const originalRunner = process.env.SKILL_TRUST_RUNNER_FUNCTION_NAME;
const originalStage = process.env.STAGE;
const originalAwsFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
const originalAwsRegion = process.env.AWS_REGION;
const originalAwsDefaultRegion = process.env.AWS_DEFAULT_REGION;
const mocks = vi.hoisted(() => ({
  lambdaSend: vi.fn(),
  lambdaClient: vi.fn(() => ({ send: mocks.lambdaSend })),
  invokeCommand: vi.fn((input: unknown) => ({ input })),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: mocks.lambdaClient,
  InvokeCommand: mocks.invokeCommand,
}));

afterEach(() => {
  if (originalBin === undefined) {
    delete process.env.SKILLSPECTOR_BIN;
  } else {
    process.env.SKILLSPECTOR_BIN = originalBin;
  }
  if (originalRunner === undefined) {
    delete process.env.SKILL_TRUST_RUNNER_FUNCTION_NAME;
  } else {
    process.env.SKILL_TRUST_RUNNER_FUNCTION_NAME = originalRunner;
  }
  if (originalStage === undefined) {
    delete process.env.STAGE;
  } else {
    process.env.STAGE = originalStage;
  }
  if (originalAwsFunctionName === undefined) {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  } else {
    process.env.AWS_LAMBDA_FUNCTION_NAME = originalAwsFunctionName;
  }
  if (originalAwsRegion === undefined) {
    delete process.env.AWS_REGION;
  } else {
    process.env.AWS_REGION = originalAwsRegion;
  }
  if (originalAwsDefaultRegion === undefined) {
    delete process.env.AWS_DEFAULT_REGION;
  } else {
    process.env.AWS_DEFAULT_REGION = originalAwsDefaultRegion;
  }
  mocks.lambdaSend.mockReset();
  mocks.lambdaClient.mockClear();
  mocks.invokeCommand.mockClear();
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

  it("invokes the configured trust runner before the local binary path", async () => {
    process.env.SKILL_TRUST_RUNNER_FUNCTION_NAME =
      "thinkwork-dev-skill-trust-runner";
    process.env.SKILLSPECTOR_BIN = "/does/not/matter";
    mocks.lambdaSend.mockResolvedValueOnce({
      Payload: Buffer.from(
        JSON.stringify({
          report: {
            risk_assessment: {
              score: 12,
              severity: "LOW",
              recommendation: "INSTALL",
            },
            issues: [],
            metadata: { skillspector_version: "2.2.3" },
          },
        }),
      ),
    });

    const result = await runSkillSpectorForFiles({
      slug: "runner-skill",
      files: [
        {
          path: "SKILL.md",
          content: Buffer.from("---\nname: runner-skill\n---\n"),
        },
      ],
    });

    expect(result).toMatchObject({
      scanner: {
        status: "completed",
        version: "2.2.3",
        riskScore: 12,
        riskSeverity: "LOW",
        recommendation: "INSTALL",
      },
      findings: [],
    });
    expect(mocks.invokeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        FunctionName: "thinkwork-dev-skill-trust-runner",
        InvocationType: "RequestResponse",
      }),
    );
    const payload = JSON.parse(
      Buffer.from(
        (mocks.invokeCommand.mock.calls[0]![0] as { Payload: Uint8Array })
          .Payload,
      ).toString("utf8"),
    ) as {
      slug: string;
      files: Array<{ path: string; contentBase64: string }>;
    };
    expect(payload).toEqual({
      slug: "runner-skill",
      files: [
        {
          path: "SKILL.md",
          contentBase64: Buffer.from("---\nname: runner-skill\n---\n").toString(
            "base64",
          ),
        },
      ],
    });
  });

  it("passes the configured AWS region to the trust runner client", async () => {
    process.env.SKILL_TRUST_RUNNER_FUNCTION_NAME =
      "thinkwork-dev-skill-trust-runner";
    process.env.AWS_REGION = "us-east-2";
    process.env.AWS_DEFAULT_REGION = "us-west-2";
    mocks.lambdaSend.mockResolvedValueOnce({
      Payload: Buffer.from(
        JSON.stringify({
          report: {
            risk_assessment: { score: 0, severity: "LOW" },
            issues: [],
            metadata: { skillspector_version: "2.2.3" },
          },
        }),
      ),
    });

    await runSkillSpectorForFiles({
      slug: "runner-skill",
      files: [
        {
          path: "SKILL.md",
          content: Buffer.from("---\nname: runner-skill\n---\n"),
        },
      ],
    });

    expect(mocks.lambdaClient).toHaveBeenCalledWith({ region: "us-east-2" });
  });

  it("fails closed when the configured trust runner errors", async () => {
    process.env.SKILL_TRUST_RUNNER_FUNCTION_NAME =
      "thinkwork-dev-skill-trust-runner";
    mocks.lambdaSend.mockResolvedValueOnce({
      FunctionError: "Unhandled",
      Payload: Buffer.from(JSON.stringify({ error: "scanner crashed" })),
    });

    await expect(
      runSkillSpectorForFiles({
        slug: "runner-skill",
        files: [
          {
            path: "SKILL.md",
            content: Buffer.from("---\nname: runner-skill\n---\n"),
          },
        ],
      }),
    ).resolves.toEqual({
      scanner: { status: "failed", error: "scanner crashed" },
      findings: [],
    });
  });

  it("derives the deployed trust runner name from Lambda stage identity", async () => {
    delete process.env.SKILL_TRUST_RUNNER_FUNCTION_NAME;
    process.env.STAGE = "dev";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "thinkwork-dev-api-workspace-files";
    mocks.lambdaSend.mockResolvedValueOnce({
      Payload: Buffer.from(
        JSON.stringify({
          report: {
            risk_assessment: { score: 0, severity: "LOW" },
            issues: [],
            metadata: { skillspector_version: "2.2.3" },
          },
        }),
      ),
    });

    await runSkillSpectorForFiles({
      slug: "runner-skill",
      files: [
        {
          path: "SKILL.md",
          content: Buffer.from("---\nname: runner-skill\n---\n"),
        },
      ],
    });

    expect(mocks.invokeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        FunctionName: "thinkwork-dev-skill-trust-runner",
      }),
    );
  });
});
