/**
 * Figures for the Agents section (THINK-696).
 *
 * Four pictures the prose cannot carry on its own:
 *  - AgentFolderTreeDiagram — the one recursive shape, and where the
 *    recursion actually stops (nested `agents/` is rejected at compile).
 *  - WorkspaceLayersDiagram — write-time copy vs turn-time mount, the
 *    distinction the retired "overlay composer" docs got wrong.
 *  - SkillMaterializationDiagram — catalog folder → installed folder →
 *    compiled manifest → runtime.
 *  - GrantsByPresenceDiagram — a child grant is a signed narrowing
 *    sidecar over a root definition, so revocation cascades for free.
 *
 * House rules (see figures/README.md): primitives only, fixed viewBox,
 * 13/11/10px type, hue from the five tones, neutrals as CSS tokens.
 */
import { Diagram, DgArrow, DgBox, DgChip, DgGroup, DgLabel } from "../diagrams";

const MUTED = "var(--muted-foreground)";
const BORDER = "var(--border)";

/* ------------------------------------------------------------------ */
/* 1. The agent folder                                                 */
/* ------------------------------------------------------------------ */

/** The recursive shape, and the one place the recursion is cut off. */
export function AgentFolderTreeDiagram() {
  const rootSlots = [
    "USER.md",
    "SPACE.md",
    "CONTEXT.md",
    "GUARDRAILS.md",
    "MEMORY_GUIDE.md",
    "ROUTER.md",
    "TOOLS.md",
    "mcp.json",
    "memory/",
  ];
  let chipX = 30;
  return (
    <Diagram
      title="An agent folder: INSTRUCTIONS.md, skills, connectors and agents, with a sub-agent folder repeating the same shape one level down"
      viewBox="0 0 860 420"
      caption="The same four things at every level — which is why a sub-agent needs no new format. The recursion stops at one level: an agents/ folder inside a sub-agent folder is rejected at compile with reason nested_agent_folder."
    >
      <DgGroup
        x={20}
        y={30}
        w={820}
        h={370}
        label="tenants/<tenant>/agents/<agent>/ — the root agent folder"
      />

      <DgBox
        x={30}
        y={72}
        w={190}
        h={64}
        title="INSTRUCTIONS.md"
        sub="frontmatter + prose"
        tone="source"
      />
      <DgBox
        x={235}
        y={72}
        w={190}
        h={64}
        title="skills/"
        sub="<slug>/SKILL.md"
        tone="storage"
      />
      <DgBox
        x={440}
        y={72}
        w={190}
        h={64}
        title="connectors/"
        sub="<slug>/CONNECTION.md"
        tone="storage"
      />
      <DgBox
        x={645}
        y={72}
        w={190}
        h={64}
        title="agents/"
        sub="<slug>/ sub-agents"
        tone="compute"
      />

      <DgLabel x={30} y={165} text="Root-only slots" />
      {rootSlots.map((slot) => {
        const x = chipX;
        chipX += slot.length * 5.6 + 14 + 8;
        return <DgChip key={slot} x={x} y={173} label={slot} />;
      })}

      <DgArrow
        d="M 740 136 L 740 222"
        label="same shape, one level down"
        labelAt={[740, 179]}
      />

      <DgGroup
        x={200}
        y={225}
        w={640}
        h={155}
        label="agents/<slug>/ — a sub-agent folder"
      />
      <DgBox
        x={215}
        y={258}
        w={195}
        h={60}
        title="INSTRUCTIONS.md"
        sub="description: required"
        tone="source"
      />
      <DgBox
        x={425}
        y={258}
        w={195}
        h={60}
        title="skills/<slug>/"
        sub="signed marker only"
        tone="storage"
      />
      <DgBox
        x={635}
        y={258}
        w={195}
        h={60}
        title="connectors/<slug>/"
        sub="narrowing sidecar"
        tone="storage"
      />
      <text x={215} y={352} fontSize="11" fill={MUTED}>
        No agents/ here — nesting is rejected at admission, not capped by a
        depth counter.
      </text>
    </Diagram>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Composition                                                      */
/* ------------------------------------------------------------------ */

/** Write-time copy, then turn-time mount. Two different mechanisms. */
export function WorkspaceLayersDiagram() {
  const mounts = [
    {
      x: 30,
      title: "Agent/",
      sub: "the agent folder",
      tone: "compute" as const,
    },
    {
      x: 235,
      title: "Spaces/<space>/",
      sub: "the active space",
      tone: "graph" as const,
    },
    {
      x: 440,
      title: "User/",
      sub: "the requester",
      tone: "consumer" as const,
    },
    {
      x: 645,
      title: "Thread/",
      sub: "this thread's files",
      tone: "source" as const,
    },
  ];
  return (
    <Diagram
      title="Workspace defaults copy into a template and then an agent folder at write time; agent, space, user and thread files mount into one rendered workspace at turn time"
      viewBox="0 0 860 430"
      caption="Two mechanisms people merge into one. Defaults are copied once, at create time — there is no read-time ancestor walk. What happens per turn is a mount: four sources render into the tree the runtime syncs."
    >
      <DgGroup
        x={20}
        y={26}
        w={820}
        h={150}
        label="write time — files are copied, not resolved on read"
      />
      <DgBox
        x={40}
        y={70}
        w={220}
        h={64}
        title="workspace defaults"
        sub="@thinkwork/workspace-defaults"
        tone="source"
      />
      <DgArrow d="M 260 102 L 320 102" label="seed" labelAt={[290, 102]} />
      <DgBox
        x={320}
        y={70}
        w={220}
        h={64}
        title="tenant template layer"
        sub="_catalog/<template>/workspace/"
        tone="storage"
      />
      <DgArrow d="M 540 102 L 600 102" label="create" labelAt={[570, 102]} />
      <DgBox
        x={600}
        y={70}
        w={220}
        h={64}
        title="the agent folder"
        sub="tenants/<t>/agents/<agent>/"
        tone="storage"
      />
      <text x={40} y={160} fontSize="11" fill={MUTED}>
        GUARDRAILS.md is pinned by content hash — a later template change waits
        for an explicit accept.
      </text>

      <DgGroup
        x={20}
        y={196}
        w={820}
        h={210}
        label="turn time — four sources mount into one rendered workspace"
      />
      {mounts.map((mount) => (
        <DgBox
          key={mount.title}
          x={mount.x}
          y={234}
          w={190}
          h={56}
          title={mount.title}
          sub={mount.sub}
          tone={mount.tone}
        />
      ))}
      {mounts.map((mount) => (
        <path
          key={`rail-${mount.title}`}
          d={`M ${mount.x + 95} 290 L ${mount.x + 95} 312 L 430 312`}
          fill="none"
          stroke={BORDER}
          strokeWidth="1"
        />
      ))}
      <DgArrow d="M 430 312 L 430 330" />
      <DgBox
        x={270}
        y={330}
        w={320}
        h={56}
        title="rendered thread workspace"
        sub="what the runtime syncs and reads"
      />
    </Diagram>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Skill materialization                                            */
/* ------------------------------------------------------------------ */

/** Catalog folder → installed folder → compiled manifest → runtime. */
export function SkillMaterializationDiagram() {
  return (
    <Diagram
      title="A skill moves from the tenant catalog in S3 into an installed folder in the agent workspace, is compiled into the capabilities manifest, and is scanned by the runtime at turn start"
      viewBox="0 0 860 420"
      caption="Nothing in this chain is a database row. Installing a skill copies a folder; the folder's existence is the assignment."
    >
      <DgBox
        x={40}
        y={30}
        w={360}
        h={68}
        title="Tenant skill catalog"
        sub="tenants/<tenant>/skill-catalog/<slug>/"
        tone="source"
      />
      <DgChip x={440} y={44} label="SKILL.md" />
      <DgChip x={508} y={44} label="references/" />
      <DgChip x={592} y={44} label="scripts/" />
      <DgChip x={659} y={44} label="evals/" />
      <text x={440} y={86} fontSize="11" fill={MUTED}>
        S3 is the source of truth; the skill_catalog table is a derived index.
      </text>

      <DgArrow
        d="M 220 98 L 220 140"
        label="grantCapability(SKILL)"
        labelAt={[220, 119]}
      />

      <DgBox
        x={40}
        y={140}
        w={360}
        h={68}
        title="Installed skill folder"
        sub="agent workspace: skills/<slug>/"
        tone="storage"
      />
      <DgChip x={440} y={154} label="SKILL.md" />
      <DgChip x={508} y={154} label=".catalog-ref.json" />
      <DgChip x={625} y={154} label=".assignment.json" />
      <text x={440} y={196} fontSize="11" fill={MUTED}>
        Presence is the assignment; per-assignment state lives in the sidecar.
      </text>

      <DgArrow d="M 220 208 L 220 250" label="compile" labelAt={[220, 229]} />

      <DgBox
        x={40}
        y={250}
        w={360}
        h={68}
        title="Capabilities manifest"
        sub="class: skill — active, or withheld with a reason"
        tone="compute"
      />
      <text x={440} y={290} fontSize="11" fill={MUTED}>
        Content-addressed: the fingerprint changes only when the surface does.
      </text>

      <DgArrow d="M 220 318 L 220 348" label="sync" labelAt={[220, 333]} />

      <DgBox
        x={40}
        y={348}
        w={360}
        h={60}
        title="Pi runtime"
        sub="scans skills/**/SKILL.md at turn start"
        tone="consumer"
      />
      <text x={440} y={384} fontSize="11" fill={MUTED}>
        Name and description load up front; the body and references are read on
        demand.
      </text>
    </Diagram>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Grants by presence                                               */
/* ------------------------------------------------------------------ */

/** A child grant is a signed narrowing over a root definition. */
export function GrantsByPresenceDiagram() {
  return (
    <Diagram
      title="A root connector folder holds the definition and its full operation set; a sub-agent's grant folder holds only a signed narrowing sidecar, and revoking the root withers the child"
      viewBox="0 0 860 380"
      caption="Definitions and credentials never copy downward. The child folder carries a signed list of operations that must be a subset of the root's — checked when the manifest compiles, not when the tool is called."
    >
      <DgGroup x={20} y={40} w={380} h={180} label="root agent folder" />
      <DgBox
        x={40}
        y={76}
        w={340}
        h={64}
        title="connectors/crm/"
        sub="CONNECTION.md + signed sidecar"
        tone="storage"
      />
      <DgChip x={40} y={152} label="read_account" />
      <DgChip x={129} y={152} label="list_contacts" />
      <DgChip x={224} y={152} label="create_ticket" />
      <text x={40} y={198} fontSize="11" fill={MUTED}>
        The definition, the credential reference, the full grant.
      </text>

      <DgArrow d="M 400 108 L 460 108" label="narrows" labelAt={[430, 108]} />

      <DgGroup
        x={460}
        y={40}
        w={380}
        h={180}
        label="agents/support/ — a child grant"
      />
      <DgBox
        x={480}
        y={76}
        w={340}
        h={64}
        title="connectors/crm/"
        sub=".assignment.json only — no definition"
        tone="storage"
      />
      <DgChip x={480} y={152} label="read_account" />
      <DgChip x={569} y={152} label="list_contacts" />
      <text x={480} y={198} fontSize="11" fill={MUTED}>
        Operations must be a subset of the root, enforced at compile.
      </text>

      <DgGroup x={20} y={250} w={820} h={100} label="revoke the root" />
      <DgBox x={40} y={282} w={240} h={52} title="root connector removed" />
      <DgArrow d="M 280 308 L 350 308" label="cascade" labelAt={[315, 308]} />
      <DgBox
        x={350}
        y={282}
        w={240}
        h={52}
        title="child grant withers"
        sub="no edit to the child"
      />
      <text x={610} y={298} fontSize="11" fill={MUTED}>
        The manifest records
      </text>
      <DgChip x={610} y={308} label="withheld: missing_connection" />
    </Diagram>
  );
}
