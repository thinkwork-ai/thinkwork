import {
  ComputerAssignmentAccessSource,
  ComputerAssignmentSubjectType,
  type ComputerAssignmentTargetInput,
} from "@/gql/graphql";

export const COMPUTER_ASSIGNMENT_ROLE = "member";

export function buildComputerAssignmentTargets(
  userIds: string[],
  teamIds: string[],
): ComputerAssignmentTargetInput[] {
  return [
    ...uniqueNonEmpty(userIds).map((userId) => ({
      subjectType: ComputerAssignmentSubjectType.User,
      userId,
      role: COMPUTER_ASSIGNMENT_ROLE,
    })),
    ...uniqueNonEmpty(teamIds).map((teamId) => ({
      subjectType: ComputerAssignmentSubjectType.Team,
      teamId,
      role: COMPUTER_ASSIGNMENT_ROLE,
    })),
  ];
}

export function accessSourceLabel(
  source: ComputerAssignmentAccessSource | string,
): string {
  switch (source) {
    case ComputerAssignmentAccessSource.Direct:
      return "Direct";
    case ComputerAssignmentAccessSource.Team:
      return "Team";
    case ComputerAssignmentAccessSource.Both:
      return "Direct + Team";
    default:
      return String(source).replace(/_/g, " ");
  }
}

export function assignmentSummary(directCount: number, teamCount: number) {
  const pieces = [];
  if (directCount > 0) {
    pieces.push(`${directCount} user${directCount === 1 ? "" : "s"}`);
  }
  if (teamCount > 0) {
    pieces.push(`${teamCount} Team${teamCount === 1 ? "" : "s"}`);
  }
  return pieces.length > 0 ? pieces.join(" + ") : "No access assigned";
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
