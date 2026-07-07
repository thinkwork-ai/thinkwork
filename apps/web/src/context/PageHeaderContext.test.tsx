/**
 * Header-ownership regression tests for the /artifacts/$id blank-header bug:
 * a parent route that delegates its header (passes null) must not clobber
 * the child's registration, and stale cleanups must not clear a newer
 * registration (child effects run before parent effects).
 */

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PageHeaderProvider,
  usePageHeader,
  usePageHeaderActions,
} from "./PageHeaderContext";

function HeaderProbe() {
  const { actions } = usePageHeader();
  return (
    <div data-testid="probe">
      <span data-testid="probe-title">{actions?.title ?? "(none)"}</span>
      <span data-testid="probe-action">{actions?.action ?? "(no action)"}</span>
    </div>
  );
}

function Child({ title, action }: { title: string; action: string }) {
  usePageHeaderActions({ title, action, actionKey: title });
  return null;
}

function DelegatingParent({ children }: { children: React.ReactNode }) {
  // Parent relinquishes the header — its effect runs AFTER the child's.
  usePageHeaderActions(null);
  return <>{children}</>;
}

function RegisteringParent({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  usePageHeaderActions({ title });
  return <>{children}</>;
}

afterEach(cleanup);

describe("usePageHeaderActions ownership", () => {
  it("a delegating (null) parent does not clobber the child's header", () => {
    render(
      <PageHeaderProvider>
        <DelegatingParent>
          <Child title="Document" action="Share" />
        </DelegatingParent>
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    expect(screen.getByTestId("probe-title").textContent).toBe("Document");
    expect(screen.getByTestId("probe-action").textContent).toBe("Share");
  });

  it("a registering parent still wins last (documents the non-delegating shape)", () => {
    render(
      <PageHeaderProvider>
        <RegisteringParent title="Parent">
          <Child title="Document" action="Share" />
        </RegisteringParent>
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    // Parent effects run after child effects — this is exactly why a parent
    // that does not own the header must pass null instead of registering.
    expect(screen.getByTestId("probe-title").textContent).toBe("Parent");
  });

  it("unmounting a stale registrant does not clear a newer registration", () => {
    const { rerender } = render(
      <PageHeaderProvider>
        <Child title="Old" action="A" />
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    rerender(
      <PageHeaderProvider>
        <Child title="New" action="B" />
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    expect(screen.getByTestId("probe-title").textContent).toBe("New");
  });

  it("unmounting the current registrant clears the header", () => {
    const { rerender } = render(
      <PageHeaderProvider>
        <Child title="Only" action="A" />
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    rerender(
      <PageHeaderProvider>
        <HeaderProbe />
      </PageHeaderProvider>,
    );
    expect(screen.getByTestId("probe-title").textContent).toBe("(none)");
  });
});
