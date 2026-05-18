import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const LAMBDA_API_HANDLERS = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/handlers.tf",
);
const LAMBDA_API_REMOTE_ARTIFACTS = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/remote-artifacts.tf",
);
const LAMBDA_API_VARIABLES = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/variables.tf",
);
const LAMBDA_API_OUTPUTS = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/outputs.tf",
);
const LAMBDA_API_EVAL_FANOUT = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/eval-fanout.tf",
);
const LAMBDA_API_WORKSPACE_EVENTS = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/workspace-events.tf",
);
const THINKWORK_VARIABLES = resolve(
  REPO_ROOT,
  "terraform/modules/thinkwork/variables.tf",
);
const THINKWORK_MAIN = resolve(
  REPO_ROOT,
  "terraform/modules/thinkwork/main.tf",
);
const THINKWORK_OUTPUTS = resolve(
  REPO_ROOT,
  "terraform/modules/thinkwork/outputs.tf",
);
const GREENFIELD_MAIN = resolve(
  REPO_ROOT,
  "terraform/examples/greenfield/main.tf",
);
const GREENFIELD_TFVARS_EXAMPLE = resolve(
  REPO_ROOT,
  "terraform/examples/greenfield/terraform.tfvars.example",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("enterprise Terraform release artifacts", () => {
  it("lambda-api exposes a mutually exclusive S3 artifact mode", () => {
    const variables = read(LAMBDA_API_VARIABLES);
    const remote = read(LAMBDA_API_REMOTE_ARTIFACTS);

    expect(variables).toMatch(/variable "lambda_artifact_bucket"/);
    expect(variables).toMatch(/variable "lambda_artifact_prefix"/);
    expect(variables).toMatch(/variable "require_lambda_artifacts"/);
    expect(remote).toMatch(/use_remote_lambda_artifacts\s*=/);
    expect(remote).toMatch(
      /resource "terraform_data" "lambda_artifact_validation"/,
    );
    expect(remote).toMatch(/precondition/);
    expect(remote).toMatch(/lambda_artifact_mode/);
  });

  it("for_each handlers can deploy from either local zips or remote S3 release zips", () => {
    const source = read(LAMBDA_API_HANDLERS);

    expect(source).toMatch(
      /for_each\s*=\s*local\.deploy_lambda_handlers \? toset\(/,
    );
    expect(source).toMatch(
      /filename\s*=\s*local\.use_local_zips \? "\$\{var\.lambda_zips_dir\}\/\$\{each\.key\}\.zip" : null/,
    );
    expect(source).toMatch(
      /s3_bucket\s*=\s*local\.use_remote_lambda_artifacts \? var\.lambda_artifact_bucket : null/,
    );
    expect(source).toMatch(
      /s3_key\s*=\s*local\.use_remote_lambda_artifacts \? "\$\{local\.lambda_artifact_prefix\}\/\$\{each\.key\}\.zip" : null/,
    );
  });

  it("standalone Lambda resources also consume remote artifacts", () => {
    const source = read(LAMBDA_API_HANDLERS);

    for (const artifact of [
      "compliance-anchor",
      "compliance-anchor-watchdog",
      "compliance-export-runner",
      "workspace-files-efs",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `s3_key\\s*=\\s*local\\.use_remote_lambda_artifacts \\? "\\$\\{local\\.lambda_artifact_prefix\\}/${artifact}\\.zip" : null`,
        ),
      );
    }
  });

  it("dependent routes, queues, schedules, and outputs turn on for remote artifacts", () => {
    expect(read(LAMBDA_API_HANDLERS)).toMatch(
      /api_routes\s*=\s*local\.deploy_lambda_handlers \? \{/,
    );
    expect(read(LAMBDA_API_EVAL_FANOUT)).toMatch(
      /count\s*=\s*local\.deploy_lambda_handlers \? 1 : 0/,
    );
    expect(read(LAMBDA_API_WORKSPACE_EVENTS)).toMatch(
      /workspace_event_enabled\s*=\s*var\.enable_workspace_orchestration && local\.deploy_lambda_handlers/,
    );
    expect(read(LAMBDA_API_OUTPUTS)).toMatch(/output "lambda_artifact_mode"/);
    expect(read(LAMBDA_API_OUTPUTS)).toMatch(
      /local\.deploy_lambda_handlers \? aws_lambda_function\.handler\["memory-retain"\]/,
    );
  });

  it("the composite module and greenfield example surface enterprise artifact inputs", () => {
    expect(read(THINKWORK_VARIABLES)).toMatch(
      /variable "lambda_artifact_bucket"/,
    );
    expect(read(THINKWORK_VARIABLES)).toMatch(
      /variable "require_lambda_artifacts"/,
    );
    expect(read(THINKWORK_MAIN)).toMatch(
      /lambda_artifact_bucket\s*=\s*var\.lambda_artifact_bucket/,
    );
    expect(read(THINKWORK_MAIN)).toMatch(
      /require_lambda_artifacts\s*=\s*var\.require_lambda_artifacts/,
    );
    expect(read(THINKWORK_OUTPUTS)).toMatch(/output "lambda_artifact_mode"/);

    expect(read(GREENFIELD_MAIN)).toMatch(/variable "lambda_artifact_bucket"/);
    expect(read(GREENFIELD_MAIN)).toMatch(
      /lambda_artifact_prefix\s*=\s*var\.lambda_artifact_prefix/,
    );
    expect(read(GREENFIELD_TFVARS_EXAMPLE)).toMatch(
      /lambda_artifact_bucket\s*=\s*"customer-thinkwork-release-artifacts"/,
    );
    expect(read(GREENFIELD_TFVARS_EXAMPLE)).toMatch(
      /require_lambda_artifacts = true/,
    );
  });
});
