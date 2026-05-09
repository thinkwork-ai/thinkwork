import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppsGallery } from "./AppsGallery";

afterEach(cleanup);

describe("AppsGallery", () => {
  it("renders fixture app cards", () => {
    render(<AppsGallery />);

    // Page title now lives in AppTopBar via PageHeaderContext.
    expect(screen.getByText("LastMile CRM pipeline risk")).toBeTruthy();
  });

  it("renders an empty state", () => {
    render(<AppsGallery artifacts={[]} />);

    expect(screen.getByText(/Ask Computer to build a dashboard/i)).toBeTruthy();
  });
});
