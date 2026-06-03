import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { SettingsAppStyle } from "./SettingsAppStyle";

vi.mock("urql", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: vi.fn(),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

const mutateMock = vi.fn();
const refetchMock = vi.fn();

const VALID_CSS =
  ":root { --background: oklch(1 0 0); --chart-1: oklch(0.6 0.2 30); }";

function setFeatures(features: unknown) {
  vi.mocked(useQuery).mockReturnValue([
    {
      data: { tenant: { id: "t1", settings: { id: "s1", features } } },
      fetching: false,
      stale: false,
    },
    refetchMock,
  ] as unknown as ReturnType<typeof useQuery>);
}

beforeEach(() => {
  mutateMock.mockReset();
  refetchMock.mockReset();
  mutateMock.mockResolvedValue({
    data: { updateTenantSettings: { id: "s1" } },
  });
  vi.mocked(useTenant).mockReturnValue({
    tenantId: "t1",
    isOperator: true,
    roleResolved: true,
  } as ReturnType<typeof useTenant>);
  vi.mocked(useMutation).mockReturnValue([
    { fetching: false, stale: false } as ReturnType<typeof useMutation>[0],
    mutateMock,
  ] as unknown as ReturnType<typeof useMutation>);
  setFeatures(null);
});

afterEach(cleanup);

describe("SettingsAppStyle", () => {
  it("renders an empty first-use state with Save and Clear disabled", () => {
    render(<SettingsAppStyle />);
    const textarea = screen.getByTestId(
      "app-style-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    expect(
      (screen.getByTestId("app-style-save") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("app-style-clear") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("saves valid CSS through the mutation with the theme nested in features", async () => {
    render(<SettingsAppStyle />);
    fireEvent.change(screen.getByTestId("app-style-textarea"), {
      target: { value: VALID_CSS },
    });
    const save = screen.getByTestId("app-style-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const call = mutateMock.mock.calls[0][0];
    expect(call.tenantId).toBe("t1");
    const features = JSON.parse(call.input.features);
    expect(features.artifactStyle.appletTheme.css).toContain("--background");
    await vi.waitFor(() =>
      expect(refetchMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      }),
    );
  });

  it("blocks save and shows an error when CSS exceeds 20,000 chars", () => {
    render(<SettingsAppStyle />);
    const huge = `:root { --x: ${"a".repeat(20_001)}; }`;
    fireEvent.change(screen.getByTestId("app-style-textarea"), {
      target: { value: huge },
    });
    expect(screen.getByTestId("app-style-error").textContent).toMatch(
      /exceeds 20,000 characters/i,
    );
    expect(
      (screen.getByTestId("app-style-save") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByTestId("app-style-save"));
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("rejects CSS with no :root/.dark token block on save without firing the mutation", () => {
    render(<SettingsAppStyle />);
    fireEvent.change(screen.getByTestId("app-style-textarea"), {
      target: { value: "body { color: red; }" },
    });
    fireEvent.click(screen.getByTestId("app-style-save"));
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("app-style-error")).toBeTruthy();
  });

  it("pre-fills the editor and enables Clear when a theme is already set", () => {
    setFeatures({ artifactStyle: { appletTheme: { css: VALID_CSS } } });
    render(<SettingsAppStyle />);
    expect(
      (screen.getByTestId("app-style-textarea") as HTMLTextAreaElement).value,
    ).toBe(VALID_CSS);
    expect(
      (screen.getByTestId("app-style-clear") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("clears an existing theme by writing features without appletTheme", async () => {
    setFeatures({ artifactStyle: { appletTheme: { css: VALID_CSS } } });
    render(<SettingsAppStyle />);
    fireEvent.click(screen.getByTestId("app-style-clear"));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const features = JSON.parse(mutateMock.mock.calls[0][0].input.features);
    expect(features.artifactStyle.appletTheme).toBeUndefined();
    await vi.waitFor(() =>
      expect(refetchMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      }),
    );
  });
});
