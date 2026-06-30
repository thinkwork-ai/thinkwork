import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "urql";
import {
  ComputerMemoryRetainAttemptsQuery,
  SpacesQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantMembersQuery } from "@/lib/settings-queries";
import { SettingsMemory, type MemoryRefreshController } from "./SettingsMemory";

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
    useQueryMock.mockImplementation(({ query, variables }: any) => {
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

      if (query === SpacesQuery) {
        return [
          {
            data: {
              spaces: [{ id: "space-1", name: "Launch Space", slug: "launch" }],
            },
            fetching: false,
          },
        ] as any;
      }

      if (query === SettingsTenantMembersQuery) {
        return [
          {
            data: {
              tenantMembers: [
                {
                  principalType: "USER",
                  principalId: "user-1",
                  user: {
                    id: "user-1",
                    name: "Eric Odom",
                    email: "eric@example.com",
                    profile: { callBy: "Eric" },
                  },
                },
              ],
            },
            fetching: false,
          },
        ] as any;
      }

      if (query === ComputerMemoryRetainAttemptsQuery) {
        return [
          {
            data: { memoryRetainAttempts: [] },
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
    expect(screen.queryByText("Updated")).toBeNull();
    expect(screen.getAllByText("Launch Space").length).toBeGreaterThan(0);
    expect(screen.getByText("Space: Launch Space")).toBeTruthy();
    expect(screen.getAllByText("Eric").length).toBeGreaterThan(0);
    expect(screen.getByText("User: Eric")).toBeTruthy();
    expect(screen.getByText("Space-bank memory")).toBeTruthy();
  });

  it("publishes a refresh controller that reloads records and retain diagnostics", async () => {
    const reexecuteRecordsQuery = vi.fn();
    const reexecuteRetainAttemptsQuery = vi.fn();
    const reexecuteOtherQuery = vi.fn();

    useQueryMock.mockImplementation(({ query, variables }: any) => {
      if (variables?.scope === "OPERATOR") {
        return [
          {
            data: { memoryRecords: [] },
            fetching: false,
          },
          reexecuteRecordsQuery,
        ] as any;
      }

      if (query === ComputerMemoryRetainAttemptsQuery) {
        return [
          {
            data: { memoryRetainAttempts: [] },
            fetching: false,
          },
          reexecuteRetainAttemptsQuery,
        ] as any;
      }

      return [
        {
          data:
            query === SpacesQuery
              ? { spaces: [] }
              : query === SettingsTenantMembersQuery
                ? { tenantMembers: [] }
                : {
                    memorySystemConfig: {
                      activeEngine: "hindsight",
                      hindsightEnabled: true,
                    },
                  },
          fetching: false,
        },
        reexecuteOtherQuery,
      ] as any;
    });

    let refreshController: MemoryRefreshController | null = null;
    render(
      <SettingsMemory
        embedded
        onRefreshControllerChange={(controller) => {
          refreshController = controller;
        }}
      />,
    );

    const controller = await waitFor(() => {
      if (!refreshController) throw new Error("refresh controller missing");
      return refreshController;
    });
    await controller.refresh();

    expect(reexecuteRecordsQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(reexecuteRetainAttemptsQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(reexecuteOtherQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("surfaces retrying retain diagnostics without replacing memory rows", () => {
    useQueryMock.mockImplementation(({ query, variables }: any) => {
      if (variables?.scope === "OPERATOR") {
        return [
          {
            data: {
              memoryRecords: [
                {
                  memoryRecordId: "user-memory",
                  content: { text: "User-bank memory" },
                  createdAt: "2026-06-27T10:00:00.000Z",
                  namespace: "user_user-1",
                  bankId: "user_user-1",
                  ownerType: "user",
                  ownerId: "user-1",
                  strategy: "semantic",
                },
              ],
            },
            fetching: false,
          },
        ] as any;
      }

      if (query === ComputerMemoryRetainAttemptsQuery) {
        return [
          {
            data: {
              memoryRetainAttempts: [
                { id: "attempt-1", status: "failed_timeout" },
                { id: "attempt-2", status: "dead_lettered" },
              ],
            },
            fetching: false,
          },
        ] as any;
      }

      return [
        {
          data:
            query === SettingsTenantMembersQuery
              ? { tenantMembers: [] }
              : query === SpacesQuery
                ? { spaces: [] }
                : { memorySystemConfig: { activeEngine: "hindsight" } },
          fetching: false,
        },
      ] as any;
    });

    render(<SettingsMemory embedded />);

    expect(screen.getByRole("status").textContent).toContain(
      "Memory retain status: 1 retrying, 1 dead-lettered",
    );
    expect(screen.getByText("User-bank memory")).toBeTruthy();
  });

  it("opens operator memory details without the requester forget action", () => {
    render(<SettingsMemory embedded />);

    fireEvent.click(screen.getByTestId("memory-row-space-memory"));

    expect(screen.getByText("Memory Detail")).toBeTruthy();
    expect(screen.getByText("space:space-1")).toBeTruthy();
    expect(screen.queryByText("Forget")).toBeNull();
  });

  it("shows a neutral empty state without engine-switching instructions", () => {
    useQueryMock.mockImplementation(({ variables }: { variables?: any }) => {
      if (variables?.scope === "OPERATOR") {
        return [{ data: { memoryRecords: [] }, fetching: false }] as any;
      }

      return [{ data: {}, fetching: false }] as any;
    });

    render(<SettingsMemory embedded />);

    expect(screen.getAllByText("No memory rows found").length).toBe(1);
    expect(
      screen.getByText(
        "This tenant does not have User, Space, or agent memory rows yet.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Memory service update required")).toBeNull();
    expect(
      screen.queryByText(/has not switched to Hindsight/i),
    ).toBeNull();
    expect(screen.queryByText(/MEMORY_ENGINE/i)).toBeNull();
    expect(screen.queryByText(/Redeploy required/i)).toBeNull();
    expect(screen.queryByText("Company distillation")).toBeNull();
    expect(screen.queryByText("Wiki projection")).toBeNull();
    expect(screen.queryByText("Cognee")).toBeNull();
  });
});
