/**
 * Figures for the Tools & integrations section (THINK-699).
 *
 * Two pictures the prose cannot carry:
 *
 *  - `ConnectorCredentialsDiagram` — the question every reader asks first,
 *    "whose password is this?". Three parties author three different things,
 *    and only one of them is a secret the agent could ever leak.
 *  - `ToolCallFlowDiagram` — what actually happens inside one turn when the
 *    agent reaches outside itself, including the two shapes an answer can
 *    come back in.
 *
 * Built from the shared primitives in `../diagrams.tsx` per
 * `figures/README.md`: fixed viewBox, tone accents only, 13/11/10px type.
 */
import { Diagram, DgArrow, DgBox, DgChip, DgGroup, DgLabel } from "../diagrams";

/**
 * Who holds which credential. The load-bearing claim is the bottom half: the
 * workspace and the model see references, the platform resolves values.
 */
export function ConnectorCredentialsDiagram() {
  return (
    <Diagram
      title="Who authorizes what: your per-user connection, the operator's tenant registration, and the credentials the runtime resolves at call time"
      viewBox="0 0 700 470"
      caption="Two people configure a connector and neither of them hands the agent a secret. You authorize your own account; an operator registers the endpoint. Both write references into the agent's workspace — the values stay in Secrets Manager and are resolved per call."
    >
      {/* Band 1 — the two authors */}
      <DgLabel x={40} y={26} text="Authored by" />

      <DgBox
        x={40}
        y={40}
        w={290}
        h={76}
        tone="consumer"
        align="top"
        title="You"
        sub="Connect your own account"
      />
      <DgChip x={56} y={82} label="Google Workspace" tone="consumer" />
      <DgChip x={176} y={82} label="Microsoft 365" tone="consumer" />

      <DgBox
        x={370}
        y={40}
        w={290}
        h={76}
        tone="source"
        align="top"
        title="An operator"
        sub="Register the endpoint for the tenant"
      />
      <DgChip x={386} y={82} label="URL + transport" tone="source" />
      <DgChip x={506} y={82} label="auth type" tone="source" />

      {/* Band 2 — where each half lands */}
      <DgArrow
        d="M 185 116 L 185 168"
        label="OAuth consent"
        labelAt={[185, 142]}
      />
      <DgArrow
        d="M 515 116 L 515 168"
        label="registration"
        labelAt={[515, 142]}
      />

      <DgLabel x={40} y={158} text="Stored as" />

      <DgBox
        x={40}
        y={168}
        w={290}
        h={64}
        tone="storage"
        title="Secrets Manager"
        sub="Token values, encrypted, per user"
      />
      <DgBox
        x={370}
        y={168}
        w={290}
        h={64}
        tone="storage"
        title="Connector registry"
        sub="Endpoint, transport, auth pattern"
      />

      {/* Band 3 — the workspace only ever sees references */}
      <DgArrow d="M 185 232 L 185 288" />
      <DgArrow d="M 515 232 L 515 288" />

      <DgBox
        x={40}
        y={288}
        w={620}
        h={76}
        tone="neutral"
        align="top"
        title="The agent folder"
        sub="connectors/<name>/ — presence grants it, the sidecar shapes it"
      />
      <DgChip x={120} y={330} label="enabled" />
      <DgChip x={212} y={330} label="allowed operations" />
      <DgChip x={382} y={330} label="approval policy" />
      <DgChip x={516} y={330} label="credential ref" />

      {/* Band 4 — resolution happens at call time, not in the folder */}
      <DgArrow
        d="M 350 364 L 350 412"
        label="resolved per call"
        labelAt={[350, 388]}
      />

      <DgGroup x={150} y={412} w={400} h={48} />
      <DgBox
        x={158}
        y={418}
        w={384}
        h={36}
        tone="compute"
        title="The turn, acting as you"
      />
    </Diagram>
  );
}

/**
 * One turn, from your message to what comes back. The fan in the middle is
 * the point: built-in tools, skills and connector tools are one flat set to
 * the model, and the result of any of them re-enters the same turn.
 */
export function ToolCallFlowDiagram() {
  return (
    <Diagram
      title="A turn that calls a tool: your message, the agent's tool choice, the result returning to the same turn, and the three shapes an answer can take"
      viewBox="0 0 700 540"
      caption="Tool calls happen inside a turn, not after it. Whatever a tool returns comes back to the same turn, so the agent can call another one, correct itself, or answer — and the answer may arrive as prose, as a chart card, or as an artifact."
    >
      <DgBox
        x={200}
        y={24}
        w={300}
        h={52}
        tone="consumer"
        title="Your message"
        sub="Or a schedule, or a Slack mention"
      />

      <DgArrow d="M 350 76 L 350 124" />

      <DgBox
        x={200}
        y={124}
        w={300}
        h={60}
        tone="compute"
        title="The agent picks a tool"
        sub="From one flat list, by description"
      />

      {/* Fan out to the three families */}
      <DgArrow d="M 320 184 L 320 214 L 135 214 L 135 258" />
      <DgArrow d="M 350 184 L 350 258" />
      <DgArrow d="M 380 184 L 380 214 L 565 214 L 565 258" />

      <DgGroup x={24} y={238} w={652} h={112} label="Available this turn" />

      <DgBox
        x={40}
        y={258}
        w={190}
        h={76}
        tone="source"
        align="top"
        title="Built-in tools"
        sub="Shipped with the platform"
      />
      <DgChip x={56} y={300} label="web search" tone="source" />
      <DgChip x={146} y={300} label="sandbox" tone="source" />

      <DgBox
        x={255}
        y={258}
        w={190}
        h={76}
        tone="source"
        align="top"
        title="Skills"
        sub="Installed procedures"
      />
      <DgChip x={271} y={300} label="skills/<slug>/" tone="source" />

      <DgBox
        x={470}
        y={258}
        w={190}
        h={76}
        tone="source"
        align="top"
        title="Connector tools"
        sub="Discovered from the server"
      />
      <DgChip x={486} y={300} label="MCP over HTTP" tone="source" />

      {/* Converge back into the turn */}
      <DgArrow d="M 135 334 L 135 378 L 320 378 L 320 406" />
      <DgArrow d="M 350 350 L 350 406" />
      <DgArrow d="M 565 334 L 565 378 L 380 378 L 380 406" />

      <DgBox
        x={200}
        y={406}
        w={300}
        h={52}
        tone="compute"
        title="Result re-enters the turn"
        sub="Call again, or answer"
      />

      {/* What comes back */}
      <DgArrow d="M 320 458 L 320 478 L 130 478 L 130 498" />
      <DgArrow d="M 350 458 L 350 498" />
      <DgArrow d="M 380 458 L 380 478 L 570 478 L 570 498" />

      <DgBox x={40} y={498} w={180} h={36} tone="graph" title="Reply text" />
      <DgBox x={260} y={498} w={180} h={36} tone="graph" title="Chart card" />
      <DgBox x={480} y={498} w={180} h={36} tone="graph" title="Artifact" />
    </Diagram>
  );
}
