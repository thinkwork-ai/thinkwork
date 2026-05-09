import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BreadcrumbProvider, useBreadcrumbs, type Breadcrumb } from "./BreadcrumbContext";

function TitleSetter({ crumbs }: { crumbs: Breadcrumb[] }) {
  useBreadcrumbs(crumbs);
  return null;
}

beforeEach(() => {
  document.title = "ThinkWork";
});

afterEach(cleanup);

describe("BreadcrumbContext", () => {
  it("sets document.title to <label> · ThinkWork when a child registers a breadcrumb", () => {
    render(
      <BreadcrumbProvider>
        <TitleSetter crumbs={[{ label: "Computer" }]} />
      </BreadcrumbProvider>,
    );

    expect(document.title).toBe("Computer · ThinkWork");
  });

  it("persists the last registered title after the child unmounts (until a new registration)", () => {
    // Mirrors apps/admin's BreadcrumbContext: useBreadcrumbs has no cleanup
    // function, so the previous title remains until the next route registers
    // its own crumbs. In practice the next route's mount fires before the
    // user can observe the stale title.
    const { unmount } = render(
      <BreadcrumbProvider>
        <TitleSetter crumbs={[{ label: "Computer" }]} />
      </BreadcrumbProvider>,
    );

    expect(document.title).toBe("Computer · ThinkWork");

    unmount();

    expect(document.title).toBe("Computer · ThinkWork");
  });

  it("uses the latest registration when crumbs change", () => {
    const { rerender } = render(
      <BreadcrumbProvider>
        <TitleSetter crumbs={[{ label: "Computer" }]} />
      </BreadcrumbProvider>,
    );

    expect(document.title).toBe("Computer · ThinkWork");

    rerender(
      <BreadcrumbProvider>
        <TitleSetter crumbs={[{ label: "Apps" }]} />
      </BreadcrumbProvider>,
    );

    expect(document.title).toBe("Apps · ThinkWork");
  });

  it("leaves the static fallback in place when no child registers a breadcrumb", () => {
    document.title = "ThinkWork";

    render(<BreadcrumbProvider>{null}</BreadcrumbProvider>);

    expect(document.title).toBe("ThinkWork");
  });

  it("joins nested crumbs with the dot separator (deepest first)", () => {
    render(
      <BreadcrumbProvider>
        <TitleSetter
          crumbs={[
            { label: "Apps" },
            { label: "CRM Pipeline Risk" },
          ]}
        />
      </BreadcrumbProvider>,
    );

    expect(document.title).toBe("CRM Pipeline Risk · Apps · ThinkWork");
  });
});
