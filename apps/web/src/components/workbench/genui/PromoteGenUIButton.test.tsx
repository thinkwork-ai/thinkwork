import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromoteGenUIButton } from "./PromoteGenUIButton";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    ...props
  }: {
    children: ReactNode;
    params: { id: string };
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={`/artifacts/${params.id}`} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("PromoteGenUIButton", () => {
  it("submits promotion from the idle state", () => {
    const onPromote = vi.fn();
    render(
      <PromoteGenUIButton
        status={{ state: "idle" }}
        onPromote={onPromote}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Save as artifact/ }));

    expect(onPromote).toHaveBeenCalledTimes(1);
  });

  it("renders an artifact link after promotion", () => {
    render(
      <PromoteGenUIButton
        status={{
          state: "promoted",
          artifactId: "artifact-1",
          title: "Snapshot",
        }}
        onPromote={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: /Open saved artifact/ }).getAttribute(
        "href",
      ),
    ).toBe("/artifacts/artifact-1");
  });

  it("keeps failed promotion retryable", () => {
    const onPromote = vi.fn();
    render(
      <PromoteGenUIButton
        status={{ state: "error", message: "Conflict" }}
        onPromote={onPromote}
      />,
    );

    expect(screen.getByText("Conflict")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save as artifact/ }));
    expect(onPromote).toHaveBeenCalledTimes(1);
  });
});
