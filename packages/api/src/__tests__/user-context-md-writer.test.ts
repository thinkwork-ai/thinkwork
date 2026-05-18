import { describe, expect, it } from "vitest";
import { renderUserContextMd } from "../lib/user-context-md-writer.js";

describe("renderUserContextMd", () => {
  it("renders USER.md for the user context root", () => {
    const rendered = renderUserContextMd({
      tenantName: "Acme",
      userName: "Eric Odom",
      email: "eric@example.com",
      phone: "+15551234567",
      title: "Founder",
      timezone: "America/Chicago",
      pronouns: "he/him",
      callBy: "Eric",
      notes: "Likes concise summaries.",
      family: "Family notes",
      context: "Local context belongs under the user prefix.",
      operatingModel: {
        layers: {
          rhythms: {
            entries: [
              {
                title: "Morning review",
                summary: "Prefers direct status and verification.",
                epistemicState: "confirmed",
              },
            ],
          },
        },
      },
    });

    expect(rendered).toContain("# USER.md - About Your Human");
    expect(rendered).toContain("- **Name:** Eric Odom");
    expect(rendered).toContain("- **What to call them:** Eric");
    expect(rendered).toContain("- **Timezone:** America/Chicago");
    expect(rendered).toContain("Local context belongs under the user prefix.");
    expect(rendered).toContain(
      "- **Morning review**: Prefers direct status and verification.",
    );
    expect(rendered).not.toContain("{{HUMAN_");
    expect(rendered).not.toContain("{{OPERATING_MODEL_");
  });

  it("renders missing profile fields as em dashes", () => {
    const rendered = renderUserContextMd({
      tenantName: "Acme",
      userName: null,
      email: null,
      phone: null,
      title: null,
      timezone: null,
      pronouns: null,
      callBy: null,
      notes: null,
      family: null,
      context: null,
      operatingModel: null,
    });

    expect(rendered).toContain("- **Name:** —");
    expect(rendered).toContain("- **What to call them:** —");
    expect(rendered).toContain("- **Phone:** —");
  });
});
