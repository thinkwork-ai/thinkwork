import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppPreviewCard } from "./AppPreviewCard";
import { FIXTURE_APP_ARTIFACTS } from "@/lib/app-artifacts";

afterEach(cleanup);

describe("AppPreviewCard", () => {
  it("renders a generated app preview and routes to split-view detail", () => {
    render(<AppPreviewCard artifact={FIXTURE_APP_ARTIFACTS[0]} />);

    expect(screen.getByText("LastMile CRM pipeline risk")).toBeTruthy();
    expect(screen.getByText("crm: success")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/apps/artifact-crm-pipeline-risk-fixture",
    );
  });
});
