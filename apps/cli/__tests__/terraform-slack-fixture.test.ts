import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const HANDLERS_TF = resolve(
  REPO_ROOT,
  "terraform/modules/app/lambda-api/handlers.tf",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Slack Terraform handler environment", () => {
  it("passes Slack app credentials to GraphQL and Slack OAuth handlers", () => {
    const source = read(HANDLERS_TF);

    expect(source).toContain("SLACK_APP_CREDENTIALS_SECRET_ARN");
    expect(source).toMatch(/"oauth-authorize"\s+= local\.slack_handler_env/);
    expect(source).toMatch(/"oauth-callback"\s+= local\.slack_handler_env/);
    expect(source).toMatch(
      /"graphql-http"\s+= merge\(local\.slack_handler_env,/,
    );
  });
});
