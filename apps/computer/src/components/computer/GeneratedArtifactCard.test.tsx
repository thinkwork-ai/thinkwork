import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratedArtifactCard } from "./GeneratedArtifactCard";

afterEach(cleanup);

describe("GeneratedArtifactCard", () => {
  it("routes app artifacts to the artifact route", () => {
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
      screen.getByRole("link", { name: /open artifact/i }).getAttribute("href"),
    ).toBe("/artifacts/artifact_123");
  });
});
