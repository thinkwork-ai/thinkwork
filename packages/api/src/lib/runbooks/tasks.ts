import type { RunbookDefinition } from "./definition.js";

export type ExpandedRunbookTask = {
  phaseId: string;
  phaseTitle: string;
  taskKey: string;
  title: string;
  summary: string | null;
  dependsOn: string[];
  capabilityRoles: string[];
  sortOrder: number;
  details: Record<string, unknown> | null;
};

export function expandRunbookTasks(
  runbook: RunbookDefinition,
): ExpandedRunbookTask[] {
  const phaseTaskKeys = new Map<string, string[]>();
  const tasks: ExpandedRunbookTask[] = [];

  for (const phase of runbook.phases) {
    const ownKeys: string[] = [];
    const dependencyTaskKeys = phase.dependsOn.flatMap(
      (phaseId) => phaseTaskKeys.get(phaseId) ?? [],
    );

    phase.taskSeeds.forEach((seed, index) => {
      const taskKey = `${phase.id}:${index + 1}`;
      ownKeys.push(taskKey);
      tasks.push({
        phaseId: phase.id,
        phaseTitle: phase.title,
        taskKey,
        title: seed,
        summary: null,
        dependsOn: dependencyTaskKeys,
        capabilityRoles: phase.capabilityRoles,
        sortOrder: tasks.length + 1,
        details: phase.supervision ? { supervision: phase.supervision } : null,
      });
    });

    phaseTaskKeys.set(phase.id, ownKeys);
  }

  return tasks;
}

export function assertExpandedTasksReferenceDeclaredPhases(
  runbook: RunbookDefinition,
  tasks: ExpandedRunbookTask[],
): void {
  const phaseIds = new Set(runbook.phases.map((phase) => phase.id));
  const taskKeys = new Set(tasks.map((task) => task.taskKey));
  for (const task of tasks) {
    if (!phaseIds.has(task.phaseId)) {
      throw new Error(
        `Expanded runbook task ${task.taskKey} references unknown phase ${task.phaseId}`,
      );
    }
    for (const dependency of task.dependsOn) {
      if (!taskKeys.has(dependency)) {
        throw new Error(
          `Expanded runbook task ${task.taskKey} depends on unknown task ${dependency}`,
        );
      }
    }
  }
}
