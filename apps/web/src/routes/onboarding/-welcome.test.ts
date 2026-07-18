import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/routes/onboarding/welcome.tsx"),
  "utf8",
);

describe("onboarding welcome route", () => {
  it("uses the no-checkout path for browser-first deployment sessions", () => {
    expect(source).toContain("NewEnvironmentInstaller");
    expect(source).toContain("createDeploymentSession");
    expect(source).toContain("startDeploymentSession");
    expect(source).toContain("connectDeploymentSessionCredentialLease");
    expect(source).toContain("CredentialLeaseForm");
    expect(source).toContain("Validate AWS connection");
    expect(source).toContain("Start deployment");
    expect(source).toContain("requestDeploymentSessionTeardown");
    expect(source).toContain("DEPLOYMENT_SESSION_STORAGE_KEY");
    expect(source).toContain("State starts in the ThinkWork control plane");
    expect(source).toContain("Teardown");
  });

  it("keeps bootstrap credential material out of local storage", () => {
    const storeResumeBody = source.match(
      /function storeResume\(resume: DeploymentSessionResume\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(storeResumeBody).toContain("JSON.stringify(resume)");
    expect(storeResumeBody).not.toContain("accessKeyId");
    expect(storeResumeBody).not.toContain("secretAccessKey");
    expect(storeResumeBody).not.toContain("sessionToken");
    expect(storeResumeBody).not.toContain("roleArn");
    expect(source).toContain(
      "Credentials are sent once to the server-side lease vault",
    );
  });

  it("requires exact link-and-code enrollment after checkout", () => {
    expect(source).toContain("Payment confirmed");
    expect(source).toContain("secure enrollment link");
    expect(source).toContain("one-time");
    expect(source).toContain("code. Both factors are required");
    expect(source).toContain("TenantSlugPicker");
    expect(source).toContain("SettingsRenameTenantSlugMutation");
    expect(source).not.toContain("OnboardingBootstrapUser");
    expect(source).not.toContain("bootstrapUser");
  });
});
