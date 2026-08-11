/**
 * Figures for the Tools & integrations section (THINK-699), in the report
 * figure language (2026-08-11 docs overhaul; modeled on memory.tsx's
 * ConsolidationLoopFigure): fill-card boxes with teal strokes, muted edges
 * with arrowhead markers, italic 11px edge labels, one unique marker id per
 * figure.
 *
 *  - `ConnectorCredentialsDiagram` — the question every reader asks first,
 *    "whose password is this?". Two parties author two different halves, and
 *    the workspace only ever carries references. The one amber element in
 *    the section's figures is the OAuth-consent box: a human authorizing
 *    their own account is the load-bearing human step; the signing and
 *    resolution machinery around it is platform automation and stays teal.
 *  - `ToolCallFlowDiagram` — the tool loop inside one turn, drawn as a
 *    loop: the result of any tool re-enters the same turn.
 *
 * Drawn from the shipped code: packages/api/src/lib/capabilities/
 * definition-schemas.ts (sidecar fields; credential references only, raw
 * secrets rejected at parse), sidecar-signing.ts + manifest-compile.ts
 * (platform-signed sidecars; unsigned/drifted/disabled withheld),
 * packages/api/src/lib/mcp-configs.ts (per-user token resolution at
 * dispatch), packages/database-pg/src/schema/integrations.ts and
 * mcp-servers.ts (token values in Secrets Manager, registry rows), and
 * packages/agentcore-pi/agent-container/src/{server.ts,mcp-connect.ts}
 * (one flat tool list; listTools discovery; results returning to the turn).
 */

/**
 * Who holds which credential. The load-bearing claim is the bottom half:
 * the workspace and the model see references, the platform resolves values
 * at call time.
 */
export function ConnectorCredentialsDiagram() {
  return (
    <figure className="pt-1">
      <div>
        <svg
          viewBox="0 0 760 452"
          role="img"
          aria-label="Who authorizes what: you authorize your own account through OAuth consent and the token value lands in Secrets Manager; an operator registers the endpoint in the connector registry; both are recorded in the agent folder's signed sidecar as references only; the value is resolved per call for the turn acting as you"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="cn-arr"
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

          {/* Row 1 — the two authors. The human consent box is the amber
              element: a person authorizing their own account. */}
          <rect x="20" y="36" width="330" height="62" rx="8" className="fill-card stroke-amber-400/60" strokeWidth="1.5" strokeDasharray="6 4" />
          <text x="36" y="62" className="fill-foreground font-sans text-[15px] font-semibold">You</text>
          <text x="36" y="82" className="fill-muted-foreground font-sans text-[11px]">authorize your own account — OAuth consent</text>

          <rect x="410" y="36" width="330" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="426" y="62" className="fill-foreground font-sans text-[15px] font-semibold">An operator</text>
          <text x="426" y="82" className="fill-muted-foreground font-sans text-[11px]">registers the endpoint for the tenant</text>

          <line x1="185" y1="98" x2="185" y2="164" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cn-arr)" />
          <text x="196" y="136" className="fill-muted-foreground font-sans text-[11px] italic">your consent</text>
          <line x1="575" y1="98" x2="575" y2="164" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cn-arr)" />
          <text x="586" y="136" className="fill-muted-foreground font-sans text-[11px] italic">registration</text>

          {/* Row 2 — where each half lands */}
          <rect x="20" y="170" width="330" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="36" y="196" className="fill-foreground font-sans text-[15px] font-semibold">Secrets Manager</text>
          <text x="36" y="216" className="fill-muted-foreground font-sans text-[11px]">token values, encrypted, per user</text>

          <rect x="410" y="170" width="330" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="426" y="196" className="fill-foreground font-sans text-[15px] font-semibold">Connector registry</text>
          <text x="426" y="216" className="fill-muted-foreground font-sans text-[11px]">URL, transport, auth type</text>

          <line x1="185" y1="232" x2="185" y2="278" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cn-arr)" />
          <text x="196" y="260" className="fill-muted-foreground font-sans text-[11px] italic">a reference, never the value</text>
          <line x1="575" y1="232" x2="575" y2="278" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cn-arr)" />

          {/* Row 3 — the workspace only ever sees references */}
          <rect x="20" y="284" width="720" height="66" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="36" y="310" className="fill-foreground font-sans text-[15px] font-semibold">The agent folder — connectors/&lt;slug&gt;/</text>
          <text x="36" y="330" className="fill-muted-foreground font-sans text-[11px]">platform-signed sidecar: enabled · allowed operations · approval policy · credential references</text>

          {/* Row 4 — resolution happens at call time, not in the folder */}
          <line x1="380" y1="350" x2="380" y2="392" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#cn-arr)" />
          <text x="391" y="376" className="fill-muted-foreground font-sans text-[11px] italic">resolved per call</text>

          <rect x="250" y="398" width="260" height="48" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="266" y="427" className="fill-foreground font-sans text-[15px] font-semibold">The turn, acting as you</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Two people configure a connector and neither of them hands the agent a
        secret. Both halves are recorded in the agent folder as references; the
        values stay in Secrets Manager and are resolved per call.
      </figcaption>
    </figure>
  );
}

