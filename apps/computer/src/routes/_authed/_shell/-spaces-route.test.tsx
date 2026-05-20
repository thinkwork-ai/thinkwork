import { describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((options: unknown) => ({ redirect: options })),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  redirect: redirectMock,
}));

import { Route as SpaceDetailRoute } from "./spaces.$spaceId";
import { Route as SpacesIndexRoute } from "./spaces.index";

describe("Spaces routes", () => {
  it("redirects the legacy Spaces index to the new-thread page", () => {
    let thrown: unknown;

    try {
      (
        SpacesIndexRoute as unknown as {
          beforeLoad: () => void;
        }
      ).beforeLoad();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual({
      redirect: { to: "/new", replace: true },
    });
  });

  it("redirects a legacy Space detail page to the new-thread page", () => {
    let thrown: unknown;

    try {
      (
        SpaceDetailRoute as unknown as {
          beforeLoad: (args: { params: { spaceId: string } }) => void;
        }
      ).beforeLoad({ params: { spaceId: "space-1" } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual({
      redirect: {
        to: "/new",
        replace: true,
      },
    });
  });
});
