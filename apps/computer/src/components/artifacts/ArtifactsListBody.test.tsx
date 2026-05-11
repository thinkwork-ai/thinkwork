import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactsListBody } from "./ArtifactsListBody";
import type { ArtifactItem } from "./artifacts-filtering";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const items: ArtifactItem[] = [
  {
    id: "a1",
    artifactId: "artifact-a1",
    title: "LastMile CRM pipeline risk",
    kind: "applet",
    modelId: "claude-opus-4-7",
    stdlibVersion: "0.1.0",
    generatedAt: "2026-05-08T16:00:00.000Z",
    favoritedAt: null,
    version: 1,
  },
  {
    id: "a2",
    artifactId: "artifact-a2",
    title: "Austin Map",
    kind: "applet",
    modelId: "claude-sonnet-4-6",
    stdlibVersion: "0.1.0",
    generatedAt: "2026-05-09T11:00:00.000Z",
    favoritedAt: null,
    version: 2,
  },
  {
    id: "c1",
    artifactId: "artifact-c1",
    title: "Pipeline chart",
    kind: "chart",
    modelId: null,
    stdlibVersion: null,
    generatedAt: "",
    favoritedAt: null,
    version: null,
  },
];

beforeEach(() => {
  navigateMock.mockReset();
});

afterEach(cleanup);

function rowFor(name: string): HTMLElement {
  const cell = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid="artifacts-table-row"]',
    ),
  ).find((el) => el.textContent?.includes(name));
  if (!cell) throw new Error(`Row containing "${name}" not found`);
  // Click the parent <tr> so DataTable's onRowClick fires.
  const row = cell.closest("tr");
  if (!row) throw new Error(`No <tr> ancestor for row "${name}"`);
  return row as HTMLElement;
}

function bodyRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid="artifacts-table"] tbody tr',
    ),
  );
}

describe("ArtifactsListBody", () => {
  it("renders an empty state message when items is empty", () => {
    render(<ArtifactsListBody items={[]} />);
    expect(
      screen.getByTestId("artifacts-table-empty").textContent,
    ).toMatch(/Ask Computer to create an artifact/i);
  });

  it("renders an error state when errorMessage is set and items is empty", () => {
    render(<ArtifactsListBody items={[]} errorMessage="boom" />);
    expect(screen.getByTestId("artifacts-error").textContent).toMatch(
      /boom/,
    );
  });

  it("renders a loading shell when fetching with no rows", () => {
    render(<ArtifactsListBody items={[]} fetching />);
    expect(screen.getByTestId("artifacts-loading").textContent).toMatch(
      /Loading artifacts/i,
    );
  });

  it("renders one row per item", () => {
    render(<ArtifactsListBody items={items} />);
    expect(bodyRows()).toHaveLength(3);
  });

  it("filters by title text in the search input", () => {
    render(<ArtifactsListBody items={items} />);
    const search = screen.getByTestId(
      "artifacts-search",
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "lastmile" } });
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toMatch(/LastMile/);
  });

  it("filters by modelId text even when title doesn't contain it", () => {
    render(<ArtifactsListBody items={items} />);
    const search = screen.getByTestId(
      "artifacts-search",
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "sonnet" } });
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toMatch(/Austin Map/);
  });

  it("renders the toolbar with search left, tabs centered, kind dropdown right", () => {
    render(<ArtifactsListBody items={items} />);
    const toolbar = screen.getByTestId("artifacts-toolbar");
    expect(toolbar.querySelector('[data-testid="artifacts-search"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-testid="artifacts-tabs"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-testid="artifacts-kind"]')).not.toBeNull();
  });

  it("forwards row clicks to the artifact viewer route", () => {
    render(<ArtifactsListBody items={items} />);
    fireEvent.click(rowFor("Austin Map"));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/artifacts/a2" });
  });
});
