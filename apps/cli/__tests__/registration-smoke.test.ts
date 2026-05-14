import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";

// Import every stub registrar directly — parallels cli.ts but lets us isolate
// each domain tree without running `program.parse()`.
import { registerThreadCommand } from "../src/commands/thread.js";
import { registerMessageCommand } from "../src/commands/message.js";
import { registerLabelCommand } from "../src/commands/label.js";
import { registerInboxCommand } from "../src/commands/inbox.js";
import { registerAgentCommand } from "../src/commands/agent.js";
import { registerComputerCommand } from "../src/commands/computer.js";
import { registerTemplateCommand } from "../src/commands/template.js";
import { registerTenantCommand } from "../src/commands/tenant.js";
import { registerMemberCommand } from "../src/commands/member.js";
import { registerTeamCommand } from "../src/commands/team.js";
import { registerKbCommand } from "../src/commands/kb.js";
import { registerRoutineCommand } from "../src/commands/routine.js";
import { registerScheduledJobCommand } from "../src/commands/scheduled-job.js";
import { registerTurnCommand } from "../src/commands/turn.js";
import { registerWakeupCommand } from "../src/commands/wakeup.js";
import { registerWebhookCommand } from "../src/commands/webhook.js";
import { registerSkillCommand } from "../src/commands/skill.js";
import { registerMemoryCommand } from "../src/commands/memory.js";
import { registerRecipeCommand } from "../src/commands/recipe.js";
import { registerArtifactCommand } from "../src/commands/artifact.js";
import { registerCostCommand } from "../src/commands/cost.js";
import { registerBudgetCommand } from "../src/commands/budget.js";
import { registerPerformanceCommand } from "../src/commands/performance.js";
import { registerTraceCommand } from "../src/commands/trace.js";
import { registerDashboardCommand } from "../src/commands/dashboard.js";

interface DomainCase {
  domain: string;
  phase: 1 | 2 | 3 | 4 | 5;
  register: (program: Command) => void;
  // A representative subcommand we expect under this domain. If this changes,
  // update the taxonomy in apps/cli/README.md#roadmap.
  expectedSubcommand: string;
}

const DOMAINS: DomainCase[] = [
  {
    domain: "thread",
    phase: 1,
    register: registerThreadCommand,
    expectedSubcommand: "list",
  },
  {
    domain: "message",
    phase: 1,
    register: registerMessageCommand,
    expectedSubcommand: "send",
  },
  {
    domain: "label",
    phase: 1,
    register: registerLabelCommand,
    expectedSubcommand: "create",
  },
  {
    domain: "inbox",
    phase: 1,
    register: registerInboxCommand,
    expectedSubcommand: "approve",
  },
  {
    domain: "agent",
    phase: 2,
    register: registerAgentCommand,
    expectedSubcommand: "list",
  },
  {
    domain: "computer",
    phase: 2,
    register: registerComputerCommand,
    expectedSubcommand: "migration",
  },
  {
    domain: "template",
    phase: 2,
    register: registerTemplateCommand,
    expectedSubcommand: "sync-all",
  },
  {
    domain: "tenant",
    phase: 2,
    register: registerTenantCommand,
    expectedSubcommand: "create",
  },
  {
    domain: "member",
    phase: 2,
    register: registerMemberCommand,
    expectedSubcommand: "invite",
  },
  {
    domain: "team",
    phase: 2,
    register: registerTeamCommand,
    expectedSubcommand: "add-agent",
  },
  {
    domain: "kb",
    phase: 2,
    register: registerKbCommand,
    expectedSubcommand: "sync",
  },
  {
    domain: "routine",
    phase: 3,
    register: registerRoutineCommand,
    expectedSubcommand: "trigger",
  },
  {
    domain: "scheduled-job",
    phase: 3,
    register: registerScheduledJobCommand,
    expectedSubcommand: "run",
  },
  {
    domain: "turn",
    phase: 3,
    register: registerTurnCommand,
    expectedSubcommand: "cancel",
  },
  {
    domain: "wakeup",
    phase: 3,
    register: registerWakeupCommand,
    expectedSubcommand: "create",
  },
  {
    domain: "webhook",
    phase: 3,
    register: registerWebhookCommand,
    expectedSubcommand: "rotate",
  },
  {
    domain: "skill",
    phase: 3,
    register: registerSkillCommand,
    expectedSubcommand: "install",
  },
  {
    domain: "memory",
    phase: 4,
    register: registerMemoryCommand,
    expectedSubcommand: "search",
  },
  {
    domain: "recipe",
    phase: 4,
    register: registerRecipeCommand,
    expectedSubcommand: "create",
  },
  {
    domain: "artifact",
    phase: 4,
    register: registerArtifactCommand,
    expectedSubcommand: "list",
  },
  {
    domain: "cost",
    phase: 5,
    register: registerCostCommand,
    expectedSubcommand: "summary",
  },
  {
    domain: "budget",
    phase: 5,
    register: registerBudgetCommand,
    expectedSubcommand: "upsert",
  },
  {
    domain: "performance",
    phase: 5,
    register: registerPerformanceCommand,
    expectedSubcommand: "agents",
  },
  {
    domain: "trace",
    phase: 5,
    register: registerTraceCommand,
    expectedSubcommand: "thread",
  },
];

