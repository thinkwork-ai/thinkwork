import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ComputerAssignmentSubjectType } from "@/gql/graphql";
import { buildComputerAssignmentTargets } from "@/lib/computer-assignment-utils";
import { parseBudgetDollarsToCents } from "./ComputerFormDialog";

const dialogSource = readFileSync(
  new URL("./ComputerFormDialog.tsx", import.meta.url),
  "utf8",
);

describe("ComputerFormDialog access UI", () => {
  it("offers user assignment without showing Teams", () => {
    expect(dialogSource).toContain("Initial Access");
    expect(dialogSource).toContain("TenantMembersListQuery");
    expect(dialogSource).not.toContain("TeamsListQuery");
    expect(dialogSource).not.toContain("selectedTeamIds");
    expect(dialogSource).toContain(
      "buildComputerAssignmentTargets(selectedUserIds, [])",
    );
  });
});

describe("buildComputerAssignmentTargets", () => {
  it("builds direct user assignment targets for new shared Computers", () => {
    expect(buildComputerAssignmentTargets(["user-1", "user-2"], [])).toEqual([
      {
        subjectType: ComputerAssignmentSubjectType.User,
        userId: "user-1",
        role: "member",
      },
      {
        subjectType: ComputerAssignmentSubjectType.User,
        userId: "user-2",
        role: "member",
      },
    ]);
  });

  it("deduplicates and drops empty assignment ids", () => {
    expect(
      buildComputerAssignmentTargets(
        [" user-1 ", "user-1", ""],
        ["team-1", "team-1", " "],
      ),
    ).toEqual([
      {
        subjectType: ComputerAssignmentSubjectType.User,
        userId: "user-1",
        role: "member",
      },
      {
        subjectType: ComputerAssignmentSubjectType.Team,
        teamId: "team-1",
        role: "member",
      },
    ]);
  });
});

describe("parseBudgetDollarsToCents", () => {
  it("returns null for empty input (treats as 'unbounded')", () => {
    expect(parseBudgetDollarsToCents(undefined)).toBeNull();
    expect(parseBudgetDollarsToCents("")).toBeNull();
    expect(parseBudgetDollarsToCents("   ")).toBeNull();
  });

  it("converts whole dollars to cents", () => {
    expect(parseBudgetDollarsToCents("50")).toBe(5000);
    expect(parseBudgetDollarsToCents("100")).toBe(10000);
  });

  it("rounds fractional dollars to nearest cent", () => {
    expect(parseBudgetDollarsToCents("12.34")).toBe(1234);
    expect(parseBudgetDollarsToCents("12.345")).toBe(1235);
    expect(parseBudgetDollarsToCents("12.344")).toBe(1234);
  });

  it("rejects negative values as null (admin chose to clear)", () => {
    expect(parseBudgetDollarsToCents("-5")).toBeNull();
  });

  it("rejects non-numeric strings as null", () => {
    expect(parseBudgetDollarsToCents("abc")).toBeNull();
    expect(parseBudgetDollarsToCents("$50")).toBeNull();
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseBudgetDollarsToCents("  50  ")).toBe(5000);
  });
});