/**
 * One turn, from your message to what comes back. The loop is the point:
 * built-in tools, skills and connector tools are one flat set to the model,
 * and the result of any of them re-enters the same turn.
 */
export function ToolCallFlowDiagram() {
  return (
    <figure className="pt-1">
      <div>
        <svg
          viewBox="0 0 760 452"
          role="img"
          aria-label="A turn that calls a tool: your message starts a turn, the agent picks a tool from one flat list drawn from built-in tools, skills and connector tools, the result re-enters the same turn, and the agent calls again or answers"
          className="block h-auto w-full"
        >
          <defs>
            <marker
              id="tl-arr"
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

          {/* the spine: message → pick → families → result */}
          <rect x="290" y="20" width="220" height="56" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="306" y="44" className="fill-foreground font-sans text-[15px] font-semibold">Your message</text>
          <text x="306" y="62" className="fill-muted-foreground font-sans text-[11px]">or a schedule, or a Slack mention</text>

          <line x1="400" y1="76" x2="400" y2="110" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tl-arr)" />
          <text x="411" y="98" className="fill-muted-foreground font-sans text-[11px] italic">starts a turn</text>

          <rect x="290" y="116" width="220" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="306" y="142" className="fill-foreground font-sans text-[15px] font-semibold">The agent picks a tool</text>
          <text x="306" y="162" className="fill-muted-foreground font-sans text-[11px]">one flat list, chosen by description</text>

          {/* fork to the three families */}
          <line x1="400" y1="178" x2="400" y2="244" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tl-arr)" />
          <path d="M 340 178 L 340 212 L 132 212 L 132 244" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tl-arr)" />
          <path d="M 460 178 L 460 212 L 628 212 L 628 244" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tl-arr)" />

          <rect x="20" y="250" width="225" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="36" y="276" className="fill-foreground font-sans text-[15px] font-semibold">Built-in tools</text>
          <text x="36" y="296" className="fill-muted-foreground font-sans text-[11px]">shipped with the platform</text>

          <rect x="268" y="250" width="225" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="284" y="276" className="fill-foreground font-sans text-[15px] font-semibold">Skills</text>
          <text x="284" y="296" className="fill-muted-foreground font-sans text-[11px]">installed procedures</text>

          <rect x="515" y="250" width="225" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="531" y="276" className="fill-foreground font-sans text-[15px] font-semibold">Connector tools</text>
          <text x="531" y="296" className="fill-muted-foreground font-sans text-[11px]">discovered from the MCP server</text>

          {/* converge back into the turn */}
          <path d="M 132 312 L 132 344 L 340 344 L 340 372" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tl-arr)" />
          <line x1="400" y1="312" x2="400" y2="372" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tl-arr)" />
          <path d="M 628 312 L 628 344 L 460 344 L 460 372" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tl-arr)" />

          <rect x="290" y="378" width="220" height="62" rx="8" className="fill-card stroke-teal-400/50" strokeWidth="1.5" />
          <text x="306" y="404" className="fill-foreground font-sans text-[15px] font-semibold">The result comes back</text>
          <text x="306" y="424" className="fill-muted-foreground font-sans text-[11px]">into the same turn</text>

          {/* the return edge — the loop is the argument */}
          <path d="M 510 409 L 744 409 L 744 147 L 516 147" fill="none" className="stroke-muted-foreground" strokeWidth="1.3" markerEnd="url(#tl-arr)" />
          <text x="548" y="138" className="fill-muted-foreground font-sans text-[11px] italic">calls again, or answers</text>
        </svg>
      </div>
      <figcaption className="mt-2 font-sans text-[13px] leading-6 text-muted-foreground">
        Tool calls happen inside a turn, not after it. Whatever a tool returns
        re-enters the same turn, so the agent can call another tool, correct
        itself, or answer — nothing about a connector is a separate step you
        wait for.
      </figcaption>
    </figure>
  );
}
