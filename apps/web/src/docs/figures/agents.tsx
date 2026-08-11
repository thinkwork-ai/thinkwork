/**
 * Figures for the Agents section, in the report figure language
 * (2026-08-11 docs overhaul; modeled on figures/memory.tsx →
 * ConsolidationLoopFigure): fill-card boxes with teal strokes, muted
 * edges with arrowhead markers, italic 11px edge labels, one unique
 * marker id per figure. No amber anywhere here — nothing these figures
 * draw is a human-in-the-loop step.
 *
 * Three pictures the prose cannot carry on its own:
 *  - AgentFolderTreeDiagram (marker `af-arr`) — the one recursive shape,
 *    and where the recursion stops (a nested `agents/` folder is
 *    rejected at compile). Drawn from agent-folder-format.ts and
 *    capabilities/manifest-compile.ts (`nested_agent_folder`).
 *  - WorkspaceLayersDiagram (marker `wl-arr`) — write-time copy vs
 *    turn-time mount, the distinction the retired "overlay composer"
 *    docs got wrong. Drawn from workspace-bootstrap.ts ("what this is
 *    NOT: an overlay composer") and workspace-lanes.ts (the Agent/,
 *    Spaces/, User/, Thread/ mounts).
 *  - GrantsByPresenceDiagram (marker `gp-arr`) — a child grant is a
 *    signed narrowing sidecar over a root definition, so revocation
 *    cascades with no edit to any child. Drawn from
 *    capabilities/manifest-compile.ts (subset check →
 *    `operation_not_permitted`, cascade → `missing_connection`).
 *
 * The old SkillMaterializationDiagram was a straight four-box chain; it
 * is now an inline vertical Flow on the Skills page and the component is
 * deleted.
 */

/* ------------------------------------------------------------------ */
/* 1. The agent folder                                                 */
/* ------------------------------------------------------------------ */