describe("stub registration (taxonomy smoke test)", () => {
  it.each(DOMAINS)(
    "registers `$domain` with a representative `$expectedSubcommand` subcommand",
    ({ domain, register, expectedSubcommand }) => {
      const program = new Command();
      register(program);

      const domainCmd = program.commands.find(
        (c) => c.name() === domain || c.aliases().includes(domain),
      );
      expect(domainCmd, `domain "${domain}" is registered`).toBeTruthy();
      expect(domainCmd!.description()).toBeTruthy();

      const hasSub = findSubcommand(domainCmd!, expectedSubcommand);
      expect(hasSub, `"${domain} ${expectedSubcommand}" exists`).toBeTruthy();
      expect(hasSub!.description()).toBeTruthy();
    },
  );

  it("dashboard is a leaf command (not a domain group)", () => {
    const program = new Command();
    registerDashboardCommand(program);
    const dash = program.commands.find((c) => c.name() === "dashboard");
    expect(dash).toBeTruthy();
    expect(dash!.description()).toBeTruthy();
    // Leaves shouldn't nest subcommands.
    expect(dash!.commands.length).toBe(0);
  });

  it("computer migration commands accept --tenant and --tenant-id aliases", () => {
    const program = new Command();
    registerComputerCommand(program);
    const computer = program.commands.find((c) => c.name() === "computer")!;
    const migration = computer.commands.find((c) => c.name() === "migration")!;

    for (const commandName of ["dry-run", "apply"]) {
      const command = migration.commands.find((c) => c.name() === commandName)!;
      expect(command.options.map((option) => option.long)).toEqual(
        expect.arrayContaining(["--tenant", "--tenant-id"]),
      );
    }
  });

  it("every stub action exits with code 2 when invoked", async () => {
    const program = new Command();
    // A couple of representative stubs from different phases.
    registerThreadCommand(program);
    registerAgentCommand(program);
    registerDashboardCommand(program);

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    // Disable Commander's default exit-on-success/help so parseAsync hands
    // control back to us.
    program.exitOverride();

    // Run one subcommand from each phase.
    await program
      .parseAsync(["node", "thinkwork", "thread", "list"])
      .catch(() => undefined);
    await program
      .parseAsync(["node", "thinkwork", "agent", "list"])
      .catch(() => undefined);
    await program
      .parseAsync(["node", "thinkwork", "dashboard"])
      .catch(() => undefined);

    // Each stub should have called process.exit(2).
    expect(exitSpy).toHaveBeenCalledWith(2);

    const combinedStderr = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");
    expect(combinedStderr).toContain("not yet implemented");
    expect(combinedStderr).toContain("apps/cli/README.md#roadmap");

    vi.restoreAllMocks();
  });

  it("covers 24 domain groups and 1 leaf command for a total of 25 Phase-0 scaffolds", () => {
    // Guards against accidental drops when someone deletes a register() import.
    expect(DOMAINS.length).toBe(24);
  });
});

function findSubcommand(parent: Command, name: string): Command | undefined {
  // Sub-groups (like `agent budget`) can nest — walk two levels deep.
  for (const child of parent.commands) {
    if (child.name() === name || child.aliases().includes(name)) return child;
    for (const grand of child.commands) {
      if (grand.name() === name || grand.aliases().includes(name)) return grand;
    }
  }
  return undefined;
}
