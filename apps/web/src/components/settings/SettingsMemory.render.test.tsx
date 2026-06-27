import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "urql";
import { SettingsMemory } from "./SettingsMemory";

vi.mock("urql", () => ({
  useQuery: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@thinkwork/graph", () => ({
  MemoryGraph: React.forwardRef<HTMLDivElement>(
    function MemoryGraphMock(_props, ref) {
      return <div ref={ref}>Graph</div>;
    },
  ),
}));

vi.mock("@thinkwork/ui", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Sheet: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetDescription: ({ children }: { children?: React.ReactNode }) => (
    <p>{children}</p>
  ),
  SheetHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTitle: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  ToggleGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToggleGroupItem: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialog: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => (
    <button>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => (
    <h3>{children}</h3>
  ),
  AlertDialogTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DataTable: ({
    columns,
    data,
    onRowClick,
  }: {
    columns: Array<any>;
    data: Array<any>;
    onRowClick?: (row: any) => void;
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={String(column.accessorKey)}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr
            key={row.memoryRecordId}
            data-testid={`memory-row-${row.memoryRecordId}`}
            onClick={() => onRowClick?.(row)}
          >
            {columns.map((column) => (
              <td key={String(column.accessorKey)}>
                {column.cell
                  ? column.cell({ row: { original: row } })
                  : row[column.accessorKey]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

const useQueryMock = vi.mocked(useQuery);

describe("SettingsMemory render", () => {
  beforeEach(() => {
    useQueryMock.mockImplementation(({ variables }: { variables?: any }) => {
      if (variables?.scope === "OPERATOR") {
        return [
          {
            data: {
              memoryRecords: [
                {
                  memoryRecordId: "space-memory",
                  content: { text: "Space-bank memory" },
                  createdAt: "2026-06-27T11:00:00.000Z",
                  updatedAt: "2026-06-27T11:15:00.000Z",
                  namespace: "space_space-1",
                  bankId: "space_space-1",
                  ownerType: "space",
                  ownerId: "space-1",
                  strategy: "semantic",
                  strategyId: "world",
                  factType: "world",
                  accessCount: 0,
                },
                {
                  memoryRecordId: "user-memory",
                  content: { text: "User-bank memory" },
                  createdAt: "2026-06-27T10:00:00.000Z",
                  updatedAt: "2026-06-27T10:00:00.000Z",
                  namespace: "user_user-1",
                  bankId: "user_user-1",
                  ownerType: "user",
                  ownerId: "user-1",
                  strategy: "semantic",
                  strategyId: "world",
                  factType: "world",
                  accessCount: 0,
                },
              ],
            },
            fetching: false,
          },
        ] as any;
      }

      return [
        {
          data: {
            memorySystemConfig: {
              activeEngine: "hindsight",
              hindsightEnabled: true,
              userMemoryEnabled: true,
              spaceMemoryEnabled: true,
            },
          },
          fetching: false,
        },
      ] as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders operator-visible Hindsight rows with bank and owner evidence", () => {
    render(<SettingsMemory embedded />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          tenantId: "tenant-1",
          namespace: "requester",
          scope: "OPERATOR",
          limit: 500,
        }),
      }),
    );
    expect(screen.getByText("Bank")).toBeTruthy();
    expect(screen.getByText("Scope")).toBeTruthy();
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(screen.getByText("space_space-1")).toBeTruthy();
    expect(screen.getByText("space:space-1")).toBeTruthy();
    expect(screen.getByText("Space-bank memory")).toBeTruthy();
  });

  it("opens operator memory details without the requester forget action", () => {
    render(<SettingsMemory embedded />);

    fireEvent.click(screen.getByTestId("memory-row-space-memory"));

    expect(screen.getByText("Memory Detail")).toBeTruthy();
    expect(screen.getAllByText("space:space-1").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.queryByText("Forget")).toBeNull();
  });

  it("explains when Hindsight is available but not the active engine without naming the legacy backend", () => {
    useQueryMock.mockImplementation(({ variables }: { variables?: any }) => {
      if (variables?.scope === "OPERATOR") {
        return [{ data: { memoryRecords: [] }, fetching: false }] as any;
      }

      return [
        {
          data: {
            memorySystemConfig: {
              activeEngine: "cognee",
              hindsightEnabled: false,
              cogneeMemoryEnabled: true,
              userMemoryEnabled: true,
              spaceMemoryEnabled: true,
              legacyHindsightAvailable: true,
            },
          },
          fetching: false,
        },
      ] as any;
    });

    render(<SettingsMemory embedded />);

    expect(screen.getAllByText("Memory service update required").length).toBe(
      2,
    );
    expect(screen.getByText("Redeploy required")).toBeTruthy();
    expect(screen.queryByText("Company distillation")).toBeNull();
    expect(screen.queryByText("Wiki projection")).toBeNull();
    expect(screen.queryByText("Cognee")).toBeNull();
  });
});