/** The recursive shape, and the one place the recursion is cut off. */
export function AgentFolderTreeDiagram() {
  return (
    <figure className="pt-1">
      <svg
        viewBox="0 0 760 344"
        role="img"
        aria-label="The root agent folder holds INSTRUCTIONS.md, skills, connectors and agents; a sub-agent folder inside agents/ repeats the same shape one level down, minus its own agents/ folder"
        className="block h-auto w-full"
      >
        <defs>
          <marker
            id="af-arr"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {/* root folder enclosure */}
        <rect
          x="10"
          y="26"
          width="740"
          height="110"
          rx="10"
          className="fill-none stroke-muted-foreground/40"
          strokeWidth="1"
          strokeDasharray="5 4"
        />
        <text
          x="24"
          y="16"
          className="fill-muted-foreground font-sans text-[11px]"
        >
          tenants/&lt;tenant&gt;/agents/&lt;agent&gt;/ — the root agent folder
        </text>

        <rect x="26" y="46" width="168" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="40" y="70" className="fill-foreground font-sans text-[14px] font-semibold">INSTRUCTIONS.md</text>
        <text x="40" y="88" className="fill-muted-foreground font-sans text-[11px]">frontmatter + prose</text>

        <rect x="208" y="46" width="168" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="222" y="70" className="fill-foreground font-sans text-[14px] font-semibold">skills/</text>
        <text x="222" y="88" className="fill-muted-foreground font-sans text-[11px]">&lt;slug&gt;/SKILL.md</text>

        <rect x="390" y="46" width="168" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="404" y="70" className="fill-foreground font-sans text-[14px] font-semibold">connectors/</text>
        <text x="404" y="88" className="fill-muted-foreground font-sans text-[11px]">&lt;slug&gt;/CONNECTION.md</text>

        <rect x="572" y="46" width="168" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="586" y="70" className="fill-foreground font-sans text-[14px] font-semibold">agents/</text>
        <text x="586" y="88" className="fill-muted-foreground font-sans text-[11px]">&lt;slug&gt;/ sub-agents</text>

        {/* the recursion edge */}
        <line
          x1="656"
          y1="104"
          x2="656"
          y2="184"
          className="stroke-muted-foreground"
          strokeWidth="1.3"
          markerEnd="url(#af-arr)"
        />
        <text
          x="470"
          y="164"
          className="fill-muted-foreground font-sans text-[11px] italic"
        >
          same shape, one level down
        </text>

        {/* sub-agent folder enclosure */}
        <rect
          x="150"
          y="190"
          width="600"
          height="106"
          rx="10"
          className="fill-none stroke-muted-foreground/40"
          strokeWidth="1"
          strokeDasharray="5 4"
        />
        <text
          x="164"
          y="182"
          className="fill-muted-foreground font-sans text-[11px]"
        >
          agents/&lt;slug&gt;/ — a sub-agent folder
        </text>

        <rect x="168" y="210" width="180" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="182" y="234" className="fill-foreground font-sans text-[14px] font-semibold">INSTRUCTIONS.md</text>
        <text x="182" y="252" className="fill-muted-foreground font-sans text-[11px]">description: required</text>

        <rect x="362" y="210" width="180" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="376" y="234" className="fill-foreground font-sans text-[14px] font-semibold">skills/&lt;slug&gt;/</text>
        <text x="376" y="252" className="fill-muted-foreground font-sans text-[11px]">signed marker only</text>

        <rect x="556" y="210" width="180" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="570" y="234" className="fill-foreground font-sans text-[14px] font-semibold">connectors/&lt;slug&gt;/</text>
        <text x="570" y="252" className="fill-muted-foreground font-sans text-[11px]">narrowing sidecar</text>

        <text
          x="168"
          y="286"
          className="fill-muted-foreground font-sans text-[11px]"
        >
          no agents/ here — nesting is rejected at compile as
          nested_agent_folder
        </text>
      </svg>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        The same four things at every level, which is why a sub-agent needs no
        new format. The recursion stops at one level — structurally, not by a
        depth counter.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Composition                                                      */
/* ------------------------------------------------------------------ */

/** Write-time copy, then turn-time mount. Two different mechanisms. */
export function WorkspaceLayersDiagram() {
  return (
    <figure className="pt-1">
      <svg
        viewBox="0 0 760 372"
        role="img"
        aria-label="Workspace defaults are copied into a tenant template and then an agent folder at write time; at turn time the agent folder, the active space, the requesting user and the thread mount into one rendered workspace"
        className="block h-auto w-full"
      >
        <defs>
          <marker
            id="wl-arr"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {/* write-time band */}
        <text
          x="10"
          y="16"
          className="fill-muted-foreground font-sans text-[11px]"
        >
          write time — files are copied once, not resolved on read
        </text>

        <rect x="10" y="30" width="216" height="60" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="26" y="55" className="fill-foreground font-sans text-[14px] font-semibold">workspace defaults</text>
        <text x="26" y="73" className="fill-muted-foreground font-sans text-[11px]">@thinkwork/workspace-defaults</text>

        <rect x="272" y="30" width="216" height="60" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="288" y="55" className="fill-foreground font-sans text-[14px] font-semibold">tenant template</text>
        <text x="288" y="73" className="fill-muted-foreground font-sans text-[11px]">your house edits, kept as files</text>

        <rect x="534" y="30" width="216" height="60" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="550" y="55" className="fill-foreground font-sans text-[14px] font-semibold">the agent folder</text>
        <text x="550" y="73" className="fill-muted-foreground font-sans text-[11px]">a complete, standalone tree</text>

        <line x1="226" y1="60" x2="266" y2="60" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#wl-arr)" />
        <text x="228" y="50" className="fill-muted-foreground font-sans text-[11px] italic">seed</text>
        <line x1="488" y1="60" x2="528" y2="60" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#wl-arr)" />
        <text x="486" y="50" className="fill-muted-foreground font-sans text-[11px] italic">create</text>

        <text
          x="10"
          y="116"
          className="fill-muted-foreground font-sans text-[11px]"
        >
          GUARDRAILS.md is pinned by content hash — a later template change
          waits for an explicit accept
        </text>

        {/* turn-time band */}
        <text
          x="10"
          y="162"
          className="fill-muted-foreground font-sans text-[11px]"
        >
          turn time — four sources mount into one rendered workspace
        </text>

        <rect x="10" y="176" width="172" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="24" y="200" className="fill-foreground font-sans text-[14px] font-semibold">Agent/</text>
        <text x="24" y="218" className="fill-muted-foreground font-sans text-[11px]">the agent folder</text>

        <rect x="199" y="176" width="172" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="213" y="200" className="fill-foreground font-sans text-[14px] font-semibold">Spaces/&lt;space&gt;/</text>
        <text x="213" y="218" className="fill-muted-foreground font-sans text-[11px]">the active space</text>

        <rect x="388" y="176" width="172" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="402" y="200" className="fill-foreground font-sans text-[14px] font-semibold">User/</text>
        <text x="402" y="218" className="fill-muted-foreground font-sans text-[11px]">the requester</text>

        <rect x="577" y="176" width="172" height="58" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="591" y="200" className="fill-foreground font-sans text-[14px] font-semibold">Thread/</text>
        <text x="591" y="218" className="fill-muted-foreground font-sans text-[11px]">this thread&apos;s files</text>

        {/* fan-in rails */}
        <path d="M 96 234 L 96 262 L 380 262" fill="none" className="stroke-muted-foreground/70" strokeWidth="1.1" />
        <path d="M 285 234 L 285 262" fill="none" className="stroke-muted-foreground/70" strokeWidth="1.1" />
        <path d="M 474 234 L 474 262" fill="none" className="stroke-muted-foreground/70" strokeWidth="1.1" />
        <path d="M 663 234 L 663 262 L 380 262" fill="none" className="stroke-muted-foreground/70" strokeWidth="1.1" />
        <line x1="380" y1="262" x2="380" y2="288" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#wl-arr)" />
        <text x="392" y="282" className="fill-muted-foreground font-sans text-[11px] italic">mount</text>

        <rect x="262" y="294" width="236" height="60" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="278" y="319" className="fill-foreground font-sans text-[14px] font-semibold">rendered thread workspace</text>
        <text x="278" y="337" className="fill-muted-foreground font-sans text-[11px]">what the runtime syncs and reads</text>
      </svg>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Two mechanisms people merge into one. Defaults are copied once, at
        create time — there is no read-time ancestor walk. What happens per
        turn is a mount: four sources render into the tree the runtime syncs.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Grants by presence                                               */
/* ------------------------------------------------------------------ */

/** A child grant is a signed narrowing over a root definition. */
export function GrantsByPresenceDiagram() {
  return (
    <figure className="pt-1">
      <svg
        viewBox="0 0 760 296"
        role="img"
        aria-label="A root connector folder holds the definition and the full operation set; a sub-agent's grant folder holds only a signed narrowing sidecar with a subset of the operations; revoking the root withers the child grant with no edit to the child folder"
        className="block h-auto w-full"
      >
        <defs>
          <marker
            id="gp-arr"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {/* root grant */}
        <rect x="10" y="26" width="320" height="96" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="26" y="52" className="fill-foreground font-sans text-[15px] font-semibold">connectors/crm/ — at the root</text>
        <text x="26" y="72" className="fill-muted-foreground font-sans text-[11px]">CONNECTION.md + signed sidecar</text>
        <text x="26" y="90" className="fill-muted-foreground font-sans text-[11px]">the definition, the credential reference</text>
        <text x="26" y="110" className="fill-muted-foreground font-mono text-[10px]">read_account · list_contacts · create_ticket</text>

        {/* child grant */}
        <rect x="430" y="26" width="320" height="96" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="446" y="52" className="fill-foreground font-sans text-[15px] font-semibold">agents/support/connectors/crm/</text>
        <text x="446" y="72" className="fill-muted-foreground font-sans text-[11px]">.assignment.json only — no definition</text>
        <text x="446" y="90" className="fill-muted-foreground font-sans text-[11px]">operations must be a subset of the root&apos;s</text>
        <text x="446" y="110" className="fill-muted-foreground font-mono text-[10px]">read_account · list_contacts</text>

        <line x1="330" y1="74" x2="424" y2="74" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#gp-arr)" />
        <text x="348" y="64" className="fill-muted-foreground font-sans text-[11px] italic">narrows</text>

        {/* revocation cascade */}
        <line
          x1="170"
          y1="122"
          x2="170"
          y2="196"
          className="stroke-muted-foreground"
          strokeWidth="1.3"
          strokeDasharray="4 3"
          markerEnd="url(#gp-arr)"
        />
        <text x="182" y="164" className="fill-muted-foreground font-sans text-[11px] italic">remove or disable the root</text>

        <rect x="10" y="202" width="320" height="60" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="26" y="227" className="fill-foreground font-sans text-[14px] font-semibold">root connector gone</text>
        <text x="26" y="245" className="fill-muted-foreground font-sans text-[11px]">one action, at one place</text>

        <line x1="330" y1="232" x2="424" y2="232" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#gp-arr)" />
        <text x="342" y="222" className="fill-muted-foreground font-sans text-[11px] italic">cascades</text>

        <rect x="430" y="202" width="320" height="60" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
        <text x="446" y="227" className="fill-foreground font-sans text-[14px] font-semibold">every child grant withers</text>
        <text x="446" y="245" className="fill-muted-foreground font-sans text-[11px]">manifest: withheld — missing_connection</text>
      </svg>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Definitions and credentials never copy downward. The child folder
        carries a signed list of operations checked against the root when the
        manifest compiles — so revoking the root revokes everything, with no
        edit to any child folder.
      </figcaption>
    </figure>
  );
}
