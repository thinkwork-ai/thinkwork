import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppsGalleryContent } from "./AppsGallery";
import { FIXTURE_APP_ARTIFACTS } from "@/lib/app-artifacts";

afterEach(cleanup);

describe("AppsGallery", () => {
  it("renders fixture app cards", () => {
    render(<AppsGalleryContent artifacts={FIXTURE_APP_ARTIFACTS} />);

    // Page title now lives in AppTopBar via PageHeaderContext.
    expect(screen.getByText("LastMile CRM pipeline risk")).toBeTruthy();
  });

  it("renders an empty state", () => {
    render(<AppsGalleryContent artifacts={[]} />);

    expect(screen.getByText(/Ask Computer to build an app/i)).toBeTruthy();
  });
});
