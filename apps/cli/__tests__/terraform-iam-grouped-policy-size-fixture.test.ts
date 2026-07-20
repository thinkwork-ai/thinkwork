import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const IAM_GROUPED = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/iam-grouped.tf",
);
const TEI_RENDERED_POLICIES = resolve(
  __dirname,
  "fixtures/tei-api-grouped-policies-v372.fixture",
);

type PolicyStatement = { Action?: string[] };
type PolicyDocument = { Statement: PolicyStatement[]; Version: string };

type RenderedPolicyFixture = {
  evidence: {
    accountId: string;
    region: string;
    stage: string;
  };
  policies: Record<string, PolicyDocument>;
};

describe("grouped API IAM policy size floor", () => {
  it("partitions internal Lambda invocation from orchestration", () => {
    const source = readFileSync(IAM_GROUPED, "utf8");

    expect(source).toContain('Sid    = "ApiCrossFunctionInvoke"');
    expect(source).toMatch(
      /api_orchestration_statements\s*=\s*\[[\s\S]*?!contains\(try\(statement\.Action, \[\]\), "lambda:InvokeFunction"\)/,
    );
    expect(source).toMatch(
      /api_invocation_statements\s*=\s*\[[\s\S]*?contains\(try\(statement\.Action, \[\]\), "lambda:InvokeFunction"\)/,
    );
    expect(source).toContain("Statement = local.api_invocation_statements");
    expect(source).toMatch(/resource "aws_iam_policy" "api_invocation"/);
    expect(source).toMatch(
      /resource "aws_iam_role_policy_attachment" "api_invocation"/,
    );
    expect(source).toContain(
      "depends_on = [aws_iam_role_policy_attachment.api_invocation]",
    );
    expect(source).toMatch(
      /resource "aws_iam_policy" "api_orchestration"[\s\S]*?ignore_changes = \[description\]/,
    );
  });

  it("checks every rendered grouped policy against IAM's hard limit", () => {
    const source = readFileSync(IAM_GROUPED, "utf8");
    const fixture = JSON.parse(
      readFileSync(TEI_RENDERED_POLICIES, "utf8"),
    ) as RenderedPolicyFixture;

    expect(source).toContain(
      "for document in values(local.api_grouped_policy_documents) : length(document) <= 6144",
    );
    expect(
      source.match(/length\(local\.api_grouped_policy_documents\./g),
    ).toHaveLength(5);

    expect(fixture.evidence).toMatchObject({
      accountId: "637423202447",
      region: "us-east-1",
      stage: "tei-e2e",
    });
    expect(Object.keys(fixture.policies).sort()).toEqual([
      "ai",
      "data_plane",
      "invocation",
      "observability",
      "orchestration",
    ]);

    for (const [name, policy] of Object.entries(fixture.policies)) {
      expect(
        JSON.stringify(policy).length,
        `${name} policy must fit IAM's managed-policy document limit`,
      ).toBeLessThanOrEqual(6144);
    }

    expect(
      fixture.policies.invocation.Statement.every((statement) =>
        statement.Action?.includes("lambda:InvokeFunction"),
      ),
    ).toBe(true);
    expect(
      fixture.policies.orchestration.Statement.some((statement) =>
        statement.Action?.includes("lambda:InvokeFunction"),
      ),
    ).toBe(false);
  });
});
