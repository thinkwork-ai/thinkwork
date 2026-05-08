import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratedArtifactCard } from "./GeneratedArtifactCard";

afterEach(cleanup);

describe("GeneratedArtifactCard", () => {
  it("routes dashboard app artifacts to the generated app route", () => {
    render(
      <GeneratedArtifactCard
        artifact={{
          id: "artifact_123",
          title: "CRM pipeline risk",
          type: "DATA_VIEW",
          summary: "Pipeline risk dashboard",
          metadata: { kind: "research_dashboard" },
        }}
      />,
    );

    expect(screen.getByText("CRM pipeline risk")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open app/i }).getAttribute("href"),
    ).toBe("/apps/artifact_123");
  });
});
